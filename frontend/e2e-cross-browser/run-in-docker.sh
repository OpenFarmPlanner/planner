#!/usr/bin/env bash
#
# Runs the cross-browser Playwright suite inside the official Playwright Docker
# image whose version matches the installed @playwright/test, so screenshots
# are rendered with the same browsers, fonts and system libraries on every
# machine and in CI. Arguments are passed through to `playwright test`, e.g.
#
#   e2e-cross-browser/run-in-docker.sh --project=mobile-firefox
#   e2e-cross-browser/run-in-docker.sh --update-snapshots
#
# Environment:
#   E2E_DOCKER_ARGS  extra `docker run` arguments (proxy variables, CA mounts,
#                    `--network host`, ...); word-split on purpose.
#   E2E_SKIP_BUILD=1 reuse the dist/ from a previous run of this script.
#
# The backend, the production bundle and the browsers all run inside the
# container on its own network, so a dev server already listening on the
# host's 8000/4173 is never reused by mistake. node_modules, the backend
# virtualenv and the uv/npm caches live in named Docker volumes: a host
# node_modules (possibly built for macOS) is never mixed into the container.
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"

PLAYWRIGHT_VERSION="$(node -p "require('$FRONTEND_DIR/package-lock.json').packages['node_modules/@playwright/test'].version")"
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"

tty_args=()
if [ -t 0 ] && [ -t 1 ]; then
  tty_args=(-it)
fi

# shellcheck disable=SC2086
exec docker run --rm --init --ipc=host "${tty_args[@]}" \
  -v "$REPO_DIR:/work" \
  -v openfarmplanner-e2e-node-modules:/work/frontend/node_modules \
  -v openfarmplanner-e2e-cache:/cache \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -e E2E_SKIP_BUILD \
  -e CI \
  ${E2E_DOCKER_ARGS:-} \
  -w /work/frontend \
  "$IMAGE" \
  bash e2e-cross-browser/docker-entrypoint.sh "$@"
