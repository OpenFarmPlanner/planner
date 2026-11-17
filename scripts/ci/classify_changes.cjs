// Decide whether a pull request changes only metadata (docs, Markdown, version
// numbers), so heavy CI jobs may be skipped. Fail closed: anything unexpected,
// including a failed diff, means "run everything". See docs/testing-and-ci.md.
const cp = require('node:child_process');
const fs = require('node:fs');

const VERSION = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;
// Each version file may only change its single version line.
const VERSION_LINES = {
  'backend/config/version.py': new RegExp(`^VERSION = "${VERSION}"$`),
  'backend/pyproject.toml': new RegExp(`^version = "${VERSION}"$`),
};
// Read by the running backend (settings.API_GUIDE_PATH), so it is not metadata.
const RUNTIME_DOCS = new Set(['docs/api.md']);

function isDocumentation(file) {
  if (RUNTIME_DOCS.has(file)) return false;
  if (file.startsWith('docs/')) return true;
  if (!file.endsWith('.md')) return false;
  return !file.includes('/') || file.startsWith('.claude/');
}

/**
 * @param {string[]} files changed paths
 * @param {Record<string, string[]>} changedLines version file -> its added/removed lines without the +/- marker
 */
function classify(files, changedLines = {}) {
  if (!files.length) return { metadataOnly: false, reason: 'no changed files could be determined' };
  for (const file of files) {
    if (isDocumentation(file)) continue;
    const pattern = VERSION_LINES[file];
    if (!pattern) return { metadataOnly: false, reason: `${file} is not metadata` };
    const lines = changedLines[file];
    if (!lines?.length || !lines.every((line) => pattern.test(line))) {
      return { metadataOnly: false, reason: `${file} changes more than its version line` };
    }
  }
  return { metadataOnly: true, reason: `metadata-only: ${files.join(', ')}` };
}

function git(...args) {
  return cp.execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', timeout: 60_000 });
}

function changedLinesOf(base, head, file) {
  return git('diff', '--unified=0', '--no-color', base, head, '--', file).split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
    .map((line) => line.slice(1));
}

function classifyRange(base, head) {
  const files = git('diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
  const changedLines = Object.fromEntries(files.filter((file) => VERSION_LINES[file])
    .map((file) => [file, changedLinesOf(base, head, file)]));
  return classify(files, changedLines);
}

function main() {
  let result;
  try {
    const [base, head] = process.argv.slice(2);
    if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head ?? '')) {
      throw new Error('Usage: node scripts/ci/classify_changes.cjs BASE_SHA HEAD_SHA');
    }
    result = classifyRange(base, head);
  } catch (error) {
    result = { metadataOnly: false, reason: `classification failed, running everything: ${error.message}` };
  }
  console.log(`Change classification: ${result.reason}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `metadata_only=${result.metadataOnly}\n`);
  }
}

if (require.main === module) main();
module.exports = { classify, isDocumentation };
