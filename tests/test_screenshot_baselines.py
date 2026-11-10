import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.ci.screenshot_baselines import (
    PNG_MAGIC,
    RefusedBaseline,
    apply,
    collect,
    is_baseline_path,
)

CROSS_BROWSER = (
    'frontend/e2e-cross-browser/crop-library.spec.ts-snapshots/'
    'crop-library-desktop-chromium-linux.png'
)
CHROME = 'frontend/e2e/responsive-layouts.spec.ts-snapshots/kulturen-mobile-chromium-linux.png'
CROSS_BROWSER_ARTIFACT = 'proposed-baselines-cross-browser-desktop-chromium'


def _png(marker: bytes) -> bytes:
    return PNG_MAGIC + marker


def _git(repo: Path, *args: str) -> None:
    subprocess.run(['git', *args], cwd=repo, check=True, capture_output=True)


class BaselinePathTests(unittest.TestCase):
    def test_accepts_snapshot_pngs_of_both_suites(self) -> None:
        self.assertTrue(is_baseline_path(CROSS_BROWSER))
        self.assertTrue(is_baseline_path(CHROME))
        self.assertTrue(
            is_baseline_path('frontend/e2e/a.spec.ts-snapshots/with space-chromium-linux.png')
        )

    def test_refuses_everything_else(self) -> None:
        for path in (
            'frontend/e2e/stray.png',
            'frontend/e2e/a.spec.ts-snapshots/nested/x.png',
            'frontend/e2e/a.spec.ts-snapshots/x.txt',
            'frontend/src/a.spec.ts-snapshots/x.png',
            '.github/workflows/a.spec.ts-snapshots/x.png',
            'frontend/e2e/../../.github/x-snapshots/x.png',
        ):
            with self.subTest(path=path):
                self.assertFalse(is_baseline_path(path))


class ScreenshotBaselineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.repo = root / 'repo'
        self.artifacts = root / 'artifacts'
        self.repo.mkdir()
        _git(self.repo, 'init', '-q')
        _git(self.repo, 'config', 'user.email', 'ci@example.com')
        _git(self.repo, 'config', 'user.name', 'CI')
        for path in (CROSS_BROWSER, CHROME):
            self._write(self.repo / path, _png(b'old'))
        _git(self.repo, 'add', '.')
        _git(self.repo, 'commit', '-q', '-m', 'baselines')

    def tearDown(self) -> None:
        self._tmp.cleanup()

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def test_collect_copies_changed_and_new_baselines_only(self) -> None:
        new = 'frontend/e2e/responsive-layouts.spec.ts-snapshots/new view-chromium-linux.png'
        self._write(self.repo / CROSS_BROWSER, _png(b'new'))
        self._write(self.repo / new, _png(b'added'))
        self._write(self.repo / 'frontend/e2e/stray.png', _png(b'stray'))
        dest = self.artifacts / 'proposed'

        self.assertEqual(collect(self.repo, dest), sorted([CROSS_BROWSER, new]))
        self.assertEqual((dest / CROSS_BROWSER).read_bytes(), _png(b'new'))
        self.assertFalse((dest / CHROME).exists())
        self.assertFalse((dest / 'frontend/e2e/stray.png').exists())

    def test_collect_with_nothing_changed_proposes_nothing(self) -> None:
        self.assertEqual(collect(self.repo, self.artifacts / 'proposed'), [])

    def test_apply_writes_every_artifacts_baselines(self) -> None:
        self._write(self.artifacts / CROSS_BROWSER_ARTIFACT / CROSS_BROWSER, _png(b'a'))
        self._write(self.artifacts / 'proposed-baselines-e2e-shard-2' / CHROME, _png(b'b'))

        self.assertEqual(apply(self.repo, self.artifacts), sorted([CROSS_BROWSER, CHROME]))
        self.assertEqual((self.repo / CROSS_BROWSER).read_bytes(), _png(b'a'))
        self.assertEqual((self.repo / CHROME).read_bytes(), _png(b'b'))

    def test_apply_without_artifacts_changes_nothing(self) -> None:
        self.assertEqual(apply(self.repo, self.artifacts), [])
        self.assertEqual((self.repo / CHROME).read_bytes(), _png(b'old'))

    def test_apply_refuses_a_path_outside_the_baselines(self) -> None:
        evil = self.artifacts / 'proposed-baselines-x' / '.github/workflows/evil.yml'
        self._write(evil, b'on: push')

        with self.assertRaises(RefusedBaseline):
            apply(self.repo, self.artifacts)
        self.assertFalse((self.repo / '.github').exists())

    def test_apply_refuses_a_non_png_and_writes_nothing(self) -> None:
        self._write(self.artifacts / 'proposed-baselines-a' / CROSS_BROWSER, _png(b'fine'))
        self._write(self.artifacts / 'proposed-baselines-b' / CHROME, b'not an image')

        with self.assertRaises(RefusedBaseline):
            apply(self.repo, self.artifacts)
        self.assertEqual((self.repo / CROSS_BROWSER).read_bytes(), _png(b'old'))

    def test_apply_refuses_conflicting_proposals(self) -> None:
        self._write(self.artifacts / 'proposed-baselines-a' / CHROME, _png(b'one'))
        self._write(self.artifacts / 'proposed-baselines-b' / CHROME, _png(b'two'))

        with self.assertRaises(RefusedBaseline):
            apply(self.repo, self.artifacts)

    def test_apply_refuses_a_symlink(self) -> None:
        link = self.artifacts / 'proposed-baselines-a' / CHROME
        link.parent.mkdir(parents=True)
        link.symlink_to(self.repo / CROSS_BROWSER)

        with self.assertRaises(RefusedBaseline):
            apply(self.repo, self.artifacts)


if __name__ == '__main__':
    unittest.main()
