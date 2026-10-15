from __future__ import annotations

from argparse import ArgumentParser
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from accounts.registration_alerts import RegistrationFailure, send_test_alert


class Command(BaseCommand):
    """Send a test registration failure alert through the real delivery path."""

    help = (
        'Send a test registration failure alert to REGISTRATION_ALERT_EMAILS, using the '
        'configured email backend and ignoring the per-type cooldown.'
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument(
            '--type',
            dest='failure_type',
            choices=[failure.value for failure in RegistrationFailure],
            default=RegistrationFailure.SERVER_ERROR.value,
            help='Failure type shown in the subject and body (default: server_error).',
        )

    def handle(self, *args: Any, **options: Any) -> None:
        failure = RegistrationFailure(options['failure_type'])
        try:
            recipients = send_test_alert(failure)
        except ValueError as exc:
            raise CommandError(f'{exc} Set it to one or more comma-separated addresses.') from exc
        except Exception as exc:  # noqa: BLE001
            raise CommandError(
                f'Sending the test alert failed: {type(exc).__name__}: {exc}'
            ) from exc
        self.stdout.write(
            self.style.SUCCESS(f'Test alert "{failure.value}" sent to {", ".join(recipients)}.')
        )
