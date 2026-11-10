"""One migration cycle per test class for data-migration tests.

A migration test migrates the database back to ``migrate_from``, seeds rows
with the historical models, migrates forward to ``migrate_to`` and checks the
result. That cycle costs 10-25 seconds, mostly in Django re-rendering model
states, and it grows with every migration added after ``migrate_from``.
Paying it once per class instead of once per test is what this base does
(see docs/testing-and-ci.md, "The migration tests are the expensive ones").

Usage::

    @pytest.mark.django_db
    class TestSomethingMigration(MigrationTestBase):
        migrate_from = [('farm', '0135_...')]
        migrate_to = [('farm', '0136_...')]

        @classmethod
        def seed_before_migration(cls, apps):
            cls.crop = apps.get_model('farm', 'Crop').objects.create(...)

        def test_result(self):
            crop = self.new_apps.get_model('farm', 'Crop').objects.get(pk=self.crop.pk)

The class is marked plain ``django_db``: each test runs in a transaction that
is rolled back, so tests in one class cannot see each other's writes and may
run in any order. A test that migrates *inside* its body (a reverse test)
cannot: SQLite's schema editor refuses to run inside a transaction while
foreign-key checks are on. Put it in its own class marked
``django_db(transaction=True)`` and call ``self.migrate_to_state()`` there.

A class leaves the database as it found it: the fixture serializes the
contents before migrating back and restores them after the final flush, so
the catalogues the data migrations seed (crop species, plant families) are
back for whatever test the worker runs next. pytest-xdist's ``loadscope``
dispatches the largest classes first, so test order cannot be relied on to
keep other tests away from a flushed database.
"""

from collections.abc import Iterator
from typing import ClassVar

import pytest
from django.apps.registry import Apps
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

MigrationTargets = list[tuple[str, str]]


def migrate_to_state(targets: MigrationTargets) -> Apps:
    """Migrate the test database to ``targets`` and return its historical apps."""
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    executor.loader.build_graph()
    return executor.loader.project_state(targets).apps


def migrate_to_leaf_nodes() -> None:
    """Migrate the test database forward to the latest migration of every app."""
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


class MigrationTestBase:
    """Migrates back, seeds and migrates forward once for the whole class."""

    migrate_from: ClassVar[MigrationTargets]
    migrate_to: ClassVar[MigrationTargets]
    old_apps: ClassVar[Apps]
    new_apps: ClassVar[Apps]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        """Create the rows the migration under test transforms; store them on ``cls``."""

    @staticmethod
    def migrate_to_state(targets: MigrationTargets) -> Apps:
        """Migrate inside a test (transactional classes only); returns the historical apps."""
        return migrate_to_state(targets)

    @pytest.fixture(autouse=True, scope='class')
    @classmethod
    def _migration_cycle(cls, django_db_setup: None, django_db_blocker) -> Iterator[None]:
        with django_db_blocker.unblock():
            contents_before = connection.creation.serialize_db_to_string()
            cls.old_apps = migrate_to_state(cls.migrate_from)
            cls.seed_before_migration(cls.old_apps)
            cls.new_apps = migrate_to_state(cls.migrate_to)
        yield
        with django_db_blocker.unblock():
            migrate_to_leaf_nodes()
            # The seeded rows were written outside the per-test transactions,
            # so remove them, then put back what was there before the class.
            # As in Django's serialized rollback, the flush must not recreate
            # rows (content types) through post_migrate: the restore brings
            # them back with their original primary keys.
            call_command('flush', verbosity=0, interactive=False, inhibit_post_migrate=True)
            connection.creation.deserialize_db_from_string(contents_before)
