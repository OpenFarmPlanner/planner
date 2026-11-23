#!/usr/bin/env python3
"""Start or reuse the local review services without resetting the review."""

import argparse
import fcntl
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from http.client import HTTPConnection, HTTPException
from pathlib import Path

import releases

qa = releases.QA
repo = releases.REPO
data = releases.DATA
logs = qa / "logs"
ports = {"backend": 8274, "app": 5274, "dashboard": 4174}


def spec(name):
    port = ports[name]
    if name == "dashboard":
        return port, qa, [sys.executable, str(qa / "dashboard/server.py")]
    source = releases.CURRENT.resolve() if releases.CURRENT.exists() else repo
    if name == "backend":
        cwd = source / "backend"
        cmd = [
            str(cwd / ".venv/bin/python"),
            "-m",
            "daphne",
            "-b",
            "127.0.0.1",
            "-p",
            str(port),
            "config.asgi:application",
        ]
    else:
        cwd = source / "frontend"
        build = cwd / "dist" if releases.CURRENT.exists() else data / "dist"
        cmd = [
            "node",
            "node_modules/vite/bin/vite.js",
            "preview",
            "--outDir",
            str(build),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--strictPort",
        ]
    return port, cwd, cmd


def ready(name, port):
    probes = {
        "backend": ("/api/qa/reviewer-session/", 405),
        "app": ("/qa-project.html", 200),
        "dashboard": ("/shortcuts.js", 200),
    }
    versioned = name != "dashboard" and releases.CURRENT.exists()
    if versioned:
        path, expected_status = (
            ("/api/qa/version/" if name == "backend" else "/qa-version.json"),
            200,
        )
    else:
        path, expected_status = probes[name]
    connection = HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        if response.status != expected_status:
            return False
        if versioned:
            return (
                json.loads(response.read(4096))["commit"]
                == releases.CURRENT.resolve().name
            )
        if name == "backend":
            return response.getheader("Allow") == "POST"
        source = (
            data / "dist/qa-project.html"
            if name == "app"
            else qa / "dashboard/shortcuts.js"
        )
        return response.read(source.stat().st_size + 1) == source.read_bytes()
    except (OSError, HTTPException, ValueError, KeyError):
        return False
    finally:
        connection.close()


def start(name):
    port, cwd, cmd = spec(name)
    with socket.socket() as probe:
        occupied = probe.connect_ex(("127.0.0.1", port)) == 0
    if occupied:
        if ready(name, port):
            print(f"{name} already running on port {port}")
            return
        raise RuntimeError(
            f"Port {port} is occupied. Could not verify the QA {name} service."
        )

    if name == "app":
        subprocess.run([sys.executable, str(data / "project-links.py")], check=True)
    env = releases.env()
    if releases.CURRENT.exists():
        env["OFP_QA_COMMIT"] = releases.CURRENT.resolve().name
    log = logs / f"{name}.log"
    with log.open("a") as output:
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=output,
            start_new_session=True,
        )
    (logs / f"{name}.pid").write_text(str(process.pid))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{name} exited. See {log}")
        if ready(name, port):
            print(f"{name} ready on port {port}")
            return
        time.sleep(0.2)
    raise RuntimeError(f"{name} did not become ready on port {port}. See {log}")


def listening(port):
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


def qa_environment(environ):
    # Recognize both the tracked launcher and an existing local QA session.
    expected = releases.env()
    return any(
        os.fsencode(f"DJANGO_SETTINGS_MODULE={settings}") in environ
        and os.fsencode(f"PYTHONPATH={path}") in environ
        for settings, path in [
            (expected["DJANGO_SETTINGS_MODULE"], expected["PYTHONPATH"]),
            ("qa_settings", str(data)),
        ]
    )


def owned_group(name):
    """Allow termination only for the recorded QA session with our cwd and settings."""
    port, cwd, _ = spec(name)
    pidfile = logs / f"{name}.pid"
    if pidfile.exists():
        pid = int(pidfile.read_text())
        proc = Path("/proc") / str(pid)
        try:
            args = (proc / "cmdline").read_bytes().split(b"\0")
            environ = (proc / "environ").read_bytes().split(b"\0")
            if (
                os.getsid(pid) == pid
                and (proc / "cwd").resolve() == cwd
                and qa_environment(environ)
                and str(port).encode() in args
            ):
                return pid
        except (FileNotFoundError, ProcessLookupError):
            pass
    if listening(port):
        raise RuntimeError(
            f"Port {port} belongs to an unverified process; leaving it running."
        )
    return None


def stop_services():
    groups = {name: owned_group(name) for name in ("app", "backend")}
    for name, pid in groups.items():
        if pid:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
            for _ in range(150):
                states = subprocess.check_output(
                    ["ps", "-eo", "pgid=,stat="], text=True
                ).splitlines()
                running = any(
                    group == str(pid) and not state.startswith("Z")
                    for group, state in (line.split() for line in states)
                )
                if not running and not listening(ports[name]):
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError(f"{name} did not release its port.")


def point_to(link, target):
    staged = link.with_name(link.name + ".next")
    staged.unlink(missing_ok=True)
    staged.symlink_to(target, target_is_directory=True)
    os.replace(staged, link)


def copy_db(src, dst):
    with (
        sqlite3.connect(f"file:{src}?mode=ro", uri=True) as reader,
        sqlite3.connect(dst) as writer,
    ):
        reader.backup(writer)
        if writer.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise RuntimeError(f"SQLite integrity check failed: {dst}")


def deploy(release):
    previous = releases.CURRENT.resolve() if releases.CURRENT.exists() else None
    dist = data / "dist"
    saved_dist = releases.RUNTIME / "legacy-dist"
    db = data / "review.sqlite3"
    backups = releases.RUNTIME / "backups"
    backups.mkdir(exist_ok=True)
    backup = None
    backend = release / "backend"
    manage = [str(backend / ".venv/bin/python"), "manage.py", "migrate"]
    stop_services()
    try:
        pending = subprocess.run(
            [*manage, "--check"], cwd=backend, env=releases.env()
        ).returncode
        if pending:
            if pending != 1:
                raise RuntimeError("Cannot determine pending migrations.")
            with tempfile.NamedTemporaryFile(
                dir=backups, prefix="pre-migration-", suffix=".sqlite3", delete=False
            ) as f:
                candidate = Path(f.name)
            copy_db(db, candidate)
            backup = candidate
            print(f"SQLite backup: {backup}", flush=True)
            releases.run([*manage, "--noinput"], backend)
        releases.run([*manage, "--check"], backend)
        if dist.is_dir() and not dist.is_symlink():
            dist.rename(saved_dist)
        point_to(releases.CURRENT, release)
        point_to(dist, releases.CURRENT / "frontend/dist")
        start("backend")
        start("app")
        if not ready("backend", 5274):
            raise RuntimeError(
                "QA frontend proxy does not reach the selected backend version."
            )
    except BaseException:
        stop_services()
        if backup:
            copy_db(backup, db)
        if previous:
            point_to(releases.CURRENT, previous)
        else:
            releases.CURRENT.unlink(missing_ok=True)
            if dist.is_symlink():
                dist.unlink()
            if saved_dist.exists():
                saved_dist.rename(dist)
        start("backend")
        start("app")
        raise

    # Retain the running and previous builds. Only remove updater-owned releases.
    for path in releases.RELEASES.iterdir():
        if path not in (release, previous) and re.fullmatch(
            "[0-9a-f]{40,64}", path.name
        ):
            shutil.rmtree(path)
    used_caches = {
        (path / entry).resolve().parent
        for path in (release, previous)
        if path is not None
        for entry in ("backend/.venv", "frontend/node_modules")
    }
    for cache in releases.DEPS.iterdir():
        if (
            cache not in used_caches
            and re.fullmatch(r"(py|js)-[a-f0-9]{20}", cache.name)
            and (cache / ".installed").is_file()
        ):
            shutil.rmtree(cache)


def ensure_main():
    if not (data / "review.sqlite3").is_file():
        raise RuntimeError("The QA review database is missing.")
    commit = releases.main_commit()
    dest = releases.RELEASES / commit
    if releases.CURRENT.exists() and releases.CURRENT.resolve() == dest:
        start("backend")
        start("app")
    else:
        print(f"Preparing QA from origin/main {commit[:12]}", flush=True)
        deploy(releases.prepare(commit))
    print(f"QA running origin/main {commit[:12]}")


def watch():
    with (logs / "main-watcher.lock").open("a") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        (logs / "main-watcher.pid").write_text(str(os.getpid()))
        while True:
            time.sleep(300)
            if not any(listening(port) for port in ports.values()):
                return
            print(time.strftime("%Y-%m-%d %H:%M:%S Checking origin/main"), flush=True)
            subprocess.run([sys.executable, str(Path(__file__).resolve()), "update"])


def start_watcher():
    with (logs / "main-watcher.lock").open("a") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
    with (logs / "main-updates.log").open("a") as log:
        subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "watch"],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "service",
        nargs="?",
        choices=[*ports, "update", "watch", "sync", "refresh"],
        help="Start QA and check origin/main every five minutes, check immediately (update), review accepted rows (sync), or add newly implemented work to QA (refresh)",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show the live sync or refresh candidates without starting an AI session",
    )
    parser.add_argument(
        "--agent",
        choices=["auto", "codex", "claude"],
        help="Choose the assistant for this round (default: alternate, starting with Codex)",
    )
    args = parser.parse_args()
    if (
        not (data / "review.sqlite3").is_file()
        or not (data / "qa_settings.py").is_file()
    ):
        sys.exit(
            "An initialized .qa-review workspace is required. See docs/testing-and-ci.md."
        )
    logs.mkdir(exist_ok=True)
    if args.service == "watch":
        watch()
        sys.exit(0)
    if args.service in ("sync", "refresh"):
        sys.path.append(str(data))
        from rounds import launch

        try:
            if args.service == "refresh" and not args.preview:
                subprocess.run(
                    [sys.executable, str(Path(__file__).resolve())], check=True
                )
            launch(args.service, args.preview, args.agent or "auto")
        except subprocess.CalledProcessError as exc:
            sys.exit(
                f"QA {args.service} stopped: {exc.cmd[0]} failed (exit {exc.returncode})."
            )
        except (OSError, ValueError) as exc:
            sys.exit(f"QA {args.service} stopped: {exc}")
        sys.exit(0)
    if args.preview or args.agent:
        parser.error("--preview and --agent apply to sync or refresh")
    with (logs / "startup.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if args.service in (None, "dashboard"):
            start("dashboard")
        if args.service != "dashboard":
            try:
                ensure_main()
            except (OSError, RuntimeError, subprocess.SubprocessError) as err:
                if releases.CURRENT.exists():
                    print("Keeping the last available QA release.", file=sys.stderr)
                    start("backend")
                    start("app")
                if args.service != "update":
                    start_watcher()
                sys.exit(
                    f"QA update failed: {err}. See .qa-review/logs/main-updates.log for automatic retries."
                )
        if args.service != "update":
            start_watcher()
    if args.service in (None, "dashboard"):
        print("QA dashboard: http://localhost:4174")
