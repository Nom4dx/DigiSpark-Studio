"""Optional integration check: compile every offered layout against installed core."""

import json, sys, urllib.request, os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from generator import LAYOUTS, generate

results = {}
for layout in LAYOUTS:
    code = generate(
        {
            "settings": {"layout": layout},
            "nodes": [
                {"op": "text", "text": "Hello 123 :/?=&"},
                {"op": "blink", "count": 2, "ms": 200},
            ],
        }
    )["code"]
    req = urllib.request.Request(
        os.environ.get("BASE_URL", "http://127.0.0.1:5055") + "/api/compile",
        data=json.dumps({"code": code}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=95) as r:
        result = json.load(r)
    results[layout] = {
        "ok": result.get("ok", False),
        "output": result.get("output", result.get("error", "")),
    }
    print(layout, results[layout]["ok"], flush=True)
Path("tests/layout-results.json").write_text(json.dumps(results, indent=2))
assert all(r["ok"] for r in results.values())
