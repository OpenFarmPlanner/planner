#!/usr/bin/env python3
"""Count hand-written lines of code in the repository.

Only files tracked by git are considered, so build output, node_modules,
virtualenvs and media are skipped via .gitignore. Generated or non-code
files (migrations, lockfiles, screenshot baselines, translation bundles,
docs) are excluded on top of that. Blank lines are not counted.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections import defaultdict
from pathlib import Path, PurePosixPath

REPO_ROOT = Path(__file__).resolve().parents[1]

LANGUAGES: dict[str, str] = {
    '.py': 'Python',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript (TSX)',
    '.mts': 'TypeScript',
    '.js': 'JavaScript',
    '.css': 'CSS',
    '.html': 'HTML',
    '.sh': 'Shell',
    '.yml': 'YAML',
    '.yaml': 'YAML',
    '.toml': 'TOML',
}

EXCLUDED_DIR_PARTS: frozenset[str] = frozenset({
    'migrations',
    'node_modules',
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
})

EXCLUDED_SUFFIXES: tuple[str, ...] = (
    '.min.js',
    '.d.ts',
)

EXCLUDED_FILENAMES: frozenset[str] = frozenset({
    'package-lock.json',
    'pdm.lock',
})


def tracked_files() -> list[PurePosixPath]:
    """Return all files tracked by git, relative to the repository root."""
    output = subprocess.run(
        ['git', 'ls-files', '-z'],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    ).stdout.decode()
    return [PurePosixPath(name) for name in output.split('\0') if name]


def is_excluded(path: PurePosixPath) -> bool:
    """Return True for generated, vendored or non-code files."""
    if path.name in EXCLUDED_FILENAMES:
        return True
    if any(part in EXCLUDED_DIR_PARTS for part in path.parts):
        return True
    if any(part.endswith('-snapshots') for part in path.parts):
        return True
    return path.name.endswith(EXCLUDED_SUFFIXES)


def is_test(path: PurePosixPath) -> bool:
    """Return True for test code (unit, integration and end-to-end)."""
    name = path.name
    if any(part in {'tests', '__tests__', 'e2e', 'e2e-cross-browser'} for part in path.parts):
        return True
    if name.startswith('test_') or name == 'conftest.py':
        return True
    return any(marker in name for marker in ('.test.', '.spec.'))


def area_of(path: PurePosixPath) -> str:
    """Return the top-level area a file belongs to."""
    top = path.parts[0] if len(path.parts) > 1 else '(root)'
    return top if top in {'backend', 'frontend'} else 'other'


def count_lines(path: Path) -> int:
    """Count non-blank lines of a text file."""
    with path.open(encoding='utf-8', errors='replace') as handle:
        return sum(1 for line in handle if line.strip())


def print_table(title: str, rows: dict[str, list[int]]) -> None:
    """Print a table of name -> [files, lines], sorted by lines descending."""
    width = max([len(title), *(len(name) for name in rows)])
    print(f'\n{title:<{width}}  {"files":>7}  {"lines":>9}')
    print('-' * (width + 20))
    for name, (files, lines) in sorted(rows.items(), key=lambda item: -item[1][1]):
        print(f'{name:<{width}}  {files:>7}  {lines:>9,}')
    total_files = sum(files for files, _ in rows.values())
    total_lines = sum(lines for _, lines in rows.values())
    print('-' * (width + 20))
    print(f'{"Total":<{width}}  {total_files:>7}  {total_lines:>9,}')


def main() -> int:
    """Collect and print line counts."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        '--no-tests', action='store_true', help='exclude test code entirely',
    )
    args = parser.parse_args()

    by_area: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_language: dict[str, list[int]] = defaultdict(lambda: [0, 0])

    for path in tracked_files():
        language = LANGUAGES.get(path.suffix)
        if language is None or is_excluded(path):
            continue
        test = is_test(path)
        if test and args.no_tests:
            continue
        absolute = REPO_ROOT / path
        if not absolute.is_file():
            continue
        lines = count_lines(absolute)
        kind = 'tests' if test else 'source'
        for bucket, key in ((by_area, f'{area_of(path)} / {kind}'), (by_language, language)):
            bucket[key][0] += 1
            bucket[key][1] += lines

    print_table('Area', by_area)
    print_table('Language', by_language)
    return 0


if __name__ == '__main__':
    sys.exit(main())
