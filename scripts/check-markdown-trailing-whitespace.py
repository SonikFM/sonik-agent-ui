#!/usr/bin/env python3
"""Fail when Markdown files contain trailing whitespace.

Unlike `git diff --check`, this also checks untracked files, which matters for
new documentation corpora before they are staged.
"""
from __future__ import annotations

import sys
from pathlib import Path


def markdown_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted(path.rglob("*.md")))
        elif path.suffix == ".md":
            files.append(path)
    return files


def main() -> int:
    files = markdown_files(sys.argv[1:] or ["."])
    failures: list[str] = []
    for path in files:
        try:
            lines = path.read_text().splitlines()
        except UnicodeDecodeError as exc:
            failures.append(f"{path}: unable to decode UTF-8: {exc}")
            continue
        for index, line in enumerate(lines, start=1):
            if line.rstrip(" \t") != line:
                failures.append(f"{path}:{index}: trailing whitespace")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(f"markdown trailing whitespace check passed ({len(files)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
