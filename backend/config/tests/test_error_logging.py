import io
import logging
from collections.abc import Callable

from django.core import mail
from django.db import IntegrityError, transaction
from django.http import HttpRequest, HttpResponse
from django.test import SimpleTestCase, override_settings
from django.urls import path


@transaction.non_atomic_requests
def _server_error(_request: HttpRequest) -> HttpResponse:
    raise IntegrityError('Test crop constraint failure')


urlpatterns = [path('server-error/', _server_error)]


@override_settings(
    DEBUG=False,
    ADMINS=[('Alerts', 'alerts@example.org')],
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    ALLOWED_HOSTS=['allowed.example'],
    ROOT_URLCONF=__name__,
)
class ProductionErrorLoggingTests(SimpleTestCase):
    """Keep production errors observable without rejected-host email noise."""

    def _captured_output(self, emit: Callable[[logging.Logger], None]) -> str:
        handler = logging.getHandlerByName('error_console')
        self.assertIsNotNone(handler)
        stream = io.StringIO()
        previous = handler.setStream(stream)
        self.addCleanup(handler.setStream, previous)
        emit(logging.getLogger('django.request'))
        return stream.getvalue()

    @override_settings(DEBUG=False, ADMINS=[])
    def test_unhandled_exception_is_written_with_its_traceback(self) -> None:
        def emit(logger: logging.Logger) -> None:
            try:
                raise ValueError('boom')
            except ValueError:
                logger.error('Internal Server Error: /api/fields/', exc_info=True)

        output = self._captured_output(emit)

        self.assertIn('Internal Server Error: /api/fields/', output)
        self.assertIn('ValueError: boom', output)

    @override_settings(DEBUG=False)
    def test_client_errors_stay_out_of_the_error_log(self) -> None:
        output = self._captured_output(lambda logger: logger.warning('Not Found: /api/nope/'))

        self.assertEqual(output, '')

    def test_disallowed_host_is_rejected_and_logged_without_email(self) -> None:
        def emit(_logger: logging.Logger) -> None:
            response = self.client.get('/api/.env', HTTP_HOST='openfarm.uber.space')
            self.assertEqual(response.status_code, 400)

        output = self._captured_output(emit)

        self.assertIn('DisallowedHost', output)
        self.assertIn('openfarm.uber.space', output)
        self.assertEqual(mail.outbox, [])

    def test_integrity_error_500_still_logs_and_emails(self) -> None:
        self.client.raise_request_exception = False

        def emit(_logger: logging.Logger) -> None:
            response = self.client.get('/server-error/', HTTP_HOST='allowed.example')
            self.assertEqual(response.status_code, 500)

        output = self._captured_output(emit)

        self.assertIn('IntegrityError: Test crop constraint failure', output)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('IntegrityError', mail.outbox[0].body)

    def test_other_security_errors_still_log_and_email(self) -> None:
        output = self._captured_output(lambda _logger: logging.getLogger(
            'django.security.SuspiciousOperation',
        ).error('Another security error'))

        self.assertIn('Another security error', output)
        self.assertEqual(len(mail.outbox), 1)

    def test_message_mentioning_disallowed_host_does_not_suppress_other_errors(self) -> None:
        output = self._captured_output(lambda logger: logger.error(
            'Application failed while processing a DisallowedHost report',
        ))

        self.assertIn('Application failed', output)
        self.assertEqual(len(mail.outbox), 1)
