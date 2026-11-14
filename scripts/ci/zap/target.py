"""Serve the production bundle and two anonymous API probes without an outbound network."""

import os
import subprocess
import sys
from http.client import HTTPConnection
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

DIST = Path('/app/frontend/dist')
SAFE_API_PATHS = {'/api/schema/', '/api/crops/'}


class ScanTarget(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Request text selects a trusted manifest value; it never becomes a
        # filesystem path. Symlinks are not part of the public build manifest.
        self.routes = {}
        for candidate in DIST.rglob('*'):
            if candidate.is_file() and not candidate.is_symlink():
                route = '/' + candidate.relative_to(DIST).as_posix()
                self.routes[route] = route
                if candidate.name == 'index.html':
                    directory = route.removesuffix('/index.html')
                    self.routes[directory or '/'] = route
                    self.routes[directory + '/'] = route
                elif candidate.suffix == '.html' and candidate.name != 'app-shell.html':
                    # Production prerender uses en.html and en/about.html.
                    self.routes[route.removesuffix('.html')] = route
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, _format, *args):
        # Paths and headers are intentionally absent from container logs.
        pass

    def do_GET(self):
        self.serve(head=False)

    def do_HEAD(self):
        self.serve(head=True)

    def serve(self, *, head):
        parsed = urlsplit(self.path)
        if parsed.path in SAFE_API_PATHS:
            connection = HTTPConnection('127.0.0.1', 8000, timeout=15)
            try:
                connection.request('HEAD' if head else 'GET', self.path, headers={
                    'Host': '127.0.0.1', 'Accept': 'application/json',
                })
                response = connection.getresponse()
                content = response.read()
                self.send_response(response.status)
                for key, value in response.getheaders():
                    if key.lower() not in {'connection', 'transfer-encoding', 'server', 'date'}:
                        self.send_header(key, value)
                self.end_headers()
                if not head:
                    self.wfile.write(content)
            finally:
                connection.close()
            return
        if parsed.path.startswith('/api/'):
            content = b'{"detail":"Endpoint excluded from the passive scan."}'
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            if not head:
                self.wfile.write(content)
            return
        if parsed.path == '/__zap_fixture__/':
            # Deliberately omit nosniff on this harmless script: rule 10021 must
            # observe it, proving that the passive scanner really ran.
            content = b'/* synthetic ZAP coverage fixture; no application behavior */\n'
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            if not head:
                self.wfile.write(content)
            return
        self.path = self.routes.get(unquote(parsed.path), '/app-shell.html')
        if head:
            super().do_HEAD()
        else:
            super().do_GET()


def main():
    import django

    django.setup()
    from django.core.management import call_command
    from farm.models import Crop, Project

    call_command('migrate', interactive=False, verbosity=0)
    project = Project.objects.create(name='ZAP synthetic private project', slug='zap-synthetic')
    Crop.objects.create(project=project, name='Synthetic ZAP carrot')
    backend = subprocess.Popen([
        sys.executable, '-m', 'daphne', '-b', '127.0.0.1', '-p', '8000',
        'config.asgi:application',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy())
    try:
        ThreadingHTTPServer(('127.0.0.1', 4173), ScanTarget).serve_forever()
    finally:
        backend.terminate()
        backend.wait(timeout=10)


if __name__ == '__main__':
    main()
