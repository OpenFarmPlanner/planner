import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ci/install-gettext.sh"


class InstallGettextTests(unittest.TestCase):
    def run_installer(self, *, installed: bool = False, apt_exit: int = 0) -> tuple[subprocess.CompletedProcess[str], str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "installed"
            calls = root / "sudo-calls"
            if installed:
                state.touch()
            commands = {
                "msgfmt": '#!/bin/bash\n[[ -f "$GETTEXT_STATE" ]]\n',
                "sudo": (
                    '#!/bin/bash\n'
                    'printf "%s\\n" "$*" >> "$GETTEXT_CALLS"\n'
                    'if [[ "$APT_EXIT" != 0 ]]; then exit "$APT_EXIT"; fi\n'
                    'if [[ "$*" == *"install -y gettext"* ]]; then touch "$GETTEXT_STATE"; fi\n'
                ),
            }
            for name, contents in commands.items():
                command = root / name
                command.write_text(contents, encoding="utf-8")
                command.chmod(0o755)
            result = subprocess.run(
                ["/bin/bash", str(SCRIPT)],
                env={
                    **os.environ,
                    "PATH": f"{root}:/usr/bin:/bin",
                    "GETTEXT_STATE": str(state),
                    "GETTEXT_CALLS": str(calls),
                    "APT_EXIT": str(apt_exit),
                    "HTTPS_PROXY": "http://private-user:private-password@proxy.invalid:8080",
                },
                capture_output=True,
                text=True,
                check=False,
            )
            return result, calls.read_text(encoding="utf-8") if calls.exists() else ""

    def test_working_msgfmt_requires_no_package_network_access(self) -> None:
        result, calls = self.run_installer(installed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, "")

    def test_install_preserves_proxy_and_bounds_root_apt_processes(self) -> None:
        result, calls = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls.splitlines()), 2)
        for call in calls.splitlines():
            self.assertIn("--preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,no_proxy,NO_PROXY", call)
            self.assertIn("timeout --kill-after=5s 180s apt-get", call)
        self.assertIn("install -y gettext", calls)
        self.assertNotIn("private-password", result.stdout + result.stderr + calls)

    def test_package_failure_is_not_reported_as_success(self) -> None:
        result, calls = self.run_installer(apt_exit=100)
        self.assertEqual(result.returncode, 100)
        self.assertEqual(len(calls.splitlines()), 1)
        self.assertNotIn("install -y gettext", calls)
