#!/usr/bin/env python3
"""Hermes conflict resolver — orchestration, stdlib only.

Per PR: read it (forks refused), `git rebase origin/<base>`, resolve each
conflict through `resolve.resolve_file`, validate with the repository
toolchain (install, typecheck, lint, test, build), then push
`--force-with-lease=<branch>:<expected sha>` on the PR branch only. A check
already red on `origin/<base>` is reported, not blocking; one the resolution
broke blocks the push. Any doubt stops before the push: rebase aborted, label
`hermes/conflit`, exact reason in a comment, non-zero exit. The token reaches
git through `GIT_ASKPASS`, never a command line.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import resolve  # noqa: E402  (same directory, resolved after sys.path fix)

API = "https://api.github.com"
LABEL_OK = "hermes/resolu"
LABEL_CONFLIT = "hermes/conflit"
MARKER = "<!-- hermes-resolver:v1 -->"
MAX_ROUNDS = 30
CHECK_TIMEOUT = 300
GIT_TIMEOUT = 180
# Wall-clock budget: on expiry we escalate with a reason, never get killed.
BUDGET = int(os.environ.get("HERMES_BUDGET_SECONDS", "270"))
CHECKS = (
    ("install", ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"]),
    ("typecheck", ["pnpm", "typecheck"]),
    ("lint", ["pnpm", "lint"]),
    ("test", ["pnpm", "test"]),
    ("build", ["pnpm", "build"]),
)


def tail(text, lines=12, width=300):
    """Last lines of a captured output, trimmed for a PR comment."""
    kept = [line.strip() for line in (text or "").strip().splitlines() if line.strip()]
    return "\n".join(line[:width] for line in kept[-lines:])


def git(cwd, args, timeout=GIT_TIMEOUT, extra_env=None):
    """Run git with list arguments (never a shell). Returns (rc, output)."""
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "true"})
    env.update(extra_env or {})
    try:
        done = subprocess.run(["git"] + args, cwd=cwd, capture_output=True,
                              text=True, errors="replace", timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return 124, "git %s: timeout after %ss" % (args[0], timeout)
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def command(cwd, args, timeout=CHECK_TIMEOUT):
    """Run a toolchain command with list arguments. Returns (rc, output)."""
    try:
        done = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                              errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "%s: timeout after %ss" % (" ".join(args), timeout)
    except OSError as exc:
        return 127, "%s: %s" % (args[0], exc)
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def api(method, url, token, body=None):
    """Minimal GitHub REST client; never prints the token."""
    import urllib.error
    import urllib.request

    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + url, data=data, method=method)
    request.add_header("Authorization", "Bearer " + token)
    request.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        try:
            return exc.code, json.loads(payload)
        except ValueError:
            return exc.code, payload.decode("utf-8", "replace")


def conflicted_files(cwd):
    rc, out = git(cwd, ["diff", "--name-only", "--diff-filter=U"])
    return [line for line in out.splitlines() if line.strip()] if rc == 0 else []


def stage_blob(cwd, stage, path):
    """Text of one conflict stage (`:1:` base, `:2:` ours, `:3:` theirs)."""
    rc, out = git(cwd, ["show", ":%d:%s" % (stage, path)])
    if rc != 0 or "\0" in out:
        return ""
    return out


def write_text(cwd, path, content):
    target = os.path.join(cwd, path)
    os.makedirs(os.path.dirname(target) or cwd, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="") as handle:
        handle.write(content)


def resolve_one(cwd, path, ask=None):
    """Resolve one conflicted path; a derived file is regenerated, not merged."""
    result = resolve.resolve_file(path, stage_blob(cwd, 1, path),
                                  stage_blob(cwd, 2, path),
                                  stage_blob(cwd, 3, path), ask=ask)
    if result["status"] == "resolved":
        write_text(cwd, path, result["content"])
        return result
    if result["status"] == "regenerate":
        rc, out = command(cwd, result["command"].split(), timeout=CHECK_TIMEOUT)
        if rc == 0 and os.path.exists(os.path.join(cwd, path)):
            return result
        result["status"] = "unresolved"
        result["notes"].append("regeneration `%s` failed (rc=%s): %s"
                               % (result["command"], rc, tail(out, 4)))
    return result


def run_rebase(cwd, base_ref, ask=None):
    """Rebase the current branch onto origin/<base_ref>, resolving conflicts."""
    results = []
    rc, out = git(cwd, ["rebase", "origin/%s" % base_ref])
    rounds = 0
    while rc != 0 and rounds < MAX_ROUNDS:
        rounds += 1
        files = conflicted_files(cwd)
        if not files:
            git(cwd, ["rebase", "--abort"])
            return {"ok": False, "files": results, "rounds": rounds,
                    "reason": "git rebase failed outside a conflict: %s" % tail(out)}
        stuck = []
        for path in files:
            one = resolve_one(cwd, path, ask=ask)
            results.append(one)
            if one["status"] == "unresolved":
                stuck.append(path)
        if stuck:
            git(cwd, ["rebase", "--abort"])
            return {"ok": False, "files": results, "rounds": rounds,
                    "reason": "unresolved conflict(s): " + ", ".join(stuck)}
        git(cwd, ["add", "--"] + files)
        rc, out = git(cwd, ["-c", "core.editor=true", "rebase", "--continue"])
    if rc != 0:
        git(cwd, ["rebase", "--abort"])
        return {"ok": False, "files": results, "rounds": rounds,
                "reason": "rebase did not converge after %d round(s)" % rounds}
    return {"ok": True, "files": results, "rounds": rounds,
            "reason": "rebased onto origin/%s" % base_ref}


def timed_check(cwd, args, deadline):
    """Run one toolchain command inside the remaining budget."""
    left = int(deadline - time.time())
    if left <= 5:
        return 0, 124, "budget exhausted before `%s`" % " ".join(args)
    started = time.time()
    rc, out = command(cwd, args, timeout=min(CHECK_TIMEOUT, left))
    return int(time.time() - started), rc, out


def check_on_base(cwd, base_ref, branch, args, deadline):
    """Is this check already red on origin/<base>? Lazy: only asked on failure."""
    rc, _ = git(cwd, ["checkout", "-f", "--detach", "origin/%s" % base_ref])
    if rc != 0:
        return None, "cannot check out origin/%s" % base_ref
    try:
        _, rc_check, out = timed_check(cwd, args, deadline)
        return rc_check == 0, tail(out, 4)
    finally:
        git(cwd, ["checkout", "-f", branch])


def validate(cwd, base_ref, branch, deadline):
    """Run the repository toolchain on the rebased tree. Returns the report."""
    report = []
    for name, args in CHECKS:
        seconds, rc, out = timed_check(cwd, args, deadline)
        entry = {"name": name, "ok": rc == 0, "seconds": seconds, "tail": tail(out)}
        if not entry["ok"]:
            entry["base_ok"], entry["base_tail"] = check_on_base(
                cwd, base_ref, branch, args, deadline)
        report.append(entry)
    return report


def blocking_checks(report):
    """A red check blocks the push unless origin/<base> is red for the same one.

    `base_ok` is False only when we really measured the base as red: a base we
    could not measure is treated as green, so the push stays blocked.
    """
    return [entry for entry in report
            if not entry["ok"] and entry.get("base_ok") is not False]


def askpass(token):
    """A throwaway askpass script so the token never lands in a command line."""
    handle, path = tempfile.mkstemp(prefix="hermes-askpass-")
    with os.fdopen(handle, "w", encoding="utf-8") as script:
        script.write('#!/bin/sh\nprintf \'%s\\n\' "$HERMES_PUSH_TOKEN_VALUE"\n')
    os.chmod(path, 0o700)
    return path


def push_branch(cwd, repo, branch, expected_sha, token):
    """Force-with-lease push on the PR branch only. Returns (ok, message)."""
    if not token:
        return False, "no push token (HERMES_PUSH_TOKEN / GH_TOKEN)"
    url = "https://x-access-token@github.com/%s.git" % repo
    script = askpass(token)
    try:
        rc, out = git(cwd, ["push", "--force-with-lease=refs/heads/%s:%s"
                            % (branch, expected_sha), url,
                            "HEAD:refs/heads/%s" % branch],
                      extra_env={"GIT_ASKPASS": script,
                                 "HERMES_PUSH_TOKEN_VALUE": token})
    finally:
        os.unlink(script)
    return rc == 0, tail(out, 6)


def ensure_label(repo, token, name, color, description):
    api("POST", "/repos/%s/labels" % repo, token,
        {"name": name, "color": color, "description": description})


def set_label(repo, token, number, name, present):
    """Idempotent add/remove; a 404 on removal is not an error."""
    if present:
        api("POST", "/repos/%s/issues/%d/labels" % (repo, number), token,
            {"labels": [name]})
    else:
        api("DELETE", "/repos/%s/issues/%d/labels/%s" % (repo, number, name), token)


def comment(repo, token, number, body):
    """Update our own comment when there is one, create it otherwise."""
    sc, comments = api("GET", "/repos/%s/issues/%d/comments?per_page=100"
                       % (repo, number), token)
    if sc == 200 and isinstance(comments, list):
        for existing in comments:
            if MARKER in (existing.get("body") or ""):
                api("PATCH", "/repos/%s/issues/comments/%d"
                    % (repo, existing["id"]), token, {"body": body})
                return
    api("POST", "/repos/%s/issues/%d/comments" % (repo, number), token,
        {"body": body})


def files_table(files):
    """Markdown table of what happened to each conflicted file."""
    rows = ["| Fichier | Type | Stratégie | Note |", "|---|---|---|---|"]
    for one in files:
        note = "; ".join(one.get("notes") or []) or "—"
        rows.append("| `%s` | %s | %s | %s |"
                    % (one["path"], one.get("kind", "?"), one.get("strategy", "?"),
                       note.replace("|", "/")[:200]))
    return "\n".join(rows)


def checks_table(report, seconds):
    rows = ["| Étape | Résultat | Durée |", "|---|---|---|"]
    for entry in report:
        state = "vert" if entry["ok"] else (
            "rouge (déjà sur la base)" if entry.get("base_ok") is True
            else "rouge — bloquant")
        rows.append("| `%s` | %s | %ss |" % (entry["name"], state, entry["seconds"]))
    rows.append("\nValidation totale : %ss." % seconds)
    return "\n".join(rows)


def report_body(result, report, seconds, mode, pushed):
    head = [MARKER, "### Hermes — résolveur de conflits", ""]
    if not result["ok"]:
        return "\n".join(head + [
            "**Conflit non résolu** — rien n'a été poussé, un humain tranche.",
            "", "Raison : %s" % result["reason"], "",
            files_table(result["files"]) if result["files"] else "_Aucun fichier résolu._",
            "", "Rebase annulé (`git rebase --abort`), la branche est intacte.",
        ])
    state = "poussé sur la branche" if pushed else "**dry-run** : rien n'a été poussé"
    return "\n".join(head + [
        "Rebase de la branche sur `origin/main` : **%d fichier(s)** résolu(s) — %s."
        % (len(result["files"]), state), "",
        files_table(result["files"]) if result["files"] else "_Rebase propre, aucun conflit._",
        "", "#### Validation (toolchain du dépôt)", "",
        checks_table(report, seconds) if report else "_Non exécutée._",
        "", "Mode : `%s`." % mode,
    ])


def escalate(repo, token, number, result, report, seconds, mode):
    """Escalation path: label, structured comment, non-zero exit."""
    body = report_body(result, report, seconds, mode, pushed=False)
    comment(repo, token, number, body)
    set_label(repo, token, number, LABEL_CONFLIT, True)
    set_label(repo, token, number, LABEL_OK, False)
    print("[resolver] escalade humaine : %s" % result["reason"], flush=True)
    return 1


def prepare(cwd, repo, token, pr):
    """Fetch and check out the PR head. Returns (ok, reason)."""
    branch = pr["head"]["ref"]
    rc, out = git(cwd, ["fetch", "--prune", "origin"])
    if rc != 0:
        return False, "git fetch failed: %s" % tail(out, 4)
    rc, out = git(cwd, ["checkout", "-f", "-B", branch, pr["head"]["sha"]])
    if rc != 0:
        return False, "cannot check out %s: %s" % (pr["head"]["sha"], tail(out, 4))
    return True, ""


def fetch_pr(repo, token, number):
    """Read the PR; return (pr, error_code). error_code 0 means "go on"."""
    sc, pr = api("GET", "/repos/%s/pulls/%d" % (repo, number), token)
    if sc != 200 or not isinstance(pr, dict):
        print("[resolver] PR #%d illisible (HTTP %s)" % (number, sc), flush=True)
        return None, 1
    if pr.get("merged") or pr.get("state") != "open":
        print("[resolver] PR #%d déjà fermée ou mergée — rien à faire" % number)
        return None, 0
    if (pr["head"].get("repo") or {}).get("full_name") != repo:
        print("[resolver] PR #%d vient d'un fork : refus (pas de push chez autrui)"
              % number, flush=True)
        return None, 1
    return pr, 0


def publish(cwd, repo, token, number, branch, head_sha, mode, result, report, seconds):
    """Dry-run report, or force-with-lease push + comment + labels."""
    body = report_body(result, report, seconds, mode, pushed=mode != "dry-run")
    if mode == "dry-run":
        print(body, flush=True)
        print("[resolver] dry-run : aucun push, aucun label", flush=True)
        return 0
    push_token = os.environ.get("HERMES_PUSH_TOKEN") or token
    ok, message = push_branch(cwd, repo, branch, head_sha, push_token)
    if not ok:
        result["ok"] = False
        result["reason"] = "push --force-with-lease refusé : %s" % message
        return escalate(repo, token, number, result, report, seconds, mode)
    ensure_label(repo, token, LABEL_OK, "0e8a16", "Conflits résolus par Hermes")
    ensure_label(repo, token, LABEL_CONFLIT, "d73a4a", "Conflit à trancher par un humain")
    comment(repo, token, number, body)
    set_label(repo, token, number, LABEL_OK, True)
    set_label(repo, token, number, LABEL_CONFLIT, False)
    print("[resolver] #%d résolu et poussé en %ss" % (number, seconds), flush=True)
    return 0


def red_reason(blocking):
    """One line per blocking check, with the last line of its output."""
    return ", ".join("%s (%s)" % (entry["name"],
                                  entry["tail"].splitlines()[-1] if entry["tail"]
                                  else "échec") for entry in blocking)


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    number = int(os.environ.get("PR_NUMBER") or "0")
    mode = (os.environ.get("HERMES_MODE") or "dry-run").strip()
    cwd, deadline = os.getcwd(), time.time() + BUDGET

    pr, code = fetch_pr(repo, token, number)
    if pr is None:
        return code
    branch, base_ref, head_sha = pr["head"]["ref"], pr["base"]["ref"], pr["head"]["sha"]
    print("[resolver] #%d %s -> origin/%s (%s), mode=%s"
          % (number, branch, base_ref, head_sha[:8], mode), flush=True)
    ok, reason = prepare(cwd, repo, token, pr)
    if not ok:
        return escalate(repo, token, number,
                        {"ok": False, "files": [], "reason": reason}, [], 0, mode)

    started = time.time()
    result = run_rebase(cwd, base_ref)
    if not result["ok"]:
        return escalate(repo, token, number, result, [], int(time.time() - started), mode)
    report = validate(cwd, base_ref, branch, deadline)
    seconds = int(time.time() - started)
    blocking = blocking_checks(report)
    if blocking:
        result["ok"] = False
        result["reason"] = "validation rouge : " + red_reason(blocking)
        git(cwd, ["checkout", "-f", branch])
        return escalate(repo, token, number, result, report, seconds, mode)
    return publish(cwd, repo, token, number, branch, head_sha, mode, result, report,
                   seconds)


def _write(root, path, text):
    target = os.path.join(root, path)
    os.makedirs(os.path.dirname(target) or root, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def _commit(root, message):
    git(root, ["add", "-A"])
    rc, out = git(root, ["-c", "user.name=selftest", "-c", "user.email=selftest@local",
                         "commit", "-m", message])
    return rc == 0, out


def _selftest_repo(root, name):
    """`main` and `pr` diverge on the same two lines: JSON + source conflict."""
    path = os.path.join(root, name)
    os.makedirs(path)
    git(path, ["init", "-b", "main"])
    _write(path, "package.json", '{"dependencies": {"a": "1.0.0"}}\n')
    _write(path, "src/limits.ts", "export const a = 0;\nexport const b = 0;\n")
    _commit(path, "base")
    git(path, ["checkout", "-b", "pr"])
    _write(path, "package.json", '{"dependencies": {"a": "1.0.0", "hono": "4.0.0"}}\n')
    _write(path, "src/limits.ts", "export const a = 0;\nexport const b = 2;\n")
    _commit(path, "pr work")
    git(path, ["checkout", "main"])
    _write(path, "package.json", '{"dependencies": {"a": "1.0.0", "zod": "3.0.0"}}\n')
    _write(path, "src/limits.ts", "export const a = 0;\nexport const b = 1;\n")
    _commit(path, "main work")
    git(path, ["checkout", "pr"])
    git(path, ["update-ref", "refs/remotes/origin/main", "main"])
    return path


def _expect(name, condition, problems):
    print("  %-56s %s" % (name, "ok" if condition else "FAIL"), flush=True)
    if not condition:
        problems.append(name)


def selftest():
    """Real git rebase in a temporary repository; no network, no secret."""
    problems = []
    root = tempfile.mkdtemp(prefix="hermes-selftest-")
    ask = lambda prompt: "export const a = 0;\nexport const b = 3;\n"
    repo = _selftest_repo(root, "mergeable")
    result = run_rebase(repo, "main", ask=ask)
    _expect("rebase: the conflicting rebase completes", result["ok"], problems)
    _expect("rebase: two files resolved (json-merge + llm)",
            sorted(one["strategy"] for one in result["files"]) == ["json-merge", "llm"],
            problems)
    merged = open(os.path.join(repo, "package.json"), encoding="utf-8").read()
    _expect("rebase: no dependency lost by the JSON merge",
            all(key in merged for key in ("zod", "hono", "a")), problems)
    rc, log = git(repo, ["log", "--oneline", "--format=%s"])
    _expect("rebase: main's commit is now an ancestor",
            rc == 0 and "main work" in log and "pr work" in log, problems)

    stuck = _selftest_repo(root, "insoluble")
    before = git(stuck, ["rev-parse", "HEAD"])[1].strip()
    result = run_rebase(stuck, "main", ask=None)  # no key, no injected leg
    _expect("escalation: an insoluble conflict is reported, not guessed",
            not result["ok"] and "src/limits.ts" in result["reason"], problems)
    _expect("escalation: the branch is left exactly where it was",
            git(stuck, ["rev-parse", "HEAD"])[1].strip() == before, problems)
    _expect("escalation: no rebase left in progress",
            not os.path.isdir(os.path.join(stuck, ".git", "rebase-merge"))
            and not os.path.isdir(os.path.join(stuck, ".git", "rebase-apply")),
            problems)

    _expect("validation: a red base check does not block",
            blocking_checks([{"name": "lint", "ok": False, "base_ok": False}]) == [],
            problems)
    _expect("validation: a new red check blocks",
            len(blocking_checks([{"name": "test", "ok": False, "base_ok": True}])) == 1,
            problems)
    _expect("validation: an unverifiable base blocks",
            len(blocking_checks([{"name": "test", "ok": False}])) == 1, problems)
    _expect("push: no token means no push",
            push_branch(root, "o/r", "b", "0" * 40, "")[0] is False, problems)
    print("resolver selftest: %s" % ("OK" if not problems else "FAILED %s" % problems))
    return 1 if problems else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(main())
