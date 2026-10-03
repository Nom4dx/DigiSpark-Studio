import json
import subprocess
import unittest
from unittest.mock import patch
from app import app, compiler_info


class CompilerTests(unittest.TestCase):
    @patch("app.find_cli", return_value=None)
    def test_no_cli(self, _):
        self.assertFalse(compiler_info()["compiler"])
        self.assertEqual(
            app.test_client()
            .post("/api/compile", json={"code": "void setup(){} void loop(){}"})
            .status_code,
            503,
        )

    @patch("app.find_cli", return_value="arduino-cli")
    @patch("app.subprocess.run")
    def test_indexed_core_is_not_installed(self, run, _):
        run.return_value = subprocess.CompletedProcess(
            [],
            0,
            json.dumps(
                {"platforms": [{"id": "digistump:avr", "releases": {"1.7.5": {}}}]}
            ),
            "",
        )
        self.assertFalse(compiler_info()["compiler"])
        self.assertIn("missing", compiler_info()["reason"])

    @patch("app.find_cli", return_value="arduino-cli")
    @patch("app.subprocess.run")
    def test_installed_core_is_ready(self, run, _):
        run.return_value = subprocess.CompletedProcess(
            [],
            0,
            json.dumps(
                {"platforms": [{"id": "digistump:avr", "installed_version": "1.7.5"}]}
            ),
            "",
        )
        self.assertTrue(compiler_info()["compiler"])

    @patch("app.find_cli", return_value="arduino-cli")
    @patch("app.subprocess.run", side_effect=subprocess.TimeoutExpired("cli", 10))
    def test_timeout_is_not_reported_as_ready(self, run, _):
        self.assertFalse(compiler_info()["compiler"])
