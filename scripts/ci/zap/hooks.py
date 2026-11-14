"""Seed anonymous GETs and attest coverage from ZAP's own completed HTTP history."""

import json
from pathlib import Path
from urllib.parse import urlsplit

TARGET = 'http://127.0.0.1:4173/'
SEEDS = ['/', '/en', '/fr', '/es', '/api/schema/', '/api/crops/', '/__zap_fixture__/']


def zap_started(zap, target):
    if target != TARGET:
        raise ValueError('Only the hardcoded isolated local target is permitted.')
    for path in SEEDS:
        zap.core.access_url(TARGET.rstrip('/') + path, followredirects=False)


def zap_pre_shutdown(zap):
    messages = zap.core.messages(baseurl=TARGET, start=0, count=5000)
    requests = []
    for message in messages:
        method, url, _version = message['requestHeader'].splitlines()[0].split(' ', 2)
        parsed = urlsplit(url)
        if parsed.scheme != 'http' or parsed.netloc != '127.0.0.1:4173':
            raise ValueError('Unexpected scan origin.')
        if method not in {'GET', 'HEAD'}:
            raise ValueError('Unexpected request method.')
        response_lines = message['responseHeader'].splitlines()
        # A request without a response (timeout, connection error) is a coverage gap.
        status = int(response_lines[0].split(' ')[1]) if response_lines else 0
        requests.append({'method': method, 'path': parsed.path, 'status': status})
    coverage = {
        'target': TARGET,
        'passive_remaining': int(zap.pscan.records_to_scan),
        'requests': requests,
    }
    Path('/zap/wrk/coverage.json').write_text(json.dumps(coverage, indent=2) + '\n')
