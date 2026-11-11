#!/usr/bin/env python3
"""Kiroween 2026 submission requirements, checked on every PR and on main.

Exit code 0 = the repository is still submittable. Any failure prints the rule
that broke and why. Stdlib only: the check must run anywhere, fast.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

ROOT = os.environ.get("GITHUB_WORKSPACE", os.getcwd())

SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "private key"),
    (r"ghp_[A-Za-z0-9]{36}", "GitHub personal access token"),
    (r"github_pat_[A-Za-z0-9_]{20,}", "GitHub fine-grained token"),
    (r"sk-[A-Za-z0-9]{32,}", "API secret key"),
    (r"xox[baprs]-[A-Za-z0-9-]{10,}", "Slack token"),
]

SCAN_SKIP_DIRS = {".git", "node_modules", "dist", "coverage", "dev-dist", ".pnpm-store"}
SCAN_EXTENSIONS = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".py", ".sh", ".env"}


def fail(rule: str, detail: str) -> None:
    print(f"::error::contest-guard [{rule}] {detail}")


def git_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8", "replace")
    return [path for path in out.split("\0") if path]


def check_kiro_tracked(files: list[str]) -> bool:
    ok = True
    kiro = [f for f in files if f.startswith(".kiro/")]
    if not kiro:
        fail("kiro-folder", "/.kiro is missing or not tracked; Kiroween requires it at the root")
        ok = False
    else:
        print(f".kiro/ tracked files: {len(kiro)}")
    ignored = subprocess.run(
        ["git", "check-ignore", "-v", ".kiro", ".kiro/steering/product.md"],
        cwd=ROOT,
        capture_output=True,
    )
    if ignored.returncode == 0:
        fail("kiro-ignored", f".kiro is matched by a .gitignore rule: {ignored.stdout.decode().strip()}")
        ok = False
    for required in (".kiro/steering/product.md", ".kiro/steering/tech.md", ".kiro/steering/structure.md"):
        if required not in files:
            fail("kiro-steering", f"{required} must be tracked")
            ok = False
    return ok


def check_licence(files: list[str]) -> bool:
    candidates = [f for f in files if f.lower() in {"license", "license.md", "licence", "licence.md"}]
    if not candidates:
        fail("licence", "no LICENSE file at the root; the contest requires a detected open-source licence")
        return False
    text = open(os.path.join(ROOT, candidates[0]), encoding="utf-8", errors="replace").read()
    if "MIT License" not in text:
        fail("licence", f"{candidates[0]} does not contain an MIT licence text")
        return False
    print(f"licence: {candidates[0]} (MIT)")
    return True


def check_docs(files: list[str]) -> bool:
    ok = True
    if "README.md" not in files:
        fail("readme", "README.md is missing")
        return False
    readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8", errors="replace").read()
    for section in ("## What it does", "## Run it", "## Demo mode", "## Dependencies and licences"):
        if section not in readme:
            fail("readme", f"README.md is missing the section `{section}`")
            ok = False
    if "KIRO_JOURNAL.md" not in files:
        fail("journal", "KIRO_JOURNAL.md is missing; the submission form asks for that material")
        ok = False
    return ok


def check_no_secret(files: list[str]) -> bool:
    ok = True
    for path in files:
        ext = os.path.splitext(path)[1].lower()
        if ext not in SCAN_EXTENSIONS:
            continue
        if path.startswith(".github/checks/"):
            continue  # this file lists the patterns on purpose
        full = os.path.join(ROOT, path)
        try:
            text = open(full, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for pattern, label in SECRET_PATTERNS:
            if re.search(pattern, text):
                fail("secret", f"{path} looks like it contains a {label}")
                ok = False
    return ok


def main() -> int:
    files = git_files()
    print(f"tracked files: {len(files)}")
    results = [
        check_kiro_tracked(files),
        check_licence(files),
        check_docs(files),
        check_no_secret(files),
    ]
    if all(results):
        print("contest-guard: OK — the repository stays submittable")
        return 0
    print("contest-guard: FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
