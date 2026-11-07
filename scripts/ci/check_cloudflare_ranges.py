"""Compare the Cloudflare ranges in backend/.env.example with Cloudflare's list.

`TRUSTED_PROXY_UPSTREAM_CIDRS` is copied by hand into each server's backend
`.env` (docs/account-trust-levels.md), and nothing updates it at runtime. This
check runs on a schedule and reports when Cloudflare's published list differs.

Exit codes: 0 = identical, 1 = changed (report written), 2 = check failed.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

CLOUDFLARE_IPS_URL = 'https://api.cloudflare.com/client/v4/ips'
ENV_EXAMPLE = Path(__file__).resolve().parents[2] / 'backend' / '.env.example'
_REFERENCE_LINE = re.compile(r'^#?\s*TRUSTED_PROXY_UPSTREAM_CIDRS=(?P<value>\S+)\s*$', re.MULTILINE)

Network = ipaddress.IPv4Network | ipaddress.IPv6Network


@dataclass(frozen=True)
class RangeDiff:
    added: list[Network]
    removed: list[Network]

    @property
    def changed(self) -> bool:
        return bool(self.added or self.removed)


def parse_networks(values: list[str]) -> set[Network]:
    return {ipaddress.ip_network(value.strip(), strict=True) for value in values if value.strip()}


def read_reference(env_example_text: str) -> set[Network]:
    """The ranges of the (commented) TRUSTED_PROXY_UPSTREAM_CIDRS example line."""
    match = _REFERENCE_LINE.search(env_example_text)
    if match is None:
        raise ValueError('No TRUSTED_PROXY_UPSTREAM_CIDRS line found in backend/.env.example.')
    return parse_networks(match.group('value').split(','))


def parse_cloudflare_response(payload: object) -> set[Network]:
    if not isinstance(payload, dict) or payload.get('success') is not True:
        raise ValueError('Cloudflare did not return a successful IP list.')
    result = payload.get('result')
    if not isinstance(result, dict):
        raise ValueError('Cloudflare IP list has no result object.')
    values = [*result.get('ipv4_cidrs', []), *result.get('ipv6_cidrs', [])]
    if not values:
        raise ValueError('Cloudflare returned an empty IP list.')
    return parse_networks(values)


def fetch_cloudflare_ranges(url: str = CLOUDFLARE_IPS_URL) -> set[Network]:
    request = urllib.request.Request(url, headers={'User-Agent': 'OpenFarmPlanner range check'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return parse_cloudflare_response(json.load(response))


def _sorted(networks: set[Network]) -> list[Network]:
    return sorted(networks, key=lambda network: (network.version, network))


def compare(reference: set[Network], current: set[Network]) -> RangeDiff:
    return RangeDiff(added=_sorted(current - reference), removed=_sorted(reference - current))


def render_report(diff: RangeDiff, current: set[Network]) -> str:
    lines = ['Cloudflare\'s published IP ranges no longer match `backend/.env.example`.', '']
    if diff.added:
        lines += ['**Added by Cloudflare** (not trusted yet):', *[f'- `{n}`' for n in diff.added], '']
    if diff.removed:
        lines += ['**Removed by Cloudflare** (still trusted here):', *[f'- `{n}`' for n in diff.removed], '']
    new_value = ','.join(str(network) for network in _sorted(current))
    lines += [
        'New value:',
        '',
        '```',
        f'TRUSTED_PROXY_UPSTREAM_CIDRS={new_value}',
        '```',
        '',
        'To do (see docs/account-trust-levels.md):',
        '- [ ] Update the example line and its "checked" date in `backend/.env.example` (PR)',
        '- [ ] Update `TRUSTED_PROXY_UPSTREAM_CIDRS` in the staging backend `.env`, restart gunicorn and daphne',
        '- [ ] Same on production',
        '- [ ] Close this issue',
    ]
    return '\n'.join(lines) + '\n'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--report', type=Path, help='Write the Markdown report here when the ranges changed.')
    args = parser.parse_args(argv)
    try:
        reference = read_reference(ENV_EXAMPLE.read_text(encoding='utf-8'))
        current = fetch_cloudflare_ranges()
    except (OSError, ValueError) as error:
        print(f'Range check failed: {error}', file=sys.stderr)
        return 2
    diff = compare(reference, current)
    if not diff.changed:
        print(f'Cloudflare ranges unchanged ({len(current)} ranges).')
        return 0
    report = render_report(diff, current)
    print(report)
    if args.report:
        args.report.write_text(report, encoding='utf-8')
    return 1


if __name__ == '__main__':
    sys.exit(main())
