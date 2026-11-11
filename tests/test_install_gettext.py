import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ci/install-gettext.sh"


class InstallGettextTests(unittest.TestCase):
    def run_installer(
        self, *, installed: bool = False, apt_exit: int = 0,
        ubuntu: bool = False, mirror_exit: int = 0,
    ) -> tuple[subprocess.CompletedProcess[str], str, str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "installed"
            calls = root / "sudo-calls"
            sources = root / "sources"
            if installed:
                state.touch()
            commands = {
                "msgfmt": '#!/bin/bash\n[[ -f "$GETTEXT_STATE" ]]\n',
                "sudo": (
                    '#!/bin/bash\n'
                    'printf "%s\\n" "$*" >> "$GETTEXT_CALLS"\n'
                    'if [[ "$*" == *"Dir::Etc::sourcelist="* ]]; then\n'
                    '  for argument in "$@"; do\n'
                    '    if [[ "$argument" == Dir::Etc::sourcelist=* ]]; then\n'
                    '      cat "${argument#*=}" >> "$GETTEXT_SOURCES"\n'
                    '    fi\n'
                    '  done\n'
                    '  if [[ "$MIRROR_EXIT" != 0 ]]; then exit "$MIRROR_EXIT"; fi\n'
                    'elif [[ "$APT_EXIT" != 0 ]]; then exit "$APT_EXIT"; fi\n'
                    'if [[ "$*" == *"install -y gettext"* ]]; then touch "$GETTEXT_STATE"; fi\n'
                ),
            }
            for name, contents in commands.items():
                command = root / name
                command.write_text(contents, encoding="utf-8")
                command.chmod(0o755)
            result = subprocess.run(
                [
                    "/bin/bash", "-c",
                    'source "$1"; ubuntu_codename() { '
                    + ('printf "%s\\n" resolute;' if ubuntu else 'return 1;')
                    + ' }; main',
                    "--", str(SCRIPT),
                ],
                env={
                    **os.environ,
                    "PATH": f"{root}:/usr/bin:/bin",
                    "GETTEXT_STATE": str(state),
                    "GETTEXT_CALLS": str(calls),
                    "GETTEXT_SOURCES": str(sources),
                    "APT_EXIT": str(apt_exit),
                    "MIRROR_EXIT": str(mirror_exit),
                    "HTTPS_PROXY": "http://private-user:private-password@proxy.invalid:8080",
                },
                capture_output=True,
                text=True,
                check=False,
            )
            return (
                result,
                calls.read_text(encoding="utf-8") if calls.exists() else "",
                sources.read_text(encoding="utf-8") if sources.exists() else "",
            )

    def test_working_msgfmt_requires_no_package_network_access(self) -> None:
        result, calls, _ = self.run_installer(installed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, "")

    def test_install_preserves_proxy_and_bounds_root_apt_processes(self) -> None:
        result, calls, _ = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls.splitlines()), 2)
        for call in calls.splitlines():
            self.assertIn("--preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,no_proxy,NO_PROXY", call)
            self.assertIn("timeout --kill-after=5s 180s apt-get", call)
        self.assertIn("install -y gettext", calls)
        self.assertNotIn("private-password", result.stdout + result.stderr + calls)

    def test_package_failure_is_not_reported_as_success(self) -> None:
        result, calls, _ = self.run_installer(apt_exit=100)
        self.assertEqual(result.returncode, 100)
        self.assertEqual(len(calls.splitlines()), 1)
        self.assertNotIn("install -y gettext", calls)

    def test_ubuntu_mirror_fallback_keeps_archive_signature_verification(self) -> None:
        result, calls, sources = self.run_installer(ubuntu=True, apt_exit=100)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls.splitlines()), 3)
        self.assertIn("APT::Update::Error-Mode=any update", calls)
        self.assertIn("Dir::Etc::sourceparts=-", calls)
        self.assertIn("signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg", sources)
        self.assertIn("https://mirrors.edge.kernel.org/ubuntu/ resolute main", sources)
        self.assertIn("https://mirrors.edge.kernel.org/ubuntu/ resolute-updates main", sources)
        self.assertIn("https://mirrors.edge.kernel.org/ubuntu/ resolute-security main", sources)
        self.assertNotIn("trusted=yes", sources)

    def test_failed_mirror_fallback_does_not_pass_installation(self) -> None:
        result, calls, _ = self.run_installer(ubuntu=True, apt_exit=100, mirror_exit=100)
        self.assertEqual(result.returncode, 100)
        self.assertEqual(len(calls.splitlines()), 2)
        self.assertNotIn("install -y gettext", calls)
