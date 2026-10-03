from flask import Flask, render_template, request, jsonify
from pathlib import Path
from urllib.parse import urlparse
import os, shutil, subprocess, tempfile, threading
import json
from generator import generate, InvalidProject, KEYS, MODS, LAYOUTS, UNAVAILABLE_LAYOUTS

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024
compile_lock = threading.Lock()


@app.before_request
def local_only():
    if request.host.split(":")[0] not in ("127.0.0.1", "localhost", "[::1]"):
        return jsonify(error="Use localhost."), 403
    origin = request.headers.get("Origin")
    if request.method == "POST" and origin and urlparse(origin).netloc != request.host:
        return jsonify(error="Origin not allowed."), 403


@app.errorhandler(413)
def too_large(e):
    return jsonify(error="Project too large (512 KB maximum)."), 413


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/catalog")
def catalog():
    return jsonify(
        layouts=LAYOUTS,
        unavailableLayouts=UNAVAILABLE_LAYOUTS,
        keys=list(KEYS),
        modifiers=list(MODS),
    )


@app.post("/api/generate")
def generation():
    try:
        return jsonify(generate(request.get_json()))
    except (InvalidProject, TypeError, ValueError, KeyError) as e:
        return jsonify(error=str(e)), 400


def find_cli():
    configured = os.environ.get("ARDUINO_CLI") or shutil.which("arduino-cli")
    if configured:
        return configured
    for p in Path("/tmp").glob(
        ".mount_*/resources/app/lib/backend/resources/arduino-cli"
    ):
        if p.is_file():
            return str(p)
    return None


def config_args():
    config = Path(
        os.environ.get(
            "ARDUINO_CONFIG", str(Path.home() / ".arduinoIDE/arduino-cli.yaml")
        )
    )
    return ["--config-file", str(config)] if config.exists() else []


def compiler_info():
    cli = find_cli()
    if not cli:
        return dict(
            compiler=False,
            reason="Arduino CLI not found: open Arduino IDE or set ARDUINO_CLI.",
        )
    try:
        result = subprocess.run(
            [cli, "core", "list", "--json"] + config_args(),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode:
            return dict(
                compiler=False,
                reason="Arduino CLI is not ready: check its configuration.",
            )
        data = json.loads(result.stdout)
        platforms = data if isinstance(data, list) else data.get("platforms", [])
        installed = next(
            (
                p
                for p in platforms
                if p.get("id") == "digistump:avr"
                and (
                    p.get("installed_version")
                    or p.get("installed")
                    or any(r.get("installed") for r in p.get("releases", {}).values())
                )
            ),
            None,
        )
        if not installed:
            return dict(
                compiler=False,
                reason="Digistump AVR core missing: install version 1.7.5 in Arduino IDE.",
            )
        return dict(compiler=True, reason="Arduino CLI and Digistump core are ready.")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return dict(
            compiler=False,
            reason="Cannot check Arduino CLI: verify its path and configuration.",
        )


@app.get("/api/status")
def status():
    return jsonify(**compiler_info(), board="Digispark ATtiny85 · 16.5 MHz USB")


@app.post("/api/compile")
def compile_sketch():
    data = request.get_json()
    if (
        not isinstance(data, dict)
        or not isinstance(data.get("code"), str)
        or not 1 <= len(data["code"]) <= 100000
    ):
        return jsonify(error="Invalid code (100 KB maximum)."), 400
    cli = find_cli()
    info = compiler_info()
    if not info["compiler"]:
        return jsonify(error=info["reason"]), 503
    if not compile_lock.acquire(blocking=False):
        return jsonify(error="A compilation is already running."), 409
    try:
        with tempfile.TemporaryDirectory(prefix="digispark-studio-") as temp:
            folder = Path(temp) / "StudioSketch"
            folder.mkdir()
            (folder / "StudioSketch.ino").write_text(data["code"], encoding="utf-8")
            args = [
                cli,
                "compile",
                "--fqbn",
                "digistump:avr:digispark-tiny:clock=clock165",
                str(folder),
            ]
            args.extend(config_args())
            result = subprocess.run(args, capture_output=True, text=True, timeout=90)
            return jsonify(
                ok=result.returncode == 0,
                output=(result.stdout + result.stderr)[-30000:],
            )
    except subprocess.TimeoutExpired:
        return jsonify(error="Compilation timed out after 90 seconds."), 504
    except OSError as e:
        return jsonify(error=str(e)), 503
    finally:
        compile_lock.release()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5055")), debug=False)
