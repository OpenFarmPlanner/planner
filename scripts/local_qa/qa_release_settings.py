"""Load the review workspace settings and verify the migration target."""

from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from qa_settings import *  # noqa: F403 - extend the initialized workspace settings
from qa_settings import DATABASES
from releases import DATA

database = DATABASES["default"]
if (
    database["ENGINE"] != "django.db.backends.sqlite3"
    or Path(database["NAME"]).resolve() != DATA / "review.sqlite3"
):
    raise ImproperlyConfigured("Local QA requires its own review.sqlite3 database.")

ROOT_URLCONF = "qa_release_urls"
