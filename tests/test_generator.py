import unittest
from generator import generate, InvalidProject
from app import app


class GeneratorTests(unittest.TestCase):
    def p(self, nodes, **settings):
        return {"nodes": nodes, "settings": settings}

    def test_layout_and_text_escaping(self):
        result = generate(
            self.p([{"op": "text", "text": '"hello"\\\n'}], layout="ITALIAN")
        )
        self.assertIn("#define LAYOUT_ITALIAN", result["code"])
        self.assertIn('\\"hello\\"\\\\\\n', result["code"])

    def test_macos_shortcut(self):
        self.assertIn(
            "sendKeyStroke(6, 8)",
            generate(self.p([{"op": "shortcut", "action": "copy"}], os="mac"))["code"],
        )
        self.assertIn(
            "sendKeyStroke(6, 1)",
            generate(self.p([{"op": "shortcut", "action": "copy"}], os="linux"))[
                "code"
            ],
        )

    def test_os_branch(self):
        n = {
            "op": "os_if",
            "target": "mac",
            "body": [{"op": "text", "text": "YES"}],
            "else": [{"op": "text", "text": "NO"}],
        }
        result = generate(self.p([n], os="mac"))
        self.assertIn('F("YES")', result["code"])
        self.assertNotIn('F("NO")', result["code"])
        self.assertEqual(
            [e["text"] for e in result["events"] if e["kind"] == "text"], ["YES"]
        )

    def test_input_branch(self):
        n = {
            "op": "pin_if",
            "pin": 2,
            "value": 0,
            "body": [{"op": "led", "value": 1}],
            "else": [],
        }
        result = generate(self.p([n], inputs={"2": 0}))
        self.assertIn("INPUT_PULLUP", result["code"])
        self.assertTrue(
            any(e["kind"] == "pin" and e["value"] == 1 for e in result["events"])
        )

    def test_usb_pins_rejected(self):
        for pin in [3, 4, 5, -1, 1.5, True]:
            with self.assertRaises(InvalidProject):
                generate(self.p([{"op": "pin_write", "pin": pin}]))

    def test_bad_url_rejected(self):
        for url in [
            "javascript:alert(1)",
            "https://example.com a",
            "file:///etc/passwd",
            'https://example.com/"x',
        ]:
            with self.assertRaises(InvalidProject):
                generate(self.p([{"op": "url", "url": url}]))

    def test_unicode_rejected(self):
        with self.assertRaises(InvalidProject):
            generate(self.p([{"op": "text", "text": "hello 🌞"}]))

    def test_url_os_and_all(self):
        r = generate(
            self.p([{"op": "url", "url": "https://example.com", "target": "all"}])
        )
        self.assertIn("xdg-open", r["code"])
        self.assertEqual(len([e for e in r["events"] if e["kind"] == "url"]), 3)

    def test_forever_preview_and_unreachable(self):
        r = generate(
            self.p(
                [{"op": "forever", "body": [{"op": "blink", "count": 1, "ms": 500}]}]
            )
        )
        self.assertEqual(len([e for e in r["events"] if e["kind"] == "pin"]), 6)
        self.assertEqual(r["events"][-1]["kind"], "end")
        with self.assertRaises(InvalidProject):
            generate(self.p([{"op": "forever"}, {"op": "text", "text": "unreachable"}]))

    def test_bounds(self):
        with self.assertRaises(InvalidProject):
            generate(self.p([{"op": "wait", "ms": -1}]))
        with self.assertRaises(InvalidProject):
            generate(self.p([{"op": "release"}] * 251))
        self.assertLessEqual(
            len(generate(self.p([{"op": "blink", "count": 1000, "ms": 1}]))["events"]),
            1500,
        )

    def test_api(self):
        c = app.test_client()
        self.assertEqual(
            c.post("/api/generate", json=self.p([{"op": "release"}])).status_code, 200
        )
        self.assertEqual(
            c.post("/api/generate", json=self.p([{"op": "unknown"}])).status_code, 400
        )
        self.assertEqual(
            c.post(
                "/api/generate", json={}, headers={"Origin": "https://other.example"}
            ).status_code,
            403,
        )
        self.assertEqual(
            c.get("/", headers={"Host": "malicious.example"}).status_code, 403
        )
        self.assertEqual(c.post("/api/compile", json={"code": 12}).status_code, 400)


class LayoutSweepTests(unittest.TestCase):
    def test_sweep_tables_order_and_final_loop(self):
        r = generate(
            {
                "settings": {
                    "layoutMode": "sweep",
                    "layout": "US_ENGLISH",
                    "layoutPause": 700,
                },
                "nodes": [
                    {"op": "text", "text": "Test :/?"},
                    {"op": "forever", "body": [{"op": "blink", "count": 1, "ms": 500}]},
                ],
            }
        )
        self.assertIn("studioMaps[15][96] PROGMEM", r["code"])
        self.assertIn('studioPrint(F("Test :/?"))', r["code"])
        self.assertIn("DigiKeyboard.delay(700UL)", r["code"])
        self.assertLess(
            r["code"].index("studioLayout = 0; // Restore"),
            r["code"].index("while (true)"),
        )
        layouts = [e["layout"] for e in r["events"] if e["kind"] == "layout"]
        self.assertEqual(len(set(layouts)), 15)
        self.assertEqual(layouts[0], "US_ENGLISH")
        self.assertEqual(layouts[-1], "US_ENGLISH")
        self.assertEqual(len([e for e in r["events"] if e["kind"] == "text"]), 15)
        self.assertEqual(len([e for e in r["events"] if e["kind"] == "pin"]), 6)

    def test_nested_infinite_loop_rejected_for_sweep(self):
        with self.assertRaisesRegex(InvalidProject, "move Forever"):
            generate(
                {
                    "settings": {"layoutMode": "sweep"},
                    "nodes": [
                        {"op": "repeat", "count": 2, "body": [{"op": "forever"}]}
                    ],
                }
            )

    def test_old_projects_remain_single_layout(self):
        r = generate({"nodes": [{"op": "text", "text": "Hello"}]})
        self.assertNotIn("studioMaps", r["code"])
        self.assertEqual(r["settings"]["layoutMode"], "single")

    def test_invalid_sweep_settings_rejected(self):
        for settings in [
            {"layoutMode": "auto"},
            {"layoutPause": -1},
            {"layoutPause": True},
        ]:
            with self.assertRaises(InvalidProject):
                generate({"settings": settings})

    def test_packed_maps_have_different_punctuation(self):
        import json
        from pathlib import Path

        maps = json.loads(
            (Path(__file__).resolve().parents[1] / "data/layout_maps.json").read_text()
        )["maps"]
        self.assertEqual(len(maps), 15)
        self.assertTrue(
            all(len(m) == 96 and all(0 <= b < 256 for b in m) for m in maps.values())
        )
        self.assertNotEqual(
            maps["ITALIAN"][ord(":") - 32], maps["US_ENGLISH"][ord(":") - 32]
        )


if __name__ == "__main__":
    unittest.main()
