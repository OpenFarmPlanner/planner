import bz2
import json
import zlib
from unittest.mock import patch

from django.utils.http import parse_header_parameters
from rest_framework.test import APITestCase


class DrfRequestSafetyTests(APITestCase):
    def test_public_json_endpoints_reject_compression_charsets(self) -> None:
        payload = json.dumps({'website': 'A' * 8192}).encode()
        for prefix in ('/api', '/openfarmplanner/api'):
            for endpoint in ('login', 'register'):
                for charset, compress in (
                    ('bz2', bz2.compress),
                    ('bz2_codec', bz2.compress),
                    ('zlib', zlib.compress),
                    ('zlib_codec', zlib.compress),
                ):
                    with self.subTest(prefix=prefix, endpoint=endpoint, charset=charset):
                        response = self.client.post(
                            f'{prefix}/auth/{endpoint}/',
                            compress(payload),
                            content_type=f'application/json; charset={charset}',
                        )

                        self.assertEqual(response.status_code, 400)
                        self.assertEqual(response.data['detail'].code, 'parse_error')

    def test_public_json_endpoint_preserves_text_charsets_and_validation_errors(self) -> None:
        for charset in ('utf-8', 'utf-16', 'iso-8859-1'):
            with self.subTest(charset=charset):
                response = self.client.post(
                    '/api/auth/login/',
                    '{}'.encode(charset),
                    content_type=f'application/json; charset={charset}',
                )

                self.assertEqual(response.status_code, 400)
                self.assertEqual(set(response.data), {'email', 'password'})

    def test_oversized_accept_tokens_do_not_reach_the_parameter_parser(self) -> None:
        header = ','.join(f'text/x-test{i}; x{i}="' + ';' * 8100 + '"' for i in range(2))
        with patch(
            'rest_framework.utils.mediatypes.parse_header_parameters',
            wraps=parse_header_parameters,
        ) as parse_header:
            response = self.client.get('/api/auth/csrf/', HTTP_ACCEPT=header)

        self.assertEqual(response.status_code, 406)
        self.assertTrue(all(len(call.args[0]) <= 256 for call in parse_header.call_args_list))

    def test_accept_token_budget_does_not_negotiate_an_unbounded_tail(self) -> None:
        header = ','.join([f'text/x-test{i}' for i in range(96)] + ['application/json'])

        response = self.client.get('/api/auth/csrf/', HTTP_ACCEPT=header)

        self.assertEqual(response.status_code, 406)

    def test_normal_accept_headers_still_set_the_csrf_cookie(self) -> None:
        for accept in ('application/json', 'text/html', '*/*', 'text/plain, application/json'):
            with self.subTest(accept=accept):
                response = self.client.get('/api/auth/csrf/', HTTP_ACCEPT=accept)

                self.assertEqual(response.status_code, 200)
                self.assertIn('csrftoken', response.cookies)
