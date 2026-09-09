from django.test import SimpleTestCase
from rest_framework import status

from config.responses import api_error_response


class ApiErrorResponseTests(SimpleTestCase):
    def test_builds_stable_error_envelope_with_context(self) -> None:
        response = api_error_response(
            code='invalid_example',
            detail='The example is invalid.',
            status_code=status.HTTP_400_BAD_REQUEST,
            field='example',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data, {
            'code': 'invalid_example',
            'detail': 'The example is invalid.',
            'field': 'example',
        })
