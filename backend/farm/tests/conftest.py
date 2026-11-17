"""Farm test fixtures: the history-completeness guard (farm/tests/history_guard.py)."""

import re
from collections.abc import Iterator

import pytest

from farm.tests import history_guard


def _marker_reason(marker: pytest.Mark) -> str:
    reason = marker.kwargs.get('reason') or (marker.args[0] if marker.args else '')
    if not str(reason).strip():
        raise pytest.UsageError(f'@pytest.mark.{marker.name} needs a reason.')
    return str(reason)


def _marker_issues(marker: pytest.Mark) -> tuple[int, ...]:
    issues = marker.kwargs.get('issue')
    issues = issues if isinstance(issues, tuple) else (issues,)
    if not issues or not all(isinstance(issue, int) for issue in issues):
        raise pytest.UsageError(
            '@pytest.mark.history_gap needs issue=<number> or issue=(<number>, ...).'
        )
    return issues


@pytest.fixture(autouse=True)
def history_completeness_guard(request: pytest.FixtureRequest) -> Iterator[None]:
    """Fail a test when a successful API write is not reproduced by the latest version.

    `history_guard_exempt(reason=...)` switches the check off for a test that
    deliberately creates untracked or legacy history. `history_gap(issue=N,
    reason=...)` marks a known, tracked defect: the test's own assertions keep
    running, the gap is expected, and the test fails once no gap occurs so the
    fix has to remove the marker. With `match=<regex>` only gap lines matching
    it are tolerated; any other gap still fails the test.
    """
    exempt = request.node.get_closest_marker('history_guard_exempt')
    if exempt is not None:
        _marker_reason(exempt)
        yield
        return
    known = request.node.get_closest_marker('history_gap')
    pattern = None
    if known is not None:
        _marker_reason(known)
        issues = _marker_issues(known)
        pattern = re.compile(known.kwargs['match']) if known.kwargs.get('match') else None
    found: list[str] = []
    raised: list[str] = []

    def on_gap(message: str) -> None:
        header, *lines = message.split('\n')
        unexpected = [line for line in lines if pattern is not None and not pattern.search(line)]
        if known is None or unexpected:
            raised.append(message)
            raise history_guard.HistoryGap('\n'.join([header, *(unexpected or lines)]))
        found.append(message)

    yield from history_guard.install(on_gap)
    if known is not None and not found and not raised:
        pytest.fail(
            f'No history gap occurred any more; remove @pytest.mark.history_gap(issue={issues}) '
            'and close the gap issue if this was its last marker.',
            pytrace=False,
        )
