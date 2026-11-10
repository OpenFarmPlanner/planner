"""Propose and accept Playwright screenshot baselines in CI.

``collect DEST``: run by a failing screenshot job (e2e.yml,
e2e-cross-browser.yml) after it re-recorded its failed screenshots with
``--last-failed --update-snapshots=changed``. Copies every changed or new
baseline into DEST under its repository path, for the job to upload as a
``proposed-baselines-*`` artifact.

``apply SRC``: run by accept-screenshots.yml once a person has reviewed the
diffs and added the ``accept-screenshots`` label. SRC holds the downloaded
artifacts, one directory each; their baselines are copied into the checkout.
Anything that is not a PNG at a baseline path is refused.

Both write ``count=<n>`` to $GITHUB_OUTPUT when it is set. Details:
docs/testing-and-ci.md ("Accepting changed baselines").
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

# Kept in step with BASELINE_PATTERN in claude-pr.yml's triage step.
BASELINE_PATH = re.compile(r"^frontend/(e2e|e2e-cross-browser)/[^/]+-snapshots/[^/]+\.png$")
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
SEARCHED_DIRS = ("frontend/e2e", "frontend/e2e-cross-browser")


class RefusedBaseline(Exception):
    """A proposed file that must not be committed as a baseline."""


def is_baseline_path(path: str) -> bool:
    return BASELINE_PATH.match(path) is not None


def changed_baselines(repo_root: Path) -> list[str]:
    """Modified or new (untracked, not ignored) baselines in the working tree."""
    listing = subprocess.run(
        ["git", "ls-files", "--modified", "--others", "--exclude-standard", "-z", "--",
         *SEARCHED_DIRS],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return sorted({path for path in listing.split("\0") if path and is_baseline_path(path)})


def collect(repo_root: Path, dest: Path) -> list[str]:
    paths = changed_baselines(repo_root)
    for path in paths:
        target = dest / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((repo_root / path).read_bytes())
    return paths


def read_proposals(src: Path) -> dict[str, bytes]:
    """The baselines proposed by every artifact directory in SRC, by path."""
    proposals: dict[str, bytes] = {}
    if not src.exists():
        return proposals
    for artifact in sorted(entry for entry in src.iterdir() if entry.is_dir()):
        for file in sorted(artifact.rglob("*")):
            if file.is_dir() and not file.is_symlink():
                continue
            relative = file.relative_to(artifact).as_posix()
            if file.is_symlink() or not is_baseline_path(relative):
                raise RefusedBaseline(f"{artifact.name}/{relative}: not a screenshot baseline path")
            data = file.read_bytes()
            if not data.startswith(PNG_MAGIC):
                raise RefusedBaseline(f"{relative}: not a PNG image")
            if relative in proposals and proposals[relative] != data:
                raise RefusedBaseline(f"{relative}: two artifacts propose different images")
            proposals[relative] = data
    return proposals


def apply(repo_root: Path, src: Path) -> list[str]:
    proposals = read_proposals(src)
    for relative, data in proposals.items():
        target = repo_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return sorted(proposals)


def write_count(count: int) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"count={count}\n")


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in {"collect", "apply"}:
        print("usage: screenshot_baselines.py collect DEST | apply SRC", file=sys.stderr)
        return 2
    command, directory = argv[1], Path(argv[2]).resolve()
    repo_root = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], check=True, capture_output=True, text=True
        ).stdout.strip()
    )
    try:
        run = collect if command == "collect" else apply
        paths = run(repo_root, directory)
    except RefusedBaseline as error:
        print(f"Refused: {error}", file=sys.stderr)
        return 1
    verb = "proposed" if command == "collect" else "accepted"
    for path in paths:
        print(f"{verb}: {path}")
    print(f"{len(paths)} baseline(s) {verb}")
    write_count(len(paths))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
