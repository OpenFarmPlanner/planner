#!/usr/bin/env bash
#
# Makes Playwright's Chrome channel usable on a CI runner.
#
# Shared by .github/workflows/e2e.yml and frontend-build.yml, which both need
# the browser before `npm run build` (the frontend's `postbuild` script,
# build/prerender.ts, launches Chrome itself). The Playwright config pins
# `channel: 'chrome'`, i.e. the real Google Chrome install, not the bundled
# Chromium — it is the manual reference browser.
#
# The fast path is to install nothing. The GitHub runner image already ships
# Google Chrome, which is exactly what `channel: 'chrome'` resolves to, so if
# it launches there is nothing to do. That matters because every install route
# goes through apt, and apt on these runners is the single least reliable
# thing in CI: the mirror the image pins (azure.archive.ubuntu.com) regularly
# stops answering, apt then hangs for minutes, and when the surrounding
# `timeout` kills it the apt-get it spawned as root survives as an orphan
# holding /var/lib/apt/lists/lock until the job dies — taking every retry with
# it. Note that `npx playwright install chrome` does this too even without
# `--with-deps`: installing the Chrome channel *is* an apt install of the
# google-chrome deb.
#
# Only when no working Chrome is present do we go near apt, and then with the
# guards below: a drop-in config so apt gives up on a dead mirror instead of
# hanging, a SIGKILL of whatever still holds the lock before each retry (the
# wedged orphan is blocked on network I/O and never frees it on its own), and
# a dpkg repair so the next attempt starts clean.
#
# The caller's step timeout must exceed this script's worst case
# (max_attempts * (lock_wait + attempt_timeout) + backoff + fallback).
set -euo pipefail

max_attempts=3
attempt_timeout_seconds=180
lock_wait_seconds=30
lock_poll_seconds=5

apt_lock_files=(/var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock)

# Launching is the only check that matters: it is what the build and the tests
# actually do, so a pass here means the job can proceed no matter how the
# browser got onto the machine.
chrome_launches() {
  node -e "
    const { chromium } = require('playwright-core');
    chromium.launch({ channel: 'chrome' })
      .then((browser) => {
        const version = browser.version();
        return browser.close().then(() => console.log('Chrome ' + version));
      })
      .catch((error) => { console.error(error.message.split('\n')[0]); process.exit(1); });
  "
}

configure_apt_to_fail_fast() {
  sudo tee /etc/apt/apt.conf.d/99-ci-fail-fast >/dev/null <<'APTCONF'
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
Acquire::ftp::Timeout "15";
Acquire::Retries "1";
APTCONF
}

apt_locks_held() {
  command -v fuser >/dev/null 2>&1 || return 1
  sudo fuser "${apt_lock_files[@]}" >/dev/null 2>&1
}

clear_apt_locks() {
  local waited=0
  while apt_locks_held; do
    if [ "$waited" -ge "$lock_wait_seconds" ]; then
      echo "apt locks still held after ${waited}s, terminating the stuck apt process" >&2
      # SIGKILL rather than SIGTERM: the process is blocked on network I/O
      # from a mirror that never answers and does not act on TERM.
      sudo fuser -k -KILL "${apt_lock_files[@]}" >/dev/null 2>&1 || true
      sleep "$lock_poll_seconds"
      # Killing apt mid-transaction can leave dpkg half-configured; repair it
      # so the next attempt starts from a consistent state.
      sudo dpkg --configure -a >/dev/null 2>&1 || true
      return 0
    fi
    if [ "$waited" -eq 0 ]; then
      echo "Waiting for another apt process to release its locks..." >&2
    fi
    sleep "$lock_poll_seconds"
    waited=$((waited + lock_poll_seconds))
  done
}

if chrome_launches; then
  echo "A working Chrome is already installed; skipping the Playwright browser install." >&2
  exit 0
fi

echo "No working Chrome found, installing it..." >&2
configure_apt_to_fail_fast

for attempt in $(seq 1 "$max_attempts"); do
  clear_apt_locks
  if timeout "$attempt_timeout_seconds" npx playwright install --with-deps chrome; then
    exit 0
  fi
  echo "Playwright browser install attempt $attempt/$max_attempts failed or timed out" >&2
  # An attempt that installed Chrome but failed on an unrelated apt step still
  # leaves the job able to run.
  if chrome_launches; then
    echo "Chrome is usable despite the failed install step." >&2
    exit 0
  fi
  if [ "$attempt" -lt "$max_attempts" ]; then
    backoff=$((attempt * 10))
    echo "Retrying in ${backoff}s..." >&2
    sleep "$backoff"
  fi
done

echo "Could not install a working browser after $max_attempts attempts" >&2
exit 1
