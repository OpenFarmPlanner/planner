import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.ci.retire_deployed_migration_tests import (
    judge,
    migration_test_files,
    ref_exists,
    referenced_migrations,
    render_report,
)

DEPLOYED_TEST = """
from farm.tests.migration_base import MigrationTestBase


class TestOld(MigrationTestBase):
    migrate_from = [('farm', '0001_initial')]
    migrate_to = [('farm', '0002_backfill')]
"""

PENDING_TEST = """
from django.db.migrations.executor import MigrationExecutor

FROM = [('farm', '0002_backfill')]
TO = [('farm', '0003_new_backfill')]
"""

MIXED_TEST = """
from farm.tests.migration_base import MigrationTestBase


class TestOld(MigrationTestBase):
    migrate_to = [('farm', '0002_backfill')]


class TestNew(MigrationTestBase):
    migrate_to = [('farm', '0003_new_backfill')]
"""


def _git(repo: Path, *args: str) -> None:
    subprocess.run(['git', *args], cwd=repo, check=True, capture_output=True)


class RetireDeployedMigrationTestsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        _git(self.repo, 'init', '-q')
        _git(self.repo, 'config', 'user.email', 'ci@example.com')
        _git(self.repo, 'config', 'user.name', 'CI')
        migrations = self.repo / 'backend' / 'farm' / 'migrations'
        migrations.mkdir(parents=True)
        (self.repo / 'backend' / 'farm' / 'tests').mkdir()
        for name in ('0001_initial', '0002_backfill'):
            (migrations / f'{name}.py').write_text('', encoding='utf-8')
        _git(self.repo, 'add', '.')
        _git(self.repo, 'commit', '-q', '-m', 'release')
        _git(self.repo, 'tag', 'v1.0.0')
        # A migration merged after the release production runs.
        (migrations / '0003_new_backfill.py').write_text('', encoding='utf-8')

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _test_file(self, name: str, source: str) -> Path:
        path = self.repo / 'backend' / 'farm' / 'tests' / name
        path.write_text(source, encoding='utf-8')
        return path

    def _verdicts(self) -> dict[str, bool]:
        verdicts = judge(self.repo, 'v1.0.0', migration_test_files(self.repo))
        return {Path(v.path).name: v.retire for v in verdicts}

    def test_reads_tuples_and_module_paths(self) -> None:
        source = "x = [('farm', '0002_backfill')]\nimport_module('crops.migrations.0005_seed')\n"

        self.assertEqual(
            referenced_migrations(source),
            {('farm', '0002_backfill'), ('crops', '0005_seed')},
        )

    def test_retires_only_files_whose_migrations_are_all_in_production(self) -> None:
        self._test_file('test_migrations_old.py', DEPLOYED_TEST)
        self._test_file('test_migrations_pending.py', PENDING_TEST)
        self._test_file('test_migrations_mixed.py', MIXED_TEST)

        self.assertEqual(self._verdicts(), {
            'test_migrations_mixed.py': False,
            'test_migrations_old.py': True,
            'test_migrations_pending.py': False,
        })

    def test_ignores_files_that_do_not_test_migrations(self) -> None:
        self._test_file('test_views.py', "URL = ('farm', '0002_backfill')\n")

        self.assertEqual(self._verdicts(), {})

    def test_keeps_a_migration_test_that_names_no_migration(self) -> None:
        source = 'from farm.tests.migration_base import MigrationTestBase\n'
        self._test_file('test_migrations_helper.py', source)

        self.assertEqual(self._verdicts(), {'test_migrations_helper.py': False})

    def test_keeps_a_file_that_names_a_migration_this_checkout_lacks(self) -> None:
        typo = DEPLOYED_TEST.replace('0002_backfill', '0002_backfil')
        self._test_file('test_migrations_typo.py', typo)

        verdicts = judge(self.repo, 'v1.0.0', migration_test_files(self.repo))

        self.assertFalse(verdicts[0].retire)
        self.assertEqual(verdicts[0].unknown, {('farm', '0002_backfil')})

    def test_knows_whether_the_release_tag_was_fetched(self) -> None:
        self.assertTrue(ref_exists(self.repo, 'v1.0.0'))
        self.assertFalse(ref_exists(self.repo, 'v9.9.9'))

    def test_report_names_the_release_and_each_retired_file(self) -> None:
        self._test_file('test_migrations_old.py', DEPLOYED_TEST)
        self._test_file('test_migrations_pending.py', PENDING_TEST)

        verdicts = judge(self.repo, 'v1.0.0', migration_test_files(self.repo))
        report = render_report('v1.0.0', verdicts)

        self.assertIn('`v1.0.0`', report)
        self.assertIn('`backend/farm/tests/test_migrations_old.py`', report)
        self.assertNotIn('test_migrations_pending.py`', report)
        self.assertIn('Kept: 1 migration test file(s)', report)


if __name__ == '__main__':
    unittest.main()
