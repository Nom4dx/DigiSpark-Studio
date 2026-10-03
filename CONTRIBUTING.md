# Contributing

Use Python 3.10+ and Node.js 22+. Create a virtual environment, install `requirements-dev.txt`, then run `npm ci`.

Before proposing a change:

```bash
python -m black .
npm run format
npm run build
python -m unittest discover -s tests -v
npm run test:ui
```

Playwright starts Flask automatically if it is not already running. Use `PYTHON` to select the interpreter, `CHROMIUM_PATH` for a local browser, and `BASE_URL` for a different address or port. If Chromium is unavailable, run `npx playwright install chromium`.

Compilation tests require Arduino CLI and Digistump core 1.7.5. A test skipped because the compiler is unavailable is not firmware verification. Standard CI checks the UI and generator without hardware and does not install the obsolete core.

Edit sources in `frontend/`, not the bundle. Include the updated build in `static/` so the application can run without Node.js. Keep the interface, documentation, examples, and generated messages in English. Do not include personal projects, logs, installed dependencies, tokens, or machine-specific paths.

The blocks-to-C++ flow is one-way: preserve manual editor changes and explain that simulation uses blocks. Do not claim automatic OS/layout detection without actual device feedback. Preserve saved project identifiers and user-entered content when changing interface text.
