"""Runs scripts/check_pr_description.py as CI does and checks its verdict."""

import os
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_pr_description.py")

# A real appendix in the current format, as no-mistakes wrote it on PR #3. Its
# sha256= value was computed by no-mistakes, not by the checker under test.
APPENDIX_V1 = (Path(__file__).parent / "testdata" / "no_mistakes_appendix_v1.md").read_text()

APPENDIX = (
    "\n## Pipeline\n\n"
    "Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)\n\n"
    '<!-- no-mistakes-pipeline-attestation:v1 {"head_sha":"abc"} -->\n'
    + "<details><summary>Review</summary>log</details>\n" * 50
)


def run_check(pr_body: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        env={**os.environ, "PR_BODY": pr_body},
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

    def test_excludes_no_mistakes_appendix(self):
        self.assertEqual(run_check("Short summary.\n" + APPENDIX).returncode, 0)

    def test_long_text_before_appendix_still_fails(self):
        self.assertEqual(run_check("a" * 501 + "\n" + APPENDIX).returncode, 1)

    def test_excludes_html_comments(self):
        body = "<!-- guidance " + "x" * 1000 + " -->\nShort summary."
        self.assertEqual(run_check(body).returncode, 0)

    def test_excludes_appendix_in_crlf_body(self):
        body = ("a" * 490 + "\n" + APPENDIX).replace("\n", "\r\n")
        self.assertEqual(run_check(body).returncode, 0)

    def test_appendix_marker_comment_does_not_end_description(self):
        body = "<!-- no-mistakes-pr-appendix -->\n" + "a" * 501
        self.assertEqual(run_check(body).returncode, 1)

    def test_excludes_v1_appendix_block(self):
        # The appendix's visible text alone is about 350 characters.
        body = "## Summary\n\n" + "a" * 480 + "\n\n" + APPENDIX_V1
        self.assertEqual(run_check(body).returncode, 0)

    def test_long_text_before_v1_appendix_still_fails(self):
        result = run_check("a" * 501 + "\n\n" + APPENDIX_V1)
        self.assertEqual(result.returncode, 1)
        self.assertIn("501 characters", result.stderr)

    def test_excludes_v1_appendix_in_crlf_body(self):
        body = ("a" * 490 + "\n\n" + APPENDIX_V1).replace("\n", "\r\n")
        self.assertEqual(run_check(body).returncode, 0)

    def test_v1_appendix_with_edited_content_counts(self):
        tampered = APPENDIX_V1.replace("Low:", "Low: " + "b" * 600)
        self.assertEqual(run_check("Short summary.\n\n" + tampered).returncode, 1)

    def test_text_after_v1_appendix_counts(self):
        body = "Short summary.\n\n" + APPENDIX_V1 + "\n" + "a" * 501
        self.assertEqual(run_check(body).returncode, 1)

    def test_unrelated_pipeline_heading_still_counts(self):
        body = "## Pipeline\n\nThe crawl stage " + "a" * 500
        self.assertEqual(run_check(body).returncode, 1)


if __name__ == "__main__":
    unittest.main()
