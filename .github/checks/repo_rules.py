#!/usr/bin/env python3
"""Repository size rules: < 500 lines per file, < 50 lines per function.

User rule of 2026-10-24, enforced here so no agent can let a file grow.
The function check is a conservative brace counter for TypeScript/JavaScript:
it only reports a function when it can find its closing brace at the same
depth, so a parse surprise degrades into "not measured", never into a false
positive. Stdlib only.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

MAX_FILE_LINES = 500
MAX_FUNCTION_LINES = 50
SCAN_EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".py"}
SKIP_PREFIXES = ("node_modules/", "dist/", "coverage/", "packages/pager/dev-dist/", "pnpm-lock.yaml")

FUNC_START = re.compile(
    r"""^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?
        (?:function\s+(?P<name>[A-Za-z0-9_$]+)
        |(?:const|let|var)\s+(?P<cname>[A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>)""",
    re.VERBOSE,
)

PY_FUNC = re.compile(r"^\s*(?:async\s+)?def\s+(?P<name>[A-Za-z0-9_]+)\s*\(")


def git_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8", "replace").split("\0") if p]


def scan_braces(lines: list[str], start: int) -> int:
    """Return the index of the line that closes the block opened at `start`."""
    depth = 0
    seen_open = False
    for index in range(start, len(lines)):
        line = strip_noise(lines[index])
        for ch in line:
            if ch == "{":
                depth += 1
                seen_open = True
            elif ch == "}":
                depth -= 1
                if seen_open and depth == 0:
                    return index
    return -1


def strip_noise(line: str) -> str:
    """Remove string literals and comments so braces inside them do not count."""
    line = re.sub(r"//.*$", "", line)
    line = re.sub(r"`(?:\\.|[^`\\])*`", '""', line)
    line = re.sub(r'"(?:\\.|[^"\\])*"', '""', line)
    line = re.sub(r"'(?:\\.|[^'\\])*'", '""', line)
    return line


def check_ts(path: str, lines: list[str]) -> list[str]:
    problems: list[str] = []
    for index, raw in enumerate(lines):
        line = strip_noise(raw)
        match = FUNC_START.match(line)
        if not match:
            continue
        end = scan_braces(lines, index)
        if end < 0:
            continue
        length = end - index + 1
        if length > MAX_FUNCTION_LINES:
            name = match.group("name") or match.group("cname") or "?"
            problems.append(f"{path}:{index + 1} function {name} is {length} lines (> {MAX_FUNCTION_LINES})")
    return problems


def check_py(path: str, lines: list[str]) -> list[str]:
    problems: list[str] = []
    starts = [(i, PY_FUNC.match(strip_noise(l))) for i, l in enumerate(lines)]
    for position, (index, match) in enumerate(starts):
        if not match:
            continue
        indent = len(lines[index]) - len(lines[index].lstrip())
        end = len(lines)
        for later, later_match in starts[position + 1:]:
            if not later_match:
                continue
            later_indent = len(lines[later]) - len(lines[later].lstrip())
            if later_indent <= indent:
                end = later
                break
        body = [l for l in lines[index:end] if l.strip()]
        if len(body) > MAX_FUNCTION_LINES:
            problems.append(
                f"{path}:{index + 1} def {match.group('name')} is {len(body)} lines (> {MAX_FUNCTION_LINES})"
            )
    return problems


def main() -> int:
    problems: list[str] = []
    for path in git_files():
        if path.startswith(SKIP_PREFIXES):
            continue
        ext = os.path.splitext(path)[1]
        if ext not in SCAN_EXTENSIONS:
            continue
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        lines = text.splitlines()
        if len(lines) > MAX_FILE_LINES:
            problems.append(f"{path} is {len(lines)} lines (> {MAX_FILE_LINES}) — split it")
        if ext in {".ts", ".tsx", ".js", ".mjs", ".cjs"}:
            problems.extend(check_ts(path, lines))
        elif ext == ".py":
            problems.extend(check_py(path, lines))

    if problems:
        for problem in problems:
            print(f"::error::repo-rules {problem}")
        print(f"repo-rules: FAILED ({len(problems)} problem(s))")
        return 1
    print(f"repo-rules: OK — no file over {MAX_FILE_LINES} lines, no function over {MAX_FUNCTION_LINES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
