# Third-party components

- Blockly 12.3.1 — Apache License 2.0. https://github.com/RaspberryPiFoundation/blockly
- CodeMirror 6, @codemirror and @lezer modules — MIT. https://github.com/codemirror/dev
- style-mod, w3c-keyname, crelt — MIT, editor dependencies.
- Flask 3.1.2 — BSD-3-Clause. https://github.com/pallets/flask
- esbuild — MIT (build tool).
- Playwright — Apache-2.0 (tests only).

Blockly, CodeMirror, and editor dependency licenses are included in `static/licenses`. Installed packages retain their own licenses in `node_modules`.

Ardublockly and DigistumpArduino are reference sources. The Arduino core is not redistributed with the website; the application uses the user's installation.

## Multiple keyboard layout tables

`data/layout_maps.json` contains ASCII mappings extracted from DigistumpArduino 1.7.5 `keylayouts.h`, derived from Teensyduino. Copyright (c) 2013 PJRC.COM, LLC., 2021 Armin.joachimsmeyer@gmail.com. The complete two-condition license is included in `static/licenses/digistump-keylayouts-LICENSE`, in the JSON, and in sweep-mode sketches. The application's hardware target remains ATtiny85 Digispark.
