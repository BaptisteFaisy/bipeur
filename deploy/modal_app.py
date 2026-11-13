"""Beeper on Modal — lot A5: one public URL for the Central and the pager.

Deploys the whole workspace as a single CPU container (never a GPU) that runs
`node packages/central/dist/bin.js` and serves the built pager from the same
port (BIP-N-09: one process, one SQLite file, one URL). The SQLite file lives
on a Modal Volume mounted at /data, so a redeploy keeps the audit log.

Usage (from the repository root, Modal CLI ≥ 1.6 with an authenticated profile):

    modal deploy deploy/modal_app.py

No secret is stored in this file or in the repository: when Web Push VAPID keys
or a fixed bootstrap token are needed, supply them via a named Modal Secret and
pass its name in ``BIPEUR_MODAL_SECRET`` (e.g. ``BIPEUR_MODAL_SECRET=bipeur-demo``
after ``modal secret create bipeur-demo BIPEUR_BOOTSTRAP_TOKEN=... ...``).
Without ``BIPEUR_MODAL_SECRET``, the Central boots in demo mode with safe
defaults (generated station token, WebSocket delivery, no Web Push).
"""

import os
import subprocess
import sys

import modal

APP_NAME = "bipeur-central"
PORT = 8787
VOLUME_NAME = "bipeur-data"
MOUNT_PATH = "/data"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Paths never useful inside the image: the container builds from source.
IGNORE = [
    ".git",
    "**/node_modules",
    "**/dist",
    "packages/pager/dev-dist",
    "**/coverage",
    "data",
    "**/*.sqlite*",
    "deploy/.scratch",
]

image = (
    modal.Image.from_registry("node:24-slim", add_python="3.11")
    .env(
        {
            "COREPACK_ENABLE_DOWNLOAD_PROMPT": "0",
            # The e2e workspace needs the Playwright npm package but never a
            # browser download inside this image.
            "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
        }
    )
    .run_commands("corepack enable")
    .add_local_dir(REPO_ROOT, "/app", copy=True, ignore=IGNORE)
    .workdir("/app")
    # `corepack enable` + the packageManager pin install the exact pnpm version.
    .run_commands("pnpm install --frozen-lockfile", "pnpm build")
)

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

app = modal.App(APP_NAME)

env = {
    "BIPEUR_HOST": "0.0.0.0",
    "BIPEUR_PORT": str(PORT),
    "BIPEUR_DB": f"{MOUNT_PATH}/bipeur.sqlite",
    "BIPEUR_RULES": "/app/.bipeur/rules.yaml",
    # Demo mode is on for the public instance: no account, spaces wiped after
    # 24 h (BIP-F-31). The attention budget is lowered so judges see the
    # queueing behaviour quickly (BIP-F-09).
    "BIPEUR_DEMO": "1",
    "BIPEUR_BUDGET_PER_HOUR": "6",
}

_secret_name = os.environ.get("BIPEUR_MODAL_SECRET", "").strip()
secrets = [modal.Secret.from_name(_secret_name)] if _secret_name else []


@app.function(
    image=image,
    secrets=secrets,
    volumes={MOUNT_PATH: volume},
    env=env,
    cpu=0.5,
    gpu=None,  # hard rule: this app never requests a GPU
    timeout=24 * 3600,
    scaledown_window=300,
)
@modal.web_server(port=PORT, startup_timeout=120)
def central():
    """Boot the Central as a child process; Modal proxies HTTP(S) to PORT."""
    subprocess.Popen(
        ["node", "packages/central/dist/bin.js"],
        cwd="/app",
        env=os.environ,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
