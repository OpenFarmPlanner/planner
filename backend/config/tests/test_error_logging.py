import io
import logging
from collections.abc import Callable

from django.test import SimpleTestCase, override_settings


class ProductionErrorLoggingTests(SimpleTestCase):
    """A production 500 must reach the error log even when ADMINS is empty."""

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
