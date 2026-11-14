"""Prepare checked release PRs and publish their exact merged commits, never push main."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tomllib
from pathlib import Path
from typing import Any

REPO = 'OpenFarmPlanner/planner'
BRANCH = 'automation/release'
FILES = {'backend/config/version.py', 'backend/pyproject.toml'}
ALLOWED_FILES = FILES | {'CHANGELOG.md'}
VERSION = r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)'
MARKER = re.compile(r'^<!-- ofp-release-plan:v1 (\{.*\}) -->$', re.MULTILINE)


def run(*args: str, input_text: str | None = None) -> str:
    result = subprocess.run(args, input=input_text, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr[-1500:]}')
    return result.stdout.strip()


def git(*args: str) -> str:
    return run('git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args)


def blob(revision: str, filename: str) -> bytes:
    return subprocess.check_output(
        ['git', '-c', 'core.hooksPath=/dev/null', 'show', f'{revision}:{filename}'], timeout=30,
    )


def api(endpoint: str, payload: dict[str, Any] | None = None, *, missing: bool = False) -> Any:
    args = ['gh', 'api', f'repos/{REPO}/{endpoint}']
    if payload is not None:
        args += ['--method', 'POST', '--input', '-']
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, timeout=120)
    if missing and result.returncode and 'HTTP 404' in result.stderr:
        return None
    if result.returncode:
        raise RuntimeError(f'GitHub request failed: {endpoint}: {result.stderr[-1000:]}')
    return json.loads(result.stdout)


def versions(config: bytes, project: bytes) -> str:
    matches = re.findall(rf'^VERSION = "({VERSION})"$', config.decode(), re.MULTILINE)
    if len(matches) != 1 or tomllib.loads(project.decode())['project']['version'] != matches[0]:
        raise ValueError('Backend version declarations disagree or are invalid.')
    return matches[0]


def parse_plan(body: str) -> dict[str, Any]:
    matches = MARKER.findall(body)
    if len(matches) != 1:
        raise ValueError('Expected exactly one generated release plan.')
    plan = json.loads(matches[0])
    if (set(plan) != {'source', 'version', 'files'} or
            not re.fullmatch(r'[0-9a-f]{40}', plan['source']) or
            not re.fullmatch(VERSION, plan['version']) or not isinstance(plan['files'], dict) or
            not FILES <= set(plan['files']) <= ALLOWED_FILES or
            not all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value)
                    for value in plan['files'].values())):
        raise ValueError('Invalid release plan.')
    return plan


def validate_commit(sha: str, plan: dict[str, Any]) -> None:
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid release commit.')
    if git('rev-list', '--parents', '-n', '1', sha).split() != [sha, plan['source']]:
        raise ValueError('Release commit is not a single checked commit on its planned main base.')
    paths = set(git('diff', '--name-only', plan['source'], sha).splitlines())
    if paths != set(plan['files']):
        raise ValueError('Release changed unexpected files.')
    for filename, digest in plan['files'].items():
        if hashlib.sha256(blob(sha, filename)).hexdigest() != digest:
            raise ValueError('Release file differs from its generated plan.')
    if versions(blob(sha, 'backend/config/version.py'), blob(sha, 'backend/pyproject.toml')) != plan['version']:
        raise ValueError('Release version differs from its generated plan.')


def approved_plan(pr: dict[str, Any]) -> dict[str, Any]:
    if (pr['base']['ref'] != 'main' or pr['head']['ref'] != BRANCH or
            pr['head']['repo'] is None or
            pr['head']['repo']['full_name'] != REPO):
        raise ValueError('Not a same-repository release PR targeting main.')
    context = json.loads(run('node', 'scripts/ci/agent_task_context.cjs', str(pr['number'])))
    plan = parse_plan(context['body'])
    if context['title'] != f'chore(release): v{plan["version"]}':
        raise ValueError('Release PR title differs from the plan.')
    return plan


def require_checks(pr: dict[str, Any], rules: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    if rules is None:
        protection = api('branches/main/protection/required_status_checks')
        rules = protection.get('checks', [])
        if not protection.get('strict'):
            raise ValueError('Strict required checks are necessary for release publication.')
    if not rules:
        raise ValueError('Required release checks must not be empty.')
    output = run('gh', 'api', '--paginate',
                 f'repos/{REPO}/commits/{pr["head"]["sha"]}/check-runs?per_page=100',
                 '--jq', '.check_runs[] | @json')
    checks = [json.loads(line) for line in output.splitlines()]
    for rule in rules:
        candidates = [check for check in checks if check['name'] == rule['context'] and
                      (rule.get('app_id') in (None, -1) or check.get('app', {}).get('id') == rule['app_id'])]
        latest = max(candidates, key=lambda check: check['id'], default={})
        if latest.get('status') != 'completed' or latest.get('conclusion') != 'success':
            raise ValueError(f'Release check has not passed: {rule["context"]}')
    return rules


def release_pulls(state: str) -> list[dict[str, Any]]:
    return api(f'pulls?state={state}&head=OpenFarmPlanner:{BRANCH}&base=main&sort=created&direction=desc&per_page=100')


def verify_release() -> dict[str, Any] | None:
    # Recover a missed push event too: the newest merged release remains discoverable.
    candidates = [pr for pr in release_pulls('closed') if pr.get('merged_at')]
    if not candidates:
        print('No merged release PR to publish.')
        return
    latest = max(candidates, key=lambda candidate: candidate['merged_at'])
    pr = api(f'pulls/{latest["number"]}')
    if pr.get('merged') is not True or pr['state'] != 'closed':
        raise ValueError('Release PR is not merged.')
    plan = approved_plan(pr)
    sha = pr['merge_commit_sha']
    git('merge-base', '--is-ancestor', sha, 'HEAD')
    validate_commit(sha, plan)
    if already_published(plan, sha):
        return None
    rules = require_checks(pr)
    return {'number': pr['number'], 'sha': sha, 'plan': plan, 'checks': rules}


def already_published(plan: dict[str, Any], sha: str) -> bool:
    tag = f'v{plan["version"]}'
    reference = api(f'git/ref/tags/{tag}', missing=True)
    if reference is not None:
        target = reference['object']
        if target['type'] == 'tag':
            target = api(f'git/tags/{target["sha"]}')['object']
        if target.get('type') != 'commit' or target.get('sha') != sha:
            raise ValueError('Existing release tag points elsewhere; it will not be moved.')
    release = api(f'releases/tags/{tag}', missing=True)
    if release:
        if reference is None or release.get('draft') or release['tag_name'] != tag:
            raise ValueError('Existing release is not a published release for the expected tag.')
        print(f'{tag} is already published at {sha}.')
        return True
    return False


def publish(candidate: dict[str, Any]) -> None:
    # The trusted verify job supplies the policy snapshot; this job has no PAT/admin access.
    pr = api(f'pulls/{candidate["number"]}')
    plan, sha = approved_plan(pr), pr['merge_commit_sha']
    if (pr.get('merged') is not True or pr['state'] != 'closed' or
            sha != candidate['sha'] or plan != candidate['plan']):
        raise ValueError('Release changed after verification.')
    git('merge-base', '--is-ancestor', sha, 'HEAD')
    validate_commit(sha, plan)
    if already_published(plan, sha):
        return
    require_checks(pr, candidate['checks'])
    tag = f'v{plan["version"]}'
    if api(f'git/ref/tags/{tag}', missing=True) is None:
        api('git/refs', {'ref': f'refs/tags/{tag}', 'sha': sha})
    git('fetch', 'origin', f'refs/tags/{tag}:refs/tags/{tag}')
    if git('rev-parse', f'{tag}^{{commit}}') != sha:
        raise ValueError('Fetched tag does not identify the verified release commit.')
    # Semantic release requires a configured local branch even for notes-only publication.
    git('switch', '-C', 'main', 'HEAD')
    run('semantic-release', 'changelog', '--post-to-release-tag', tag)
    print(f'Published {tag} at checked merge commit {sha}.')


def prepare() -> None:
    identity = json.loads(run('gh', 'api', 'user'))
    if identity.get('id') != 159707412 or identity.get('login') != 'stipsitzm':
        raise ValueError('RELEASE_PAT must belong to the authorized release owner.')
    if git('status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Release preparation requires a clean checkout.')
    source = git('rev-parse', 'HEAD')
    if source != api('git/ref/heads/main')['object']['sha']:
        print('Main advanced; the next push run will prepare the latest snapshot.')
        return
    git('switch', '-C', 'main', source)
    current = versions(blob(source, 'backend/config/version.py'), blob(source, 'backend/pyproject.toml'))
    printed = run('semantic-release', 'version', '--print')
    if not re.fullmatch(VERSION, printed):
        raise ValueError('Semantic release did not return a stable version.')
    pulls = release_pulls('open')
    if len(pulls) > 1:
        raise ValueError('Multiple release PRs exist; refusing to choose.')
    existing = api(f'pulls/{pulls[0]["number"]}') if pulls else None
    old_plan = approved_plan(existing) if existing else None
    if existing:
        validate_commit(existing['head']['sha'], old_plan)
    if printed == current:
        if existing:
            raise ValueError('An open release PR exists but no new release is pending.')
        if git('tag', '--list', f'v{current}') != f'v{current}':
            raise ValueError('Version metadata advanced without a checked release PR/tag.')
        print('No new semantic version is required.')
        return
    if tuple(map(int, printed.split('.'))) <= tuple(map(int, current.split('.'))):
        raise ValueError('The calculated version must advance the current version.')
    if not existing:
        closed = release_pulls('closed')
        if closed and not closed[0].get('merged_at'):
            raise ValueError('Release PR closed without merging; reopen it before continuing.')
    run('semantic-release', 'version', '--no-commit', '--no-tag', '--no-push',
        '--no-vcs-release', '--skip-build')
    paths = set(git('diff', '--name-only', 'HEAD').splitlines())
    if not FILES <= paths <= ALLOWED_FILES:
        raise ValueError('Semantic release changed unexpected files.')
    plan = {'source': source, 'version': printed, 'files': {
        filename: hashlib.sha256(Path(filename).read_bytes()).hexdigest() for filename in sorted(paths)
    }}
    title = f'chore(release): v{printed}'
    body = (f'Prepare **v{printed}** from main `{source}`.\n\n'
            'This PR changes release metadata only. All required CI and review gates apply. '
            'After squash merge, the release workflow tags this exact merge commit and publishes '
            'the release notes. No deployment is performed.\n\n'
            f'<!-- ofp-release-plan:v1 {json.dumps(plan, sort_keys=True)} -->\n')
    if old_plan == plan:
        head = existing['head']['sha']
    else:
        if source != api('git/ref/heads/main')['object']['sha']:
            print('Main advanced during preparation; the next push run will retry.')
            return
        reference = api(f'git/ref/heads/{BRANCH}', missing=True)
        old_head = reference['object']['sha'] if reference else ''
        if existing and old_head != existing['head']['sha']:
            raise ValueError('Release branch changed during preparation.')
        git('switch', '-C', BRANCH)
        git('add', '--', *sorted(paths))
        git('-c', 'user.name=OpenFarmPlanner release', '-c', 'user.email=release@openfarmplanner.org',
            'commit', '-m', title)
        head = git('rev-parse', 'HEAD')
        validate_commit(head, plan)
        run('gh', 'auth', 'setup-git', '--hostname', 'github.com')
        git('push', f'--force-with-lease=refs/heads/{BRANCH}:{old_head}', 'origin', f'HEAD:refs/heads/{BRANCH}')
    if not existing:
        existing = api('pulls', {'base': 'main', 'head': BRANCH, 'title': title, 'body': body})
    else:
        run('gh', 'api', '--method', 'PATCH', f'repos/{REPO}/pulls/{existing["number"]}',
            '--input', '-', input_text=json.dumps({'title': title, 'body': body}))
    run('gh', 'pr', 'merge', str(existing['number']), '--repo', REPO, '--auto', '--squash',
        '--match-head-commit', head)
    print(f'Release PR #{existing["number"]} awaits required checks; no main push or tag was made.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'verify', 'publish'])
    args = parser.parse_args()
    if args.action == 'verify':
        candidate = verify_release()
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write(f'candidate={json.dumps(candidate) if candidate else ""}\n')
            output.write(f'checkout={git("rev-parse", "HEAD")}\n')
    elif args.action == 'publish':
        publish(json.loads(os.environ['OFP_RELEASE_CANDIDATE']))
    else:
        prepare()
