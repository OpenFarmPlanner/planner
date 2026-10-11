#!/usr/bin/env bash
#
# Container side of run-in-docker.sh; not meant to be run on the host.
# Installs the pinned uv for the Django backend (the Playwright image ships
# Python but no uv/pip), installs npm dependencies when the lockfile changed,
# builds the production bundle and runs the cross-browser suite.
set -euo pipefail

UV_VERSION="0.11.32"

export HOME=/cache/home
export npm_config_cache=/cache/npm
export UV_CACHE_DIR=/cache/uv
export UV_PROJECT_ENVIRONMENT=/cache/backend-venv
export UV_PYTHON=python3
export UV_PYTHON_DOWNLOADS=never
export PATH="/cache/bin:$PATH"
mkdir -p "$HOME" /cache/bin

# The container runs as root; hand everything it wrote into the bind-mounted
# checkout back to the host user.
restore_ownership() {
  chown -R "${HOST_UID:-0}:${HOST_GID:-0}" \
    dist test-results playwright-report e2e-cross-browser \
    ../backend/db.sqlite3* ../backend/uv.lock 2>/dev/null || true
}
trap restore_ownership EXIT

if [ "$(uv --version 2>/dev/null | cut -d' ' -f2)" != "$UV_VERSION" ]; then
  curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-$(uname -m)-unknown-linux-gnu.tar.gz" \
    | tar -xz -C /cache/bin --strip-components=1
fi

lock_hash="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat /cache/node-modules.lock-hash 2>/dev/null)" != "$lock_hash" ]; then
  # node_modules is a volume mount point: empty it instead of letting npm
  # try to remove the directory itself.
  find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  npm ci --no-audit --no-fund
  echo "$lock_hash" > /cache/node-modules.lock-hash
fi

if [ "${E2E_SKIP_BUILD:-}" != "1" ]; then
  # `npm run build` would also run the postbuild prerender, which launches the
  # Google Chrome channel the image does not ship. Prerendering only touches
  # the public landing pages, none of which this suite visits.
  npx tsc -b
  VITE_WS_BASE_URL="ws://127.0.0.1:${BACKEND_PORT:-8000}" npx vite build
fi

npx playwright test --config=playwright.cross-browser.config.ts "$@"
