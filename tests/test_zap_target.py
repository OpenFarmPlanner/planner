import importlib.util
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/ci/zap/target.py'
spec = importlib.util.spec_from_file_location('zap_target', SOURCE)
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)


class ScanTargetTests(unittest.TestCase):
    def setUp(self):
        self.files = tempfile.TemporaryDirectory()
        self.dist = Path(self.files.name) / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('production prerender')
        (self.dist / 'app-shell.html').write_text('production SPA shell')
        self.directory = patch.object(target, 'DIST', self.dist)
        self.directory.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), target.ScanTarget)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.directory.stop()
        self.files.cleanup()

    def test_serves_prerender_and_spa_without_a_remote_server(self):
        with urlopen(self.origin + '/') as response:
            self.assertEqual(response.read(), b'production prerender')
        with urlopen(self.origin + '/app/crops') as response:
            self.assertEqual(response.read(), b'production SPA shell')

    def test_benign_fixture_has_no_nosniff_header(self):
        with urlopen(self.origin + '/__zap_fixture__/') as response:
            self.assertEqual(response.status, 200)
            self.assertIsNone(response.getheader('X-Content-Type-Options'))
            self.assertIn(b'synthetic ZAP', response.read())

    def test_request_paths_and_symlinks_cannot_expose_files_outside_the_build(self):
        private = Path(self.files.name) / 'private.txt'
        private.write_text('must never be served')
        (self.dist / 'link.txt').symlink_to(private)
        for route in ['/../private.txt', '/%2e%2e/private.txt', '/link.txt']:
            with self.subTest(route=route), urlopen(self.origin + route) as response:
                self.assertEqual(response.read(), b'production SPA shell')

    def test_static_asset_and_prerender_routes_use_the_build_manifest(self):
        (self.dist / 'assets').mkdir()
        (self.dist / 'assets' / 'example.js').write_text('public asset')
        (self.dist / 'en').mkdir()
        (self.dist / 'en' / 'index.html').write_text('English prerender')
        for route, content in [
            ('/assets/example.js?cache=1', b'public asset'),
            ('/en', b'English prerender'), ('/en/', b'English prerender'),
        ]:
            with self.subTest(route=route), urlopen(self.origin + route) as response:
                self.assertEqual(response.read(), content)

    def test_post_and_unlisted_api_routes_never_reach_django(self):
        with patch.object(target, 'HTTPConnection') as backend:
            for request, expected in [
                (Request(self.origin + '/api/auth/login/', method='POST', data=b'{}'), 501),
                (Request(self.origin + '/api/__e2e__/invite-flow/'), 404),
                (Request(self.origin + '/api/agent/openapi.json'), 404),
            ]:
                with self.assertRaises(HTTPError) as raised:
                    urlopen(request)
                self.assertEqual(raised.exception.code, expected)
            backend.assert_not_called()

    def test_api_probe_is_anonymous_and_preserves_denial(self):
        with patch.object(target, 'HTTPConnection') as backend:
            response = backend.return_value.getresponse.return_value
            response.status = 401
            response.read.return_value = b'{"detail":"Not authenticated"}'
            response.getheaders.return_value = [('Content-Type', 'application/json')]
            request = Request(self.origin + '/api/crops/', headers={
                'Cookie': 'sessionid=do-not-forward', 'Authorization': 'Bearer do-not-forward',
            })
            with self.assertRaises(HTTPError) as raised:
                urlopen(request)
            self.assertEqual(raised.exception.code, 401)
            backend.return_value.request.assert_called_once_with(
                'GET', '/api/crops/', headers={'Host': '127.0.0.1', 'Accept': 'application/json'},
            )


if __name__ == '__main__':
    unittest.main()
