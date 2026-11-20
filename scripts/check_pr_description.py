#!/usr/bin/env python3
"""Fails when a pull request description is longer than 500 characters.

Usage: PR_BODY="..." scripts/check_pr_description.py

What counts is the text a reader sees above the no-mistakes "Pipeline" appendix:
the appendix is written and owned by the no-mistakes gate (pipeline log and a
machine-readable attestation comment) and cannot be shortened, so it is excluded.
HTML comments are excluded too, so a template can carry guidance that is not shown.
"""

import os
import re
import sys

MAX_PR_DESCRIPTION_CHARACTERS = 500

HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
# The appendix starts at a "## Pipeline" heading whose next non-blank line links to
# no-mistakes.
NO_MISTAKES_APPENDIX = re.compile(
    r"^## Pipeline[ \t]*\n\s*[^\n]*no-mistakes", re.MULTILINE
)


def visible_description(pr_body: str) -> str:
    pr_body = pr_body.replace("\r\n", "\n")
    appendix = NO_MISTAKES_APPENDIX.search(pr_body)
    if appendix:
        pr_body = pr_body[: appendix.start()]
    return HTML_COMMENT.sub("", pr_body).strip()


def main() -> int:
    description = visible_description(os.environ.get("PR_BODY", ""))
    length = len(description)
    if length > MAX_PR_DESCRIPTION_CHARACTERS:
        print(
            f"PR description is {length} characters; the limit is "
            f"{MAX_PR_DESCRIPTION_CHARACTERS} (excluding the no-mistakes Pipeline "
            "section and HTML comments). Shorten it with `gh pr edit --body-file`.",
            file=sys.stderr,
        )
        return 1
    print(f"PR description is {length}/{MAX_PR_DESCRIPTION_CHARACTERS} characters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
