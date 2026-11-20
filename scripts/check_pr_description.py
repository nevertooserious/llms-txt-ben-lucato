#!/usr/bin/env python3
"""Fails when a pull request description is longer than 500 characters.

Usage: PR_BODY="..." scripts/check_pr_description.py

HTML comments are excluded, so a template can carry guidance that is not shown.
"""

import os
import re
import sys

MAX_PR_DESCRIPTION_CHARACTERS = 500

HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def visible_description(pr_body: str) -> str:
    pr_body = pr_body.replace("\r\n", "\n")
    return HTML_COMMENT.sub("", pr_body).strip()


def main() -> int:
    description = visible_description(os.environ.get("PR_BODY", ""))
    length = len(description)
    if length > MAX_PR_DESCRIPTION_CHARACTERS:
        print(
            f"PR description is {length} characters; the limit is "
            f"{MAX_PR_DESCRIPTION_CHARACTERS} (excluding HTML comments). "
            "Shorten it with `gh pr edit --body-file`.",
            file=sys.stderr,
        )
        return 1
    print(f"PR description is {length}/{MAX_PR_DESCRIPTION_CHARACTERS} characters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
