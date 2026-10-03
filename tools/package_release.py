"""Build a source archive from an explicit allowlist; never includes local data."""

from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".prettierignore",
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "app.py",
    "generator.py",
    "launch.py",
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "package.json",
    "package-lock.json",
    "playwright.config.js",
]
FOLDERS = [".github", "frontend", "templates", "static", "data", "docs", "tools"]


def package():
    paths = [ROOT / name for name in FILES]
    for folder in FOLDERS:
        paths.extend(
            p
            for p in (ROOT / folder).rglob("*")
            if p.is_file() and "__pycache__" not in p.parts
        )
    paths.extend(p for p in (ROOT / "tests").glob("*") if p.suffix in (".py", ".js"))
    output = ROOT / "dist/digispark-studio.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(set(paths)):
            archive.write(p, "DigisparkStudio/" + p.relative_to(ROOT).as_posix())
    print(f"{output.name}: {len(paths)} files, {output.stat().st_size:,} bytes")
    return output


if __name__ == "__main__":
    package()
