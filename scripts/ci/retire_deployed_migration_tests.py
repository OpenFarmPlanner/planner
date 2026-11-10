"""Delete the tests of data migrations that production already runs.

A migration test guards a migration until it has run on production; after
that its code is frozen and the data it transformed is gone, so the test only
costs time, and every newer migration makes it slower (docs/testing-and-ci.md,
"Retiring migration tests"). Production's public ``/api/version/`` names the
release it runs, and every release has a ``v<version>`` tag.

A test file is retired when *every* migration it references (as
``('app', '0123_name')`` or ``app.migrations.0123_name``) exists in that tag.
A file that references no migration, or one this checkout does not have, is
kept. Only test files are deleted, never migrations.

Exit codes: 0 nothing to retire, 1 files retired (or listed with --dry-run),
2 the check itself failed.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = 'backend'
PRODUCTION_VERSION_URL = 'https://openfarmplanner.org/api/version/'

# A migration test drives the migration executor itself or uses the shared base.
MIGRATION_TEST_MARKERS = ('MigrationExecutor', 'MigrationTestBase')
MIGRATION_TUPLE = re.compile(r"\(\s*'([a-z_]+)'\s*,\s*'(\d{4}_[A-Za-z0-9_]+)'\s*\)")
MIGRATION_MODULE = re.compile(r'\b([a-z_]+)\.migrations\.(\d{4}_[A-Za-z0-9_]+)\b')
VERSION = re.compile(r'^\d+\.\d+\.\d+$')

Migration = tuple[str, str]


@dataclass(frozen=True)
class Verdict:
    path: str
    migrations: frozenset[Migration]
    missing_in_production: frozenset[Migration]
    unknown: frozenset[Migration]

    @property
    def retire(self) -> bool:
        return bool(self.migrations) and not self.missing_in_production and not self.unknown


def referenced_migrations(source: str) -> frozenset[Migration]:
    """The migrations a test file names, as (app label, migration name)."""
    found = set(MIGRATION_TUPLE.findall(source)) | set(MIGRATION_MODULE.findall(source))
    return frozenset(found)


def migration_path(migration: Migration) -> str:
    app, name = migration
    return f'{BACKEND}/{app}/migrations/{name}.py'


def is_migration_test(source: str) -> bool:
    return any(marker in source for marker in MIGRATION_TEST_MARKERS)


def migration_test_files(repo_root: Path) -> list[Path]:
    """Test modules under backend/<app>/tests that exercise migrations."""
    files = []
    for path in sorted((repo_root / BACKEND).glob('*/tests/test_*.py')):
        if is_migration_test(path.read_text(encoding='utf-8')):
            files.append(path)
    return files


def exists_in_ref(repo_root: Path, ref: str, path: str) -> bool:
    result = subprocess.run(
        ['git', 'cat-file', '-e', f'{ref}:{path}'],
        cwd=repo_root,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def ref_exists(repo_root: Path, ref: str) -> bool:
    result = subprocess.run(
        ['git', 'rev-parse', '--verify', '--quiet', f'{ref}^{{commit}}'],
        cwd=repo_root,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def fetch_tag(repo_root: Path, ref: str) -> None:
    subprocess.run(
        ['git', 'fetch', '--quiet', '--depth=1', 'origin', f'refs/tags/{ref}:refs/tags/{ref}'],
        cwd=repo_root,
        capture_output=True,
        check=False,
    )


def judge(repo_root: Path, ref: str, files: Iterable[Path]) -> list[Verdict]:
    verdicts = []
    for path in files:
        migrations = referenced_migrations(path.read_text(encoding='utf-8'))
        unknown = frozenset(m for m in migrations if not (repo_root / migration_path(m)).is_file())
        missing = frozenset(
            m for m in migrations - unknown if not exists_in_ref(repo_root, ref, migration_path(m))
        )
        verdicts.append(Verdict(
            path=path.relative_to(repo_root).as_posix(),
            migrations=migrations,
            missing_in_production=missing,
            unknown=unknown,
        ))
    return verdicts


def fetch_production_version(url: str = PRODUCTION_VERSION_URL) -> str:
    request = urllib.request.Request(url, headers={
        'Accept': 'application/json',
        'User-Agent': 'OpenFarmPlanner-CI retire-deployed-migration-tests',
    })
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - fixed https URL
        payload = json.load(response)
    version = payload.get('version') if isinstance(payload, dict) else None
    if not isinstance(version, str) or not VERSION.match(version):
        raise ValueError(f'unexpected version payload from {url}: {payload!r}')
    return version


def render_report(ref: str, verdicts: list[Verdict]) -> str:
    retired = [v for v in verdicts if v.retire]
    kept = [v for v in verdicts if not v.retire]
    lines = [
        f'Production runs `{ref}`. Every migration these test files reference is part of that '
        'release, so the tests have done their job and are removed (docs/testing-and-ci.md, '
        '"Retiring migration tests"). Migrations themselves are untouched.',
        '',
        '| retired test file | migrations |',
        '| --- | --- |',
    ]
    for verdict in retired:
        names = ', '.join(f'`{app}.{name}`' for app, name in sorted(verdict.migrations))
        lines.append(f'| `{verdict.path}` | {names} |')
    if kept:
        lines += [
            '',
            f'Kept: {len(kept)} migration test file(s) whose migrations are not all '
            'in production yet.',
        ]
    return '\n'.join(lines) + '\n'


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--version', help='production version (default: ask production)')
    parser.add_argument('--report', type=Path, help='write a Markdown summary of the retired files')
    parser.add_argument('--dry-run', action='store_true', help='list the files, delete nothing')
    parser.add_argument(
        '--fetch-tag', action='store_true', help='fetch a missing release tag from origin',
    )
    parser.add_argument('--github-output', type=Path, help='append version=<v> to this file')
    return parser.parse_args(argv)


def resolve_release_tag(version: str, fetch: bool) -> str:
    """The ``v<version>`` tag production runs, present in this checkout."""
    if not VERSION.match(version):
        raise ValueError(f'not a release version: {version!r}')
    ref = f'v{version}'
    if fetch and not ref_exists(REPO_ROOT, ref):
        fetch_tag(REPO_ROOT, ref)
    if not ref_exists(REPO_ROOT, ref):
        raise ValueError(f'release tag {ref} not found (fetched from origin with --fetch-tag)')
    return ref


def warn_about_unknown_migrations(verdicts: list[Verdict]) -> None:
    for verdict in verdicts:
        if verdict.unknown:
            names = ', '.join(f'{app}.{name}' for app, name in sorted(verdict.unknown))
            message = f'warning: {verdict.path} names migrations this checkout lacks: {names}'
            print(message, file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        version = args.version or fetch_production_version()
        ref = resolve_release_tag(version, fetch=args.fetch_tag)
        verdicts = judge(REPO_ROOT, ref, migration_test_files(REPO_ROOT))
    except (OSError, ValueError) as error:
        print(f'retire-migration-tests: {error}', file=sys.stderr)
        return 2

    if args.github_output:
        with args.github_output.open('a', encoding='utf-8') as output:
            output.write(f'version={version}\n')
    warn_about_unknown_migrations(verdicts)

    retired = [verdict for verdict in verdicts if verdict.retire]
    for verdict in retired:
        print(verdict.path)
        if not args.dry_run:
            (REPO_ROOT / verdict.path).unlink()
    if retired and args.report:
        args.report.write_text(render_report(ref, verdicts), encoding='utf-8')
    return 1 if retired else 0


if __name__ == '__main__':
    sys.exit(main())
