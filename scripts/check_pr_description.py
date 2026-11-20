#!/usr/bin/env python3
"""Fails when a pull request description is longer than 500 characters.

Usage: PR_BODY="..." scripts/check_pr_description.py

What counts is the text a reader sees above the no-mistakes appendix: the
appendix is written and owned by the no-mistakes gate (risk summary, pipeline log
and a machine-readable attestation comment) and cannot be shortened, so it is
excluded. HTML comments are excluded too, so a template can carry guidance that is
not shown.

no-mistakes has written the appendix in two formats:
  - current: a block between `<!-- no-mistakes-pr-appendix:v1 sha256=<hex> -->` and
    `<!-- /no-mistakes-pr-appendix:v1 -->` at the end of the body, where <hex> is the
    SHA-256 of the text between the markers. Excluded only when the block is the end
    of the body and the hash matches, so a stray or hand-written marker cannot hide
    a long description.
  - older: everything from a "## Pipeline" heading whose next non-blank line
    mentions no-mistakes.
"""

import hashlib
import os
import re
import sys

MAX_PR_DESCRIPTION_CHARACTERS = 500

HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
NO_MISTAKES_APPENDIX_BLOCK = re.compile(
    r"<!-- no-mistakes-pr-appendix:v1 sha256=(?P<sha256>[0-9a-f]{64}) -->"
    r"(?P<content>.*?)"
    r"<!-- /no-mistakes-pr-appendix:v1 -->\s*\Z",
    re.DOTALL,
)
# The older appendix starts at a "## Pipeline" heading whose next non-blank line mentions
# no-mistakes.
NO_MISTAKES_PIPELINE_HEADING = re.compile(
    r"^## Pipeline[ \t]*\n\s*[^\n]*no-mistakes", re.MULTILINE
)


def without_appendix(pr_body: str) -> str:
    block = NO_MISTAKES_APPENDIX_BLOCK.search(pr_body)
    if block:
        content_sha256 = hashlib.sha256(block["content"].strip().encode()).hexdigest()
        if content_sha256 == block["sha256"]:
            return pr_body[: block.start()]
    heading = NO_MISTAKES_PIPELINE_HEADING.search(pr_body)
    if heading:
        return pr_body[: heading.start()]
    return pr_body


def visible_description(pr_body: str) -> str:
    pr_body = pr_body.replace("\r\n", "\n")
    return HTML_COMMENT.sub("", without_appendix(pr_body)).strip()


def main() -> int:
    description = visible_description(os.environ.get("PR_BODY", ""))
    length = len(description)
    if length > MAX_PR_DESCRIPTION_CHARACTERS:
        print(
            f"PR description is {length} characters; the limit is "
            f"{MAX_PR_DESCRIPTION_CHARACTERS} (excluding the no-mistakes appendix "
            "and HTML comments). Shorten it with `gh pr edit --body-file`.",
            file=sys.stderr,
        )
        return 1
    print(f"PR description is {length}/{MAX_PR_DESCRIPTION_CHARACTERS} characters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
