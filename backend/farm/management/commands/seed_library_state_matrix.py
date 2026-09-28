"""Seed every cell of the crop-library state matrix. Development only."""

from __future__ import annotations

import json
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from farm.dev_fixtures.library_state_matrix import (
    ESTABLISHED_USERNAME,
    MATRIX_PASSWORD,
    NEW_USERNAME,
    build_library_state_matrix,
)


class Command(BaseCommand):
    help = (
        'Idempotently build every cell of the crop-library state matrix '
        '(docs/crop-library-state-matrix.md). Refuses to run unless DEBUG is on.'
    )

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            '--json', action='store_true', help='Print the cells as JSON (for the Playwright exploration).',
        )

    def handle(self, *args: Any, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError('seed_library_state_matrix only runs with DEBUG=True.')
        fixture = build_library_state_matrix()
        if options['json']:
            self.stdout.write(json.dumps({
                'password': MATRIX_PASSWORD,
                'cells': [
                    {
                        'key': cell.key,
                        'email': fixture.users[cell.username].email,
                        'cropId': cell.crop_id,
                        'publicCropId': cell.public_crop_id,
                        'entryStatus': cell.expected['source_public_crop_status'],
                    }
                    for cell in fixture.cells.values()
                ],
            }))
            return
        for cell in fixture.cells.values():
            self.stdout.write(f'{cell.key}: crop {cell.crop_id} ({cell.username})')
        self.stdout.write(self.style.SUCCESS(
            f'{len(fixture.cells)} cells ready. Log in as {ESTABLISHED_USERNAME} or '
            f'{NEW_USERNAME} with password "{MATRIX_PASSWORD}".',
        ))
