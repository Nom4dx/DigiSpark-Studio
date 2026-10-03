#!/usr/bin/env python3
"""Start the local studio if needed, then open its browser tab."""
from pathlib import Path
import os, subprocess, sys, time, urllib.request, webbrowser

root = Path(__file__).resolve().parent
url = "http://127.0.0.1:" + str(int(os.environ.get("PORT", "5055")))


def ready():
    try:
        with urllib.request.urlopen(url + "/api/status", timeout=1) as r:
            return r.status == 200 and b"compiler" in r.read()
    except OSError:
        return False


if not ready():
    python = root / (
        ".venv/Scripts/python.exe" if os.name == "nt" else ".venv/bin/python"
    )
    if not python.exists():
        python = Path(sys.executable)
    logs = Path.home() / ".cache/digispark-studio"
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / "server.log").open("a") as log:
        subprocess.Popen(
            [str(python), str(root / "app.py")],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    for _ in range(50):
        if ready():
            break
        time.sleep(0.1)
    else:
        print(
            "Could not start the application. Check " + str(logs / "server.log"),
            file=sys.stderr,
        )
        sys.exit(1)
webbrowser.open(url, new=2)
