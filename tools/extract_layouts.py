"""Rebuild the packed ASCII maps using the installed Digistump 1.7.5 header."""

from pathlib import Path
import hashlib, json, subprocess, sys, tempfile, os

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from generator import LAYOUTS

packages = (
    Path(os.environ.get("ARDUINO_DATA_DIR", str(Path.home() / ".arduino15")))
    / "packages"
)
header = (
    packages / "digistump/hardware/avr/1.7.5/libraries/DigisparkKeyboard/keylayouts.h"
)
bin = (
    Path(os.environ["AVR_TOOLCHAIN_BIN"])
    if "AVR_TOOLCHAIN_BIN" in os.environ
    else sorted((packages / "arduino/tools/avr-gcc").glob("*/bin"))[-1]
)
result = {}
with tempfile.TemporaryDirectory() as d:
    p = Path(d)
    for layout in LAYOUTS:
        source = p / "map.cpp"
        obj = p / "map.o"
        data = p / "map.bin"
        source.write_text(f'#define LAYOUT_{layout}\n#include "{header}"\n')
        subprocess.run(
            [str(bin / "avr-g++"), "-mmcu=attiny85", "-c", str(source), "-o", str(obj)],
            check=True,
            capture_output=True,
        )
        symbols = subprocess.check_output(
            [str(bin / "avr-nm"), "-S", str(obj)], text=True
        )
        match = next(
            line.split() for line in symbols.splitlines() if "keycodes_ascii" in line
        )
        offset, size = int(match[0], 16), int(match[1], 16)
        subprocess.run(
            [
                str(bin / "avr-objcopy"),
                "-O",
                "binary",
                "-j",
                ".progmem.data",
                str(obj),
                str(data),
            ],
            check=True,
        )
        mapping = list(data.read_bytes()[offset : offset + size])
        assert len(mapping) == 96
        result[layout] = mapping
license = header.read_text().split("*/", 1)[0] + "*/"
(root / "data/layout_maps.json").write_text(
    json.dumps(
        {
            "source": "ArminJo/DigistumpArduino 1.7.5 keylayouts.h",
            "sha256": hashlib.sha256(header.read_bytes()).hexdigest(),
            "license": license,
            "maps": result,
        },
        indent=2,
    )
    + "\n"
)
print("Extracted", len(result), "verified maps")
