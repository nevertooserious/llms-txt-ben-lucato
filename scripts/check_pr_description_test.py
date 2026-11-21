"""Runs scripts/check_pr_description.py as CI does and checks its verdict."""

import os
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_pr_description.py")


def run_check(pr_body: str | None) -> subprocess.CompletedProcess:
    """Runs the check with PR_BODY set to `pr_body`, or unset when it is None."""
    env = {name: value for name, value in os.environ.items() if name != "PR_BODY"}
    if pr_body is not None:
        env["PR_BODY"] = pr_body
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
    )


class CheckPrDescriptionTest(unittest.TestCase):
    def test_accepts_exactly_500_characters(self):
        self.assertEqual(run_check("a" * 500).returncode, 0)

    def test_rejects_501_characters(self):
        result = run_check("a" * 501)
        self.assertEqual(result.returncode, 1)
        self.assertIn("501 characters", result.stderr)

    def test_counts_characters_not_bytes(self):
        self.assertEqual(run_check("é" * 500).returncode, 0)

    def test_accepts_empty_or_missing_body(self):
        self.assertEqual(run_check("").returncode, 0)
        self.assertEqual(run_check(None).returncode, 0)

    def test_excludes_html_comments(self):
        body = "<!-- guidance " + "x" * 1000 + " -->\nShort summary."
        self.assertEqual(run_check(body).returncode, 0)

    def test_crlf_line_endings_count_once(self):
        self.assertEqual(run_check("a\r\n" * 250).returncode, 0)


if __name__ == "__main__":
    unittest.main()
