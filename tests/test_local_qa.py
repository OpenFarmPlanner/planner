"""Exercise the local QA updater without touching a running dashboard."""

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

TOOLS = Path(__file__).resolve().parents[1] / "scripts/local_qa"
with patch.object(sys, "path", [str(TOOLS), *sys.path]):
    import start as qa


class LocalQAUpdateTests(unittest.TestCase):
    def test_refresh_finishes_sync_and_update_before_planning_new_qa(self):
        events = []
        launch = Mock(side_effect=lambda *args: events.append(("launch", args)))
        with (
            patch.dict(sys.modules, {"rounds": SimpleNamespace(launch=launch)}),
            patch.object(qa.sys.stdin, "isatty", return_value=True),
            patch.object(qa.sys.stdout, "isatty", return_value=True),
            patch.object(
                qa.subprocess,
                "run",
                side_effect=lambda *a, **kw: events.append(("run", a, kw)),
            ),
        ):
            qa.review_round("refresh", agent="codex")
        self.assertEqual([e[0] for e in events], ["run", "run", "launch"])
        self.assertEqual(events[0][1][0][-3:], ["sync", "--agent", "codex"])
        self.assertTrue(events[0][2]["check"])
        self.assertEqual(len(events[1][1][0]), 2)
        self.assertTrue(events[1][2]["check"])
        launch.assert_called_once_with("refresh", False, "codex")

    def test_refresh_preview_shows_both_rounds_without_processes_or_terminal(self):
        launch = Mock()
        with (
            patch.dict(sys.modules, {"rounds": SimpleNamespace(launch=launch)}),
            patch.object(qa.sys.stdin, "isatty", return_value=False),
            patch.object(qa.subprocess, "run") as run,
        ):
            qa.review_round("refresh", preview=True, agent="claude")
        self.assertEqual(
            [call.args for call in launch.call_args_list],
            [("sync", True, "claude"), ("refresh", True, "claude")],
        )
        run.assert_not_called()

    def test_failed_or_interrupted_sync_never_updates_services_or_refreshes(self):
        for error in (subprocess.CalledProcessError(1, ["sync"]), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                launch = Mock()
                with (
                    patch.dict(sys.modules, {"rounds": SimpleNamespace(launch=launch)}),
                    patch.object(qa.sys.stdin, "isatty", return_value=True),
                    patch.object(qa.sys.stdout, "isatty", return_value=True),
                    patch.object(qa.subprocess, "run", side_effect=error) as run,
                    self.assertRaises(type(error)),
                ):
                    qa.review_round("refresh")
                run.assert_called_once()
                launch.assert_not_called()

    def test_refresh_without_terminal_stops_before_starting_cleanup(self):
        launch = Mock()
        with (
            patch.dict(sys.modules, {"rounds": SimpleNamespace(launch=launch)}),
            patch.object(qa.sys.stdin, "isatty", return_value=False),
            patch.object(qa.subprocess, "run") as run,
            self.assertRaisesRegex(ValueError, "interactive terminal"),
        ):
            qa.review_round("refresh")
        run.assert_not_called()
        launch.assert_not_called()

    def test_standalone_sync_keeps_existing_launch_behavior(self):
        launch = Mock()
        with (
            patch.dict(sys.modules, {"rounds": SimpleNamespace(launch=launch)}),
            patch.object(qa.subprocess, "run") as run,
        ):
            qa.review_round("sync", agent="claude")
        launch.assert_called_once_with("sync", False, "claude")
        run.assert_not_called()

    def test_fetch_follows_main_without_switching_local_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            remote = Path(tmp) / "origin"
            local = Path(tmp) / "review"

            def git(*args, cwd):
                return subprocess.check_output(
                    ["git", *args], cwd=cwd, text=True
                ).strip()

            git("init", "-q", "-b", "main", str(remote), cwd=tmp)

            def commit(message):
                git(
                    "-c",
                    "user.name=QA",
                    "-c",
                    "user.email=qa@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "--allow-empty",
                    "-qm",
                    message,
                    cwd=remote,
                )

            commit("initial")
            git("clone", "-q", str(remote), str(local), cwd=tmp)
            git("switch", "-qc", "work-in-progress", cwd=local)
            initial = git("rev-parse", "HEAD", cwd=local)
            commit("new main")
            with patch.object(qa.releases, "REPO", local):
                self.assertEqual(
                    qa.releases.main_commit(), git("rev-parse", "HEAD", cwd=remote)
                )
            self.assertEqual(git("rev-parse", "HEAD", cwd=local), initial)
            self.assertEqual(
                git("branch", "--show-current", cwd=local), "work-in-progress"
            )

    def test_failed_health_check_restores_sqlite_and_previous_release(self):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as patches:
            root = Path(tmp)
            data = root / "data"
            data.mkdir()
            db = data / "review.sqlite3"
            with sqlite3.connect(db) as conn:
                conn.execute("CREATE TABLE fixture (value TEXT)")
                conn.execute("INSERT INTO fixture VALUES ('original')")
            old, new, current = root / "old", root / "new", root / "current"
            for release in (old, new):
                (release / "frontend/dist").mkdir(parents=True)
            current.symlink_to(old)
            (data / "dist").symlink_to(current / "frontend/dist")

            def migrate(command, cwd):
                if "--noinput" in command:
                    with sqlite3.connect(db) as conn:
                        conn.execute("UPDATE fixture SET value='migrated'")

            patches.enter_context(patch.object(qa, "data", data))
            patches.enter_context(patch.object(qa.releases, "CURRENT", current))
            patches.enter_context(patch.object(qa.releases, "RUNTIME", root))
            patches.enter_context(patch.object(qa, "stop_services"))
            start = patches.enter_context(patch.object(qa, "start"))
            patches.enter_context(patch.object(qa, "ready", return_value=False))
            patches.enter_context(
                patch.object(
                    qa.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], 1),
                )
            )
            patches.enter_context(patch.object(qa.releases, "run", side_effect=migrate))
            with self.assertRaisesRegex(RuntimeError, "proxy"):
                qa.deploy(new)
            self.assertEqual(current.resolve(), old)
            self.assertEqual((data / "dist").resolve(), old / "frontend/dist")
            self.assertEqual(
                [call.args for call in start.call_args_list],
                [("backend",), ("app",)] * 2,
            )
            with sqlite3.connect(db) as conn:
                self.assertEqual(
                    conn.execute("SELECT value FROM fixture").fetchone(), ("original",)
                )

    def test_only_three_verified_automatic_database_backups_are_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "review.sqlite3"
            manual = root / "pre-migration-manual.sqlite3"
            manual.touch()
            snapshots = []
            for n in range(5):
                with sqlite3.connect(db) as conn:
                    conn.execute(f"PRAGMA user_version={n}")
                snapshots.append(qa.backup_database(db, root))
                # Give the historical snapshots distinct, deterministic mtimes.
                os.utime(snapshots[-1], (n + 1, n + 1))
            self.assertEqual(
                [p.exists() for p in snapshots], [False, False, True, True, True]
            )
            with (
                patch.object(qa, "copy_db", side_effect=OSError("full")),
                self.assertRaises(OSError),
            ):
                qa.backup_database(db, root)
            self.assertEqual(set(root.iterdir()), {db, manual, *snapshots[-3:]})
            with sqlite3.connect(snapshots[-1]) as conn:
                self.assertEqual(conn.execute("PRAGMA user_version").fetchone(), (4,))

    def test_watcher_checks_after_five_minutes_and_exits_when_stopped(self):
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.object(qa, "logs", Path(tmp)),
            patch.object(qa.time, "sleep") as sleep,
            patch.object(qa, "listening", side_effect=[True, False, False, False]),
            patch.object(qa.subprocess, "run") as update,
        ):
            qa.watch()
            self.assertEqual(
                [call.args for call in sleep.call_args_list], [(300,), (300,)]
            )
            update.assert_called_once()
            self.assertEqual(update.call_args.args[0][-1], "update")
