"""Dispatch full E2E for the release tag at the current remote main commit."""

import re
import subprocess

from scripts.ci.release_pr import REPO, VERSION, git


def dispatch() -> None:
    listing = git('ls-remote', f'https://github.com/{REPO}.git', 'refs/heads/main', 'refs/tags/v*')
    refs = {}
    for line in listing.splitlines():
        target, ref = line.split('\t')
        refs[ref] = target
    sha = refs.get('refs/heads/main')
    if not sha:
        raise RuntimeError(f'Could not find main in {REPO}.')

    tags = []
    for ref, target in refs.items():
        match = re.fullmatch(rf'refs/tags/(v{VERSION})', ref)
        if match and refs.get(ref + '^{}', target) == sha:
            tags.append(match[1])
    if not tags:
        raise RuntimeError(
            f'main ({sha}) has no release tag. Check the Release workflow and its version PR. '
            'Once the protected release process publishes a tag on main, run make release-e2e again.'
        )

    tag = max(tags, key=lambda name: tuple(map(int, name[1:].split('.'))))
    print(f'Starting Full release E2E for {tag} (main at {sha})', flush=True)
    subprocess.run(['gh', 'workflow', 'run', 'release-e2e.yml', '--repo', REPO, '--ref', tag], check=True)
    print(f'https://github.com/{REPO}/actions/workflows/release-e2e.yml')


if __name__ == '__main__':
    try:
        dispatch()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
