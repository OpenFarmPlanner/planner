#!/usr/bin/env bash
set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORTS_DIR="$ROOT_DIR/reports"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
ARCHIVE_DIR="$REPORTS_DIR/$TIMESTAMP"
LATEST_DIR="$REPORTS_DIR/latest"

mkdir -p "$ARCHIVE_DIR"
rm -rf "$LATEST_DIR"
mkdir -p "$LATEST_DIR"

fatal=0

copy_latest() {
  local name="$1"
  cp "$ARCHIVE_DIR/$name" "$LATEST_DIR/$name"
}

run_tool() {
  local name="$1"
  local output_file="$2"
  local allowed_codes="$3"
  shift 3

  local out_path="$ARCHIVE_DIR/$output_file"
  {
    echo "# $name"
    echo "# Timestamp: $(date -Iseconds)"
    echo "# Command: $*"
    echo
  } > "$out_path"

  set +e
  "$@" >> "$out_path" 2>&1
  local rc=$?
  set -e

  local ok=1
  IFS=',' read -r -a codes <<< "$allowed_codes"
  for code in "${codes[@]}"; do
    if [[ "$rc" == "$code" ]]; then
      ok=0
      break
    fi
  done

  if [[ $ok -ne 0 ]]; then
    echo "[ERROR] $name failed unexpectedly (exit code: $rc). See $out_path"
    fatal=1
  else
    echo "[OK] $name finished (exit code: $rc). Report: $out_path"
  fi

  copy_latest "$output_file"
}

# Backend reports
if [[ -d "$ROOT_DIR/backend" ]]; then
  if command -v pdm >/dev/null 2>&1; then
    run_tool "Backend Ruff" "backend-ruff.txt" "0" node "$ROOT_DIR/scripts/ci/quality_findings.cjs" ruff "$ARCHIVE_DIR"
    run_tool "Backend Radon CC" "backend-radon-cc.txt" "0" bash -lc "cd \"$ROOT_DIR/backend\" && pdm run radon cc farm -s -a"

    if [[ "${SKIP_BACKEND_TESTS:-0}" == "1" ]]; then
      # CI's `quality` job sets this. The `backend-tests` job runs the same
      # suite with the same coverage flags, so running it here too doubled the
      # backend suite across two jobs and made `quality` as long as the test
      # job it duplicated. Locally the variable is unset and the full report is
      # produced as before.
      note="$ARCHIVE_DIR/backend-pytest-cov.txt"
      {
        echo "# Backend Pytest Coverage"
        echo "# Timestamp: $(date -Iseconds)"
        echo
        echo "Skipped: SKIP_BACKEND_TESTS=1 (the backend-tests CI job owns this run)."
      } > "$note"
      copy_latest "backend-pytest-cov.txt"
      echo "[SKIP] Backend Pytest Coverage: SKIP_BACKEND_TESTS=1."
    elif [[ -f "$ROOT_DIR/backend/pytest.ini" ]]; then
      run_tool "Backend Pytest Coverage" "backend-pytest-cov.txt" "0,1,5" bash -lc "cd \"$ROOT_DIR/backend\" && pdm run pytest --cov=farm --cov-report=term-missing"
    else
      note="$ARCHIVE_DIR/backend-pytest-cov.txt"
      {
        echo "# Backend Pytest Coverage"
        echo "# Timestamp: $(date -Iseconds)"
        echo
        echo "Skipped: pytest.ini not found in backend/."
      } > "$note"
      copy_latest "backend-pytest-cov.txt"
      echo "[SKIP] Backend Pytest Coverage: pytest is not configured."
    fi
  else
    for f in backend-ruff.txt backend-radon-cc.txt backend-pytest-cov.txt; do
      {
        echo "# Backend quality tools"
        echo "# Timestamp: $(date -Iseconds)"
        echo
        echo "Skipped: pdm command is not available in PATH."
      } > "$ARCHIVE_DIR/$f"
      copy_latest "$f"
    done
    echo "[ERROR] Backend tools skipped because pdm is unavailable."
    fatal=1
  fi
fi

# Frontend reports
if [[ -d "$ROOT_DIR/frontend" ]]; then
  if [[ -d "$ROOT_DIR/frontend/node_modules" ]]; then
    # Exit code 0 only: any ESLint *error* fails the quality gate. Warnings are
    # still reported but do not fail the run (--max-warnings=-1), which is what
    # keeps the known react-hooks/set-state-in-effect findings visible without
    # blocking. See frontend/eslint.config.js for why that rule is a warning.
    run_tool "Frontend ESLint" "frontend-eslint.txt" "0" npm --prefix "$ROOT_DIR/frontend" run lint -- --max-warnings=-1

    if [[ -x "$ROOT_DIR/frontend/node_modules/.bin/madge" ]]; then
      run_tool "Frontend Madge Circular" "frontend-madge-circular.txt" "0" node "$ROOT_DIR/scripts/ci/quality_findings.cjs" madge "$ARCHIVE_DIR"
    else
      {
        echo "# Frontend Madge Circular"
        echo "# Timestamp: $(date -Iseconds)"
        echo
        echo "Skipped: madge is not installed. Run: cd frontend && npm install"
      } > "$ARCHIVE_DIR/frontend-madge-circular.txt"
      copy_latest "frontend-madge-circular.txt"
      echo "[ERROR] Frontend Madge check skipped because madge is not installed."
      fatal=1
    fi
  else
    for f in frontend-eslint.txt frontend-madge-circular.txt; do
      {
        echo "# Frontend quality tools"
        echo "# Timestamp: $(date -Iseconds)"
        echo
        echo "Skipped: frontend/node_modules is missing. Run: cd frontend && npm install"
      } > "$ARCHIVE_DIR/$f"
      copy_latest "$f"
    done
    echo "[ERROR] Frontend tools skipped because dependencies are not installed."
    fatal=1
  fi
fi

# Keep machine-readable scanner evidence alongside the existing text reports.
for evidence in "$ARCHIVE_DIR"/*.json "$ARCHIVE_DIR"/*.version.txt "$ARCHIVE_DIR"/*.stderr.txt; do
  if [[ -f "$evidence" ]]; then
    copy_latest "$(basename "$evidence")"
  fi
done

echo
echo "Quality reports generated:"
echo "- Latest:   $LATEST_DIR"
echo "- Archived: $ARCHIVE_DIR"

if [[ $fatal -ne 0 ]]; then
  echo "Quality run completed with new findings or setup/tooling errors."
  exit 2
fi

echo "Quality run completed successfully."
