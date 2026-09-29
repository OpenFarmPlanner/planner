"""Test settings for running tests with SQLite database."""

import os

os.environ['DEBUG'] = 'True'
os.environ['DJANGO_ENV'] = 'test'
os.environ.setdefault('PUBLIC_FRONTEND_URL', 'http://localhost:5173')

from .settings import *  # noqa: F403, F401

ADMIN_NOTIFICATION_EMAIL = ''

# Never call Cloudflare from the test suite, even if a local .env sets a key;
# Turnstile tests enable it explicitly with override_settings and a mock.
TURNSTILE_SITE_KEY = ''
TURNSTILE_SECRET_KEY = ''

# Override database to use SQLite for tests
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
        'ATOMIC_REQUESTS': True,
    }
}

# Keep existing test suite behavior focused on domain logic.
# Authentication behavior is validated separately in accounts tests.
#
# The API-token permission stays enabled: relaxing IsAuthenticated must not
# also relax the deny-by-default rule for API tokens, otherwise the token
# isolation tests would pass against a configuration production never runs.
REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'] = [  # type: ignore[name-defined]
    'rest_framework.permissions.AllowAny',
    'farm.agent_api.permissions.ApiTokenAccessPermission',
]
REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []  # type: ignore[name-defined]

# Django's default PBKDF2 hasher runs 1,000,000 iterations per hash, and the
# suite hashes on every create_user(), set_password() and password login. The
# tests check that authentication works, not how strong the hash is, and
# production keeps the default hasher from settings.py. Django's testing docs
# recommend exactly this: it takes the API test files from minutes to seconds.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
