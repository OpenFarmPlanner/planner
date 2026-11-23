"""Build isolated, immutable QA releases from origin/main."""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parents[1]
QA = REPO / ".qa-review"
DATA = QA / "test-data"
RUNTIME = QA / "runtime"
CURRENT = RUNTIME / "current"
RELEASES = RUNTIME / "releases"
DEPS = RUNTIME / "deps"


def git(*args):
    return subprocess.check_output(
        ["git", *args],
        cwd=REPO,
        text=True,
        timeout=90,
        env=dict(
            os.environ,
            GIT_TERMINAL_PROMPT="0",
            GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10",
        ),
    ).strip()


def main_commit():
    git(
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "origin",
        "refs/heads/main:refs/remotes/origin/main",
    )
    commit = git("rev-parse", "refs/remotes/origin/main^{commit}")
    if not re.fullmatch("[0-9a-f]{40,64}", commit):
        raise RuntimeError("Cannot resolve origin/main.")
    return commit


def env():
    return dict(
        os.environ,
        PDM_IGNORE_ACTIVE_VENV="1",
        DJANGO_SETTINGS_MODULE="qa_release_settings",
        PYTHONPATH=os.pathsep.join(map(str, (TOOLS, DATA))),
        PYTHONDONTWRITEBYTECODE="1",
        DEV_BACKEND_ORIGIN="http://127.0.0.1:8274",
        VITE_WS_BASE_URL="ws://127.0.0.1:8274",
        QA_REVIEW_PORT="4174",
    )


def run(args, cwd, **kwargs):
    subprocess.run(args, cwd=cwd, env=env(), check=True, **kwargs)


def dependencies(source, backend):
    folder = source / ("backend" if backend else "frontend")
    files = ["pdm.lock"] if backend else ["package.json", "package-lock.json", ".npmrc"]
    key = hashlib.sha256()
    key.update(
        (
            sys.version
            if backend
            else subprocess.check_output(["node", "--version"], text=True)
        ).encode()
    )
    for name in files:
        if (folder / name).exists():
            key.update((folder / name).read_bytes())
    cache = DEPS / (("py-" if backend else "js-") + key.hexdigest()[:20])
    marker = cache / ".installed"
    if not marker.exists():
        cache.mkdir(parents=True, exist_ok=True)
        for name in [*files, *(["pyproject.toml", "README.md"] if backend else [])]:
            if (folder / name).exists():
                shutil.copyfile(folder / name, cache / name)
        if backend:
            run(
                [sys.executable, "-m", "venv", "--without-pip", str(cache / ".venv")],
                cache,
            )
            (cache / ".pdm-python").write_text(str(cache / ".venv/bin/python"))
            run(["pdm", "sync", "--prod", "--no-self"], cache)
        else:
            run(["npm", "ci", "--prefer-offline", "--no-audit", "--no-fund"], cache)
        marker.touch()
    target = ".venv" if backend else "node_modules"
    (folder / target).symlink_to(cache / target, target_is_directory=True)


def prepare(commit):
    RELEASES.mkdir(parents=True, exist_ok=True)
    dest = RELEASES / commit
    if dest.is_dir():
        return dest
    with tempfile.TemporaryDirectory(prefix=".build-", dir=RELEASES) as tmp:
        stage = Path(tmp)
        with tempfile.TemporaryFile() as archive:
            subprocess.run(
                ["git", "archive", commit], cwd=REPO, stdout=archive, check=True
            )
            archive.seek(0)
            subprocess.run(["tar", "-xf", "-", "-C", stage], stdin=archive, check=True)
        dependencies(stage, True)
        dependencies(stage, False)
        front = stage / "frontend"
        run(["node", "node_modules/vite/bin/vite.js", "build"], front)
        (front / "dist/qa-version.json").write_text(
            json.dumps({"commit": commit}) + "\n"
        )
        backend = stage / "backend"
        run([str(backend / ".venv/bin/python"), "manage.py", "check"], backend)
        stage.rename(dest)
    return dest
