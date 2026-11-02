#!/usr/bin/env python3
"""Mutation battery: break production code one edit at a time and record
whether a test suite notices.

A suite that passes proves its assertions run, not that they would fail if the
code were wrong. This runner answers the second question: for each mutation it
patches the source, runs one spec, and classifies the result as CAUGHT (the
suite failed, as it should) or SURVIVED (the suite still passed, so nothing
asserts that behaviour).

Mutations are a JSON list; `old` must occur exactly once in `file` unless
`index` names which occurrence to take:

    [
      {"name": "drops the trim", "file": "frontend/src/x.ts",
       "old": "value.trim()", "new": "value"},
      {"name": "inverts the guard", "file": "frontend/src/x.ts",
       "old": "if (!rows.length)", "new": "if (rows.length)", "index": 2}
    ]

Every source file is restored from memory in a finally block, so an aborted
run leaves the checkout as it was. Run it in a throwaway git worktree anyway:
the suite is slow enough that an interrupt is likely, and a dirty main
checkout is worse than a wasted worktree.

Usage:
    python3 mutate.py --spec frontend/src/__tests__/Foo.test.tsx \\
        --mutations /path/to/mutations.json
    python3 mutate.py --spec backend/farm/tests/test_x.py \\
        --mutations /path/to/mutations.json --only "guard"
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

CAUGHT = "CAUGHT"
SURVIVED = "SURVIVED"
SKIPPED = "SKIPPED"


@dataclass(frozen=True)
class Mutation:
    name: str
    file: str
    old: str
    new: str
    index: int = 1
    index_given: bool = False


@dataclass(frozen=True)
class Runner:
    cwd: Path
    command: list[str]


def repo_root(start: Path) -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=start,
        capture_output=True,
        text=True,
        check=True,
    )
    return Path(result.stdout.strip())


def load_mutations(path: Path) -> list[Mutation]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise SystemExit(f"{path}: expected a non-empty JSON list of mutations")
    mutations: list[Mutation] = []
    for entry in raw:
        missing = [key for key in ("name", "file", "old", "new") if key not in entry]
        if missing:
            raise SystemExit(f"{path}: mutation {entry!r} is missing {missing}")
        mutations.append(
            Mutation(
                name=entry["name"],
                file=entry["file"],
                old=entry["old"],
                new=entry["new"],
                index=int(entry.get("index", 1)),
                index_given="index" in entry,
            )
        )
    return mutations


def build_runner(root: Path, spec: str, command: str | None) -> Runner:
    """Pick the suite command from the spec's location unless one is given."""
    spec_path = (root / spec).resolve()
    if command:
        return Runner(cwd=root, command=["bash", "-c", command])
    if "frontend" in spec_path.parts:
        relative = spec_path.relative_to(root / "frontend")
        return Runner(cwd=root / "frontend", command=["npx", "vitest", "run", str(relative)])
    if "backend" in spec_path.parts:
        relative = spec_path.relative_to(root / "backend")
        return Runner(
            cwd=root / "backend",
            command=[".venv/bin/python", "-m", "pytest", "-o", "addopts=", "-q", str(relative)],
        )
    raise SystemExit(f"cannot infer a runner for {spec}; pass --command")


def run_suite(runner: Runner, timeout: int) -> tuple[int, str]:
    try:
        result = subprocess.run(
            runner.command,
            cwd=runner.cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    return result.returncode, (result.stdout + result.stderr)[-4000:]


def apply_mutation(source: str, mutation: Mutation) -> str:
    """Replace the `index`-th occurrence of `old`, or refuse to guess."""
    occurrences = source.count(mutation.old)
    if occurrences == 0:
        raise ValueError("the snippet does not occur in the file")
    if mutation.index < 1 or mutation.index > occurrences:
        raise ValueError(f"index {mutation.index} out of range ({occurrences} occurrences)")
    if occurrences > 1 and not mutation.index_given:
        raise ValueError(
            f"the snippet occurs {occurrences} times; extend it or set an explicit index"
        )
    cut = -1
    for _ in range(mutation.index):
        cut = source.index(mutation.old, cut + 1)
    return source[:cut] + mutation.new + source[cut + len(mutation.old) :]


def preflight(runner: Runner, spec: str, timeout: int) -> None:
    """Refuse to report anything until the unmutated suite passes.

    Without this gate a bad command, a missing flag or a broken import makes
    every run exit non-zero, which reads as a perfect battery: 34 of 34 caught
    while nothing was tested at all.
    """
    print(f"pre-flight: {spec} unmutated ...", flush=True)
    code, output = run_suite(runner, timeout)
    if code != 0:
        print("PRE-FLIGHT FAILED -- the unmutated suite does not pass:")
        print(output)
        raise SystemExit(1)
    print("pre-flight ok\n", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, help="test file to run, relative to the repo root")
    parser.add_argument("--mutations", required=True, type=Path, help="JSON list of mutations")
    parser.add_argument(
        "--command",
        help="suite command instead of the default, run with bash -c from the repo root",
    )
    parser.add_argument("--only", help="run only mutations whose name contains this text")
    parser.add_argument("--timeout", type=int, default=600, help="per-run timeout in seconds")
    args = parser.parse_args()

    root = repo_root(Path.cwd())
    mutations = load_mutations(args.mutations)
    if args.only:
        mutations = [m for m in mutations if args.only.lower() in m.name.lower()]
        if not mutations:
            raise SystemExit(f"no mutation name contains {args.only!r}")
    runner = build_runner(root, args.spec, args.command)

    preflight(runner, args.spec, args.timeout)

    results: list[tuple[str, str, str]] = []
    for number, mutation in enumerate(mutations, start=1):
        target = root / mutation.file
        original = target.read_text(encoding="utf-8")
        label = f"[{number}/{len(mutations)}] {mutation.name}"
        try:
            mutated = apply_mutation(original, mutation)
        except ValueError as error:
            print(f"{label}: {SKIPPED} -- {error}", flush=True)
            results.append((SKIPPED, mutation.name, str(error)))
            continue
        try:
            target.write_text(mutated, encoding="utf-8")
            code, output = run_suite(runner, args.timeout)
        finally:
            target.write_text(original, encoding="utf-8")
        if code == 0:
            print(f"{label}: {SURVIVED}", flush=True)
            results.append((SURVIVED, mutation.name, ""))
        else:
            print(f"{label}: {CAUGHT}", flush=True)
            results.append((CAUGHT, mutation.name, output if code == 124 else ""))

    caught = [row for row in results if row[0] == CAUGHT]
    survived = [row for row in results if row[0] == SURVIVED]
    skipped = [row for row in results if row[0] == SKIPPED]
    print("\n=== summary ===")
    print(f"caught {len(caught)}/{len(results)}, survived {len(survived)}, skipped {len(skipped)}")
    for status, name, detail in results:
        if status != CAUGHT:
            suffix = f" -- {detail}" if detail else ""
            print(f"{status}: {name}{suffix}")
    print(
        "\nA SURVIVED line is either a weak test or a redundant line of production code;\n"
        "decide which, and record the second kind at the suite instead of contriving a fixture.\n"
        "A SKIPPED line never ran: fix the snippet and run it again."
    )
    return 1 if survived or skipped else 0


if __name__ == "__main__":
    sys.exit(main())
