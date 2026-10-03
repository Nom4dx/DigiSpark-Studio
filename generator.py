"""Validated block IR -> Digispark C++ and bounded visual execution trace."""

import re
import json
from pathlib import Path
from urllib.parse import urlparse

LAYOUTS = {
    x: x.replace("_", " ").title()
    for x in (
        "ITALIAN US_ENGLISH UNITED_KINGDOM US_INTERNATIONAL FRENCH FRENCH_BELGIAN "
        "CANADIAN_FRENCH CANADIAN_MULTILINGUAL GERMAN GERMAN_MAC SPANISH "
        "SPANISH_LATIN_AMERICA PORTUGUESE PORTUGUESE_BRAZILIAN DANISH FINNISH "
        "SWEDISH NORWEGIAN ICELANDIC IRISH SWISS_GERMAN SWISS_FRENCH TURKISH"
    ).split()
}
LAYOUTS.update(
    ITALIAN="Italian", US_ENGLISH="English (US)", UNITED_KINGDOM="English (UK)"
)
# Verified against Digistump AVR 1.7.5: these upstream maps do not compile.
UNAVAILABLE_LAYOUTS = {
    name: LAYOUTS.pop(name)
    for name in (
        "CANADIAN_MULTILINGUAL PORTUGUESE DANISH FINNISH SWEDISH NORWEGIAN ICELANDIC TURKISH"
    ).split()
}
KEYS = {chr(65 + i): 4 + i for i in range(26)}
KEYS.update({str(i): 29 + i for i in range(1, 10)})
KEYS.update(
    {
        "0": 39,
        "ENTER": 40,
        "ESC": 41,
        "BACKSPACE": 42,
        "TAB": 43,
        "SPACE": 44,
        "DELETE": 76,
        "RIGHT": 79,
        "LEFT": 80,
        "DOWN": 81,
        "UP": 82,
        "HOME": 74,
        "END": 77,
        "PAGEUP": 75,
        "PAGEDOWN": 78,
        "CAPSLOCK": 57,
    }
)
KEYS.update({f"F{i}": 57 + i for i in range(1, 13)})
MODS = {
    "NONE": 0,
    "CTRL": 1,
    "SHIFT": 2,
    "ALT": 4,
    "GUI": 8,
    "ALTGR": 64,
    "CTRL_SHIFT": 3,
    "CTRL_ALT": 5,
    "GUI_SHIFT": 10,
    "CTRL_GUI": 9,
}
OPS = (
    "wait text key hold release url shortcut led blink pin_write pwm pin_if repeat forever os_if comment"
).split()
SHORTCUTS = {
    "copy": ("C", 1),
    "paste": ("V", 1),
    "cut": ("X", 1),
    "select_all": ("A", 1),
    "undo": ("Z", 1),
    "save": ("S", 1),
    "new_tab": ("T", 1),
    "address": ("L", 1),
    "close_tab": ("W", 1),
    "fullscreen": ("F11", 0),
}


class InvalidProject(ValueError):
    pass


def integer(value, low, high, label):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or int(value) != value
        or not low <= value <= high
    ):
        raise InvalidProject(f"{label}: use an integer between {low} and {high}.")
    return int(value)


def choice(value, allowed, label):
    if value not in allowed:
        raise InvalidProject(f"Invalid {label}: {value!r}")
    return value


def string(value, limit=1500):
    if not isinstance(value, str) or len(value) > limit:
        raise InvalidProject("Text is too long or invalid.")
    return value


def cpp_text(value):
    # This version of DigiKeyboard maps single bytes, not UTF-8.
    # Keep the supported ASCII subset explicit instead of emitting broken accents.
    value = string(value)
    if any(ord(c) > 126 or (ord(c) < 32 and c not in "\n\t") for c in value):
        raise InvalidProject(
            "DigiKeyboard: use ASCII text (no emoji or accents). Symbols use the selected layout."
        )
    return (
        '"'
        + value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\t", "\\t")
        + '"'
    )


def generate(project):
    if not isinstance(project, dict):
        raise InvalidProject("Invalid project.")
    settings = project.get("settings", {})
    if not isinstance(settings, dict):
        raise InvalidProject("Invalid settings.")
    target = choice(
        settings.get("os", "windows"), ["windows", "linux", "mac"], "Operating system"
    )
    layout = choice(settings.get("layout", "ITALIAN"), LAYOUTS, "Layout")
    layout_mode = choice(
        settings.get("layoutMode", "single"), ["single", "sweep"], "Keyboard mode"
    )
    layout_pause = integer(
        settings.get("layoutPause", 1500), 0, 60000, "Pause between layouts"
    )
    sweep = layout_mode == "sweep"
    layout_order = [layout] + [name for name in LAYOUTS if name != layout]
    led = integer(settings.get("ledPin", 1), 0, 1, "LED pin")
    startup = integer(settings.get("startup", 2500), 0, 60000, "Startup delay")
    inputs = settings.get("inputs", {})
    if not isinstance(inputs, dict):
        raise InvalidProject("Invalid simulated inputs.")
    inputs = {
        str(pin): integer(inputs.get(str(pin), 0), 0, 1, "Input") for pin in (0, 1, 2)
    }
    nodes = project.get("nodes", [])
    count = 0
    warnings = []

    def warn(s):
        if s not in warnings:
            warnings.append(s)

    def validate(items, depth=0):
        nonlocal count
        if not isinstance(items, list) or depth > 8:
            raise InvalidProject("Structure is too deeply nested (8 levels maximum).")
        clean = []
        for pos, raw in enumerate(items):
            count += 1
            if count > 250:
                raise InvalidProject("A project can contain up to 250 blocks.")
            if not isinstance(raw, dict):
                raise InvalidProject("Invalid block.")
            n = dict(raw)
            op = choice(n.get("op"), OPS, "Module")
            n["id"] = string(n.get("id", ""), 100)
            if op in ("wait", "blink"):
                n["ms"] = integer(n.get("ms", 500), 1, 600000, "Duration")
            if op in ("repeat", "blink"):
                n["count"] = integer(n.get("count", 3), 1, 1000, "Repetitions")
            if op == "text":
                cpp_text(n.get("text", ""))
                n["text"] = n.get("text", "")
            if op in ("key", "hold"):
                n["key"] = choice(n.get("key", "ENTER"), KEYS, "Key")
                n["mods"] = choice(n.get("mods", "NONE"), MODS, "Modifiers")
                warn(
                    "Key blocks use physical HID positions; use Type text for characters and symbols."
                )
            if op == "url":
                n["url"] = string(n.get("url", ""), 500)
                cpp_text(n["url"])
                u = urlparse(n["url"])
                if (
                    u.scheme not in ("http", "https")
                    or not u.hostname
                    or re.search(r'[\s"\'<>`\\]', n["url"])
                ):
                    raise InvalidProject(
                        "Open URL requires a valid HTTP(S) address without spaces or quotes."
                    )
                n["target"] = choice(
                    n.get("target", "project"),
                    ["project", "windows", "linux", "mac", "all"],
                    "URL target",
                )
                if n["target"] == "all":
                    warn(
                        "All attempts are sent, even if the first succeeds. They may interfere with the active window."
                    )
                warn(
                    "URL opening is intended, not verified. Spotlight and Linux launchers depend on the computer configuration."
                )
            if op == "shortcut":
                n["action"] = choice(n.get("action", "copy"), SHORTCUTS, "Shortcut")
            if op in ("led", "pin_write"):
                n["value"] = integer(n.get("value", 1), 0, 1, "State")
            if op in ("pin_write", "pwm", "pin_if"):
                n["pin"] = integer(
                    n.get("pin", 0), 0, 2, "Pin (P3/P4 reserved for USB, P5 reset)"
                )
                if n["pin"] == led:
                    warn(
                        f"P{led} also drives the built-in LED: GPIO and LED actions share this pin."
                    )
            if op == "pwm":
                if n["pin"] not in (0, 1):
                    raise InvalidProject("PWM is available on P0 and P1.")
                n["value"] = integer(n.get("value", 128), 0, 255, "PWM")
            if op == "pin_if":
                n["value"] = integer(n.get("value", 1), 0, 1, "Input")
                n["pullup"] = bool(n.get("pullup", True))
            if op == "os_if":
                n["target"] = choice(
                    n.get("target", "windows"),
                    ["windows", "linux", "mac"],
                    "Branch OS",
                )
            if op in ("repeat", "forever", "pin_if", "os_if"):
                n["body"] = validate(n.get("body", []), depth + 1)
            if op in ("pin_if", "os_if"):
                n["else"] = validate(n.get("else", []), depth + 1)
            if op == "forever" and pos != len(items) - 1:
                raise InvalidProject("Forever must be the last block in its sequence.")
            if op == "comment":
                n["text"] = string(n.get("text", ""), 500)
            clean.append(n)
        return clean

    nodes = validate(nodes)
    # Keep the usual final LED loop after the sweep, otherwise the first
    # layout would trap execution and every later attempt would be unreachable.
    attempt_nodes = (
        nodes[:-1] if sweep and nodes and nodes[-1]["op"] == "forever" else nodes
    )
    final_nodes = nodes[-1:] if sweep and nodes and nodes[-1]["op"] == "forever" else []

    def contains_forever(items):
        return any(
            n["op"] == "forever"
            or contains_forever(n.get("body", []))
            or contains_forever(n.get("else", []))
            for n in items
        )

    if sweep:
        if contains_forever(attempt_nodes):
            raise InvalidProject(
                "Try all: move Forever to the end of On start, outside other blocks, to allow all 15 attempts."
            )
        warn(
            "Try all layouts: the sequence repeats 15 times without detecting the correct layout. Attempts may type incorrect characters or open multiple windows."
        )
        warn(
            "The selected layout is tried first. A final Forever block runs once after all attempts, using the initial layout."
        )
    printer = "studioPrint" if sweep else "DigiKeyboard.print"

    def shortcut(action):
        key, mod = SHORTCUTS[action]
        if target == "mac":
            mod = 8 if mod == 1 else mod
            if action == "fullscreen":
                key, mod = "F", 9
        return key, mod

    def emit(items, depth=1):
        lines = []
        indent = "  " * depth
        for n in items:
            op = n["op"]
            code = []
            if op == "wait":
                code = [f'DigiKeyboard.delay({n["ms"]}UL);']
            elif op == "text":
                code = [f'{printer}(F({cpp_text(n["text"])}));']
            elif op in ("key", "hold"):
                code = [
                    f'DigiKeyboard.{"sendKeyStroke" if op=="key" else "sendKeyPress"}({KEYS[n["key"]]}, {MODS[n["mods"]]});'
                ]
            elif op == "release":
                code = ["DigiKeyboard.sendKeyPress(0, 0);"]
            elif op == "url":
                systems = (
                    ["windows", "linux", "mac"]
                    if n["target"] == "all"
                    else [target if n["target"] == "project" else n["target"]]
                )
                for osname in systems:
                    k, m = {
                        "windows": (KEYS["R"], 8),
                        "linux": (KEYS["F2"], 4),
                        "mac": (KEYS["SPACE"], 8),
                    }[osname]
                    code += [
                        f"// Open URL: {osname}",
                        "DigiKeyboard.sendKeyStroke(41);",
                        "DigiKeyboard.delay(300);",
                        f"DigiKeyboard.sendKeyStroke({k}, {m});",
                        "DigiKeyboard.delay(1500);",
                    ]
                    if osname == "linux":
                        code += [f'{printer}(F("xdg-open "));']
                    code += [
                        f'{printer}(F({cpp_text(n["url"])}));',
                        "DigiKeyboard.delay(1200);",
                        "DigiKeyboard.sendKeyStroke(40);",
                        "DigiKeyboard.delay(6000);",
                    ]
            elif op == "shortcut":
                k, m = shortcut(n["action"])
                code = [f"DigiKeyboard.sendKeyStroke({KEYS[k]}, {m});"]
            elif op in ("led", "pin_write", "pwm"):
                pin = led if op == "led" else n["pin"]
                code = [
                    f"pinMode({pin}, OUTPUT);",
                    f'{"analogWrite" if op=="pwm" else "digitalWrite"}({pin}, {n["value"]});',
                ]
            elif op == "blink":
                code = [
                    f"pinMode({led}, OUTPUT);",
                    f'for (uint16_t blink = 0; blink < {n["count"]}; ++blink) {{',
                    f"  digitalWrite({led}, HIGH);",
                    f'  DigiKeyboard.delay({n["ms"]}UL);',
                    f"  digitalWrite({led}, LOW);",
                    f'  DigiKeyboard.delay({n["ms"]}UL);',
                    "}",
                ]
            elif op in ("repeat", "forever"):
                lines.append(
                    indent
                    + (
                        f'for (uint16_t i{depth}=0; i{depth}<{n["count"]}; ++i{depth}) {{'
                        if op == "repeat"
                        else "while (true) {"
                    )
                )
                lines += emit(n["body"], depth + 1)
                lines.append(indent + "  DigiKeyboard.delay(1);")
                lines.append(indent + "}")
                continue
            elif op == "os_if":
                lines.append(
                    indent + f"// Project OS: {target} (no automatic detection)"
                )
                lines += emit(n["body"] if target == n["target"] else n["else"], depth)
                continue
            elif op == "pin_if":
                lines += [
                    indent
                    + f'pinMode({n["pin"]}, {"INPUT_PULLUP" if n["pullup"] else "INPUT"});',
                    indent + f'if (digitalRead({n["pin"]}) == {n["value"]}) {{',
                ]
                lines += emit(n["body"], depth + 1)
                lines.append(indent + "} else {")
                lines += emit(n["else"], depth + 1)
                lines.append(indent + "}")
                continue
            elif op == "comment":
                code = ["// " + line for line in n["text"].splitlines()]
            lines += [indent + c for c in code]
        return lines

    code = "\n".join(
        [
            "// Generated by Digispark Studio — ATtiny85, USB 16.5 MHz",
            f"// OS: {target}; layout: {layout}. No automatic detection.",
            f"#define LAYOUT_{layout}",
            '#include "DigiKeyboard.h"',
            "",
            "void setup() {",
            f"  pinMode({led}, OUTPUT);",
            f"  digitalWrite({led}, LOW);",
            f"  DigiKeyboard.delay({startup}UL);",
            "  DigiKeyboard.sendKeyStroke(0);",
        ]
        + emit(nodes)
        + [
            "  DigiKeyboard.sendKeyPress(0, 0);",
            "}",
            "",
            "void loop() {",
            "  DigiKeyboard.delay(20);",
            "}",
            "",
        ]
    )
    if sweep:
        maps = json.loads((Path(__file__).parent / "data/layout_maps.json").read_text())
        tables = [
            "// Order: " + ", ".join(layout_order),
            maps["license"],
            "const uint8_t studioMaps[15][96] PROGMEM = {",
        ]
        for name in layout_order:
            tables += [
                "  // " + name,
                "  {" + ", ".join(str(v) for v in maps["maps"][name]) + "},",
            ]
        tables += [
            "};",
            "uint8_t studioLayout = 0;",
            """
void studioPrint(const __FlashStringHelper* value) {
  const char* ptr = reinterpret_cast<const char*>(value);
  uint8_t c;
  while ((c = pgm_read_byte(ptr++)) != 0) {
    if (c == '\\n') { DigiKeyboard.sendKeyStroke(40); continue; }
    if (c == '\\t') { DigiKeyboard.sendKeyStroke(43); continue; }
    if (c < 32 || c > 126) continue;
    uint8_t packed = pgm_read_byte(&studioMaps[studioLayout][c - 32]);
    if (!packed) continue;
    uint8_t key = packed & 0x3F;
    if (key == 0x3F) key = 0x64;
    uint8_t modifiers = ((packed & 0x40) ? 0x02 : 0) | ((packed & 0x80) ? 0x40 : 0);
    DigiKeyboard.sendKeyStroke(key, modifiers);
  }
}
""",
        ]
        code = "\n".join(
            [
                "// Digispark Studio: try all 15 layouts; no automatic detection.",
                f"#define LAYOUT_{layout}",
                '#include "DigiKeyboard.h"',
            ]
            + tables
            + [
                "void setup() {",
                f"  pinMode({led}, OUTPUT);",
                f"  digitalWrite({led}, LOW);",
                f"  DigiKeyboard.delay({startup}UL);",
                "  for (studioLayout = 0; studioLayout < 15; ++studioLayout) {",
                "    DigiKeyboard.sendKeyPress(0, 0);",
            ]
            + emit(attempt_nodes, 2)
            + [
                "    DigiKeyboard.sendKeyPress(0, 0);",
                f"    if (studioLayout < 14) DigiKeyboard.delay({layout_pause}UL);",
                "  }",
                "  studioLayout = 0; // Restore the selected layout",
            ]
            + emit(final_nodes)
            + [
                "  DigiKeyboard.sendKeyPress(0, 0);",
                "}",
                "void loop() { DigiKeyboard.delay(20); }",
                "",
            ]
        )
    events = []
    truncated = False

    def event(n, kind, label, ms=150, **data):
        nonlocal truncated
        if len(events) >= 1500:
            truncated = True
            return
        events.append(dict(id=n.get("id", ""), kind=kind, label=label, ms=ms, **data))

    event({}, "wait", "USB connection", startup)

    def trace(items):
        for n in items:
            if len(events) >= 1500:
                return False
            op = n["op"]
            if op == "wait":
                event(n, "wait", f'Wait {n["ms"]} ms', n["ms"])
            elif op == "text":
                event(
                    n,
                    "text",
                    "Type text",
                    max(150, len(n["text"]) * 35),
                    text=n["text"],
                )
            elif op in ("key", "hold"):
                event(n, op, n["mods"] + " + " + n["key"], key=n["key"], mods=n["mods"])
            elif op == "release":
                event(n, "release", "Release keys")
            elif op == "shortcut":
                k, m = shortcut(n["action"])
                event(
                    n,
                    "key",
                    n["action"],
                    key=k,
                    mods=next((x for x, v in MODS.items() if v == m), "NONE"),
                )
            elif op == "url":
                systems = (
                    ["windows", "linux", "mac"]
                    if n["target"] == "all"
                    else [target if n["target"] == "project" else n["target"]]
                )
                for osname in systems:
                    event(
                        n,
                        "url",
                        f"Open URL · {osname}",
                        9000,
                        url=n["url"],
                        target=osname,
                    )
            elif op in ("led", "pin_write", "pwm"):
                event(
                    n,
                    "pin",
                    f'{op} · {n["value"]}',
                    pin=led if op == "led" else n["pin"],
                    value=n["value"],
                )
            elif op == "blink":
                for _ in range(n["count"]):
                    event(n, "pin", "LED on", n["ms"], pin=led, value=1)
                    event(n, "pin", "LED off", n["ms"], pin=led, value=0)
                    if len(events) >= 1500:
                        break
            elif op in ("repeat", "forever"):
                for _ in range(3 if op == "forever" else n["count"]):
                    if trace(n["body"]) is False:
                        return False
                    event(n, "wait", "USB service", 1)
                    if len(events) >= 1500:
                        return False
                if op == "forever":
                    event(
                        n,
                        "end",
                        "Preview: 3 loops. Runs forever on the board.",
                        0,
                    )
                    return False
            elif op in ("os_if", "pin_if"):
                matches = (
                    target == n["target"]
                    if op == "os_if"
                    else inputs[str(n["pin"])] == n["value"]
                )
                event(n, "branch", "True branch" if matches else "False branch")
                if trace(n["body"] if matches else n["else"]) is False:
                    return False
            elif op == "comment":
                event(n, "comment", n["text"], 0)
        return True

    if sweep:
        for index, name in enumerate(layout_order):
            event(
                {}, "layout", f"Layout {index+1}/15 · {LAYOUTS[name]}", 0, layout=name
            )
            trace(attempt_nodes)
            event({}, "release", "Release keys", 0)
            if index < 14:
                event({}, "wait", "Pause between layouts", layout_pause)
        if final_nodes:
            event(
                {},
                "layout",
                f"Attempts complete · returning to {LAYOUTS[layout]}",
                0,
                layout=layout,
            )
            trace(final_nodes)
    else:
        trace(nodes)
    if truncated or len(events) >= 1500:
        warn("Preview limited to 1,500 events. Exported code retains all repetitions.")
    warn(
        "Simulation describes the blocks; it does not emulate firmware or the computer. Video autoplay and shortcut results are not guaranteed."
    )
    return dict(
        code=code,
        events=events,
        warnings=warnings,
        blocks=count,
        duration=sum(e["ms"] for e in events),
        settings=dict(
            os=target,
            layout=layout,
            layoutMode=layout_mode,
            layoutPause=layout_pause,
            ledPin=led,
            startup=startup,
            inputs=inputs,
        ),
    )
