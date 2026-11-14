"""Disposable scan settings, imported explicitly by the CI target image only."""

import os
from copy import deepcopy

os.environ.update({
    'DEBUG': 'False',
    'DJANGO_ENV': 'test',
    'SECRET_KEY': 'ci-zap-disposable-key-with-no-production-use',
    'FRONTEND_URL': 'http://127.0.0.1:4173',
    'PUBLIC_FRONTEND_URL': 'http://127.0.0.1:4173',
    'ALLOWED_HOSTS': '127.0.0.1,localhost',
    'DB_ENGINE': 'sqlite',
    'SECURE_SSL_REDIRECT': 'False',
    'E2E_TEST_TOKEN': '',
    'EMAIL_BACKEND': 'django.core.mail.backends.locmem.EmailBackend',
})

from config.settings import *  # noqa: E402,F403

DATABASES = deepcopy(DATABASES)  # noqa: F405
DATABASES['default']['NAME'] = '/tmp/zap-instance.sqlite3'
MEDIA_ROOT = '/tmp/zap-media'
ADMIN_NOTIFICATION_EMAIL = ''
REGISTRATION_ALERT_EMAILS = []
ADMINS = []
TURNSTILE_SITE_KEY = ''
TURNSTILE_SECRET_KEY = ''
