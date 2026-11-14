const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSIONS = { ruff: '0.8.6', madge: '8.0.0' };
const ROOT = path.resolve(__dirname, '../..');

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function relativeFile(value) {
  return nonempty(value) && !/[\\\x00-\x1f]/.test(value)
    && !path.posix.isAbsolute(value) && value.split('/').every((part) => part && part !== '..' && part !== '.');
}

function position(value) {
  return value && Number.isInteger(value.row) && value.row > 0
    && Number.isInteger(value.column) && value.column > 0;
}

function reportArray(stdout, status) {
  requireValid(status === 0 || status === 1, `Scanner failed (exit ${status}).`);
  const report = JSON.parse(stdout);
  requireValid(Array.isArray(report), 'Scanner report must be a JSON array.');
  requireValid(status === (report.length ? 1 : 0), 'Scanner exit code disagrees with its report.');
  return report;
}

function parseRuff(stdout, status, backend) {
  const sources = new Map();
  return reportArray(stdout, status).map((item) => {
    requireValid(item && nonempty(item.filename) && nonempty(item.code) && /^[A-Z]+\d+$/.test(item.code)
      && nonempty(item.message) && position(item.location) && position(item.end_location), 'Malformed Ruff diagnostic.');
    const filename = path.resolve(backend, item.filename);
    const relative = path.relative(backend, filename).split(path.sep).join('/');
    requireValid(relativeFile(relative), `Ruff path is outside backend: ${item.filename}`);
    if (!sources.has(filename)) sources.set(filename, fs.readFileSync(filename, 'utf8').split(/\r?\n/));
    const lines = sources.get(filename);
    const start = item.location;
    const end = item.end_location;
    requireValid(start.row <= lines.length && end.row <= lines.length
      && start.column <= lines[start.row - 1].length + 1 && end.column <= lines[end.row - 1].length + 1
      && (end.row > start.row || (end.row === start.row && end.column >= start.column)), `Invalid Ruff location: ${relative}`);
    const last = end.column === 1 && end.row > start.row ? end.row - 1 : end.row;
    const source = lines.slice(start.row - 1, last).join('\n');
    requireValid(nonempty(source), `Missing source for Ruff diagnostic: ${relative}`);
    return { path: relative, code: item.code, message: item.message, line: start.row, column: start.column, source };
  });
}

function canonicalCycle(files) {
  requireValid(Array.isArray(files) && files.length > 0 && files.every(relativeFile)
    && new Set(files).size === files.length, 'Malformed Madge cycle.');
  const rotations = files.map((_, index) => [...files.slice(index), ...files.slice(0, index)]);
  rotations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return rotations[0];
}

function parseMadge(stdout, status) {
  const cycles = reportArray(stdout, status).map((files) => ({ files: canonicalCycle(files) }));
  requireValid(new Set(cycles.map((cycle) => JSON.stringify(cycle.files))).size === cycles.length, 'Duplicate Madge cycles.');
  return cycles;
}

function validateVersion(tool, stdout, status) {
  const expected = tool === 'ruff' ? `ruff ${VERSIONS.ruff}` : VERSIONS.madge;
  requireValid(Object.hasOwn(VERSIONS, tool) && status === 0 && stdout.trim() === expected,
    `Unsupported or unavailable ${tool} version: ${stdout.trim() || '(missing)'}. Expected ${expected}.`);
  return VERSIONS[tool];
}

function key(tool, item) {
  return JSON.stringify(tool === 'ruff'
    ? [item.path, item.code, item.message, item.source]
    : canonicalCycle(item.files));
}

function compareFindings(tool, actual, baseline) {
  const remaining = new Map();
  for (const item of baseline) {
    const identity = key(tool, item);
    if (!remaining.has(identity)) remaining.set(identity, []);
    remaining.get(identity).push(item);
  }
  const added = [];
  let accepted = 0;
  for (const item of actual) {
    const allowed = remaining.get(key(tool, item));
    if (allowed?.length) { allowed.pop(); accepted += 1; }
    else added.push(item);
  }
  return { added, accepted, retired: [...remaining.values()].flat() };
}

function readBaseline(filename) {
  const baseline = JSON.parse(fs.readFileSync(filename, 'utf8'));
  requireValid(baseline && baseline.schema === 1 && /^[a-f0-9]{40}$/.test(baseline.source_commit)
    && baseline.versions?.ruff === VERSIONS.ruff && baseline.versions?.madge === VERSIONS.madge
    && baseline.reasons && typeof baseline.reasons === 'object'
    && Array.isArray(baseline.ruff) && Array.isArray(baseline.madge), 'Invalid quality baseline metadata.');
  for (const item of baseline.ruff) {
    requireValid(item && relativeFile(item.path) && nonempty(item.code) && /^[A-Z]+\d+$/.test(item.code)
      && nonempty(item.message) && nonempty(item.source)
      && Number.isInteger(item.line) && item.line > 0 && Number.isInteger(item.column) && item.column > 0
      && nonempty(baseline.reasons[item.code]), 'Invalid or unexplained Ruff allowance.');
  }
  for (const item of baseline.madge) {
    canonicalCycle(item?.files);
    requireValid(nonempty(item.reason), 'Unexplained Madge allowance.');
  }
  requireValid(new Set(baseline.madge.map((item) => key('madge', item))).size === baseline.madge.length,
    'Duplicate Madge allowances.');
  return baseline;
}

function execute(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
  if (result.error) throw result.error;
  requireValid(result.signal === null, `Scanner terminated by ${result.signal}.`);
  return result;
}

function run(tool, directory) {
  requireValid(Object.hasOwn(VERSIONS, tool) && nonempty(directory), 'Usage: quality_findings.cjs ruff|madge REPORT_DIRECTORY');
  const baseline = readBaseline(path.join(ROOT, 'scripts/ci/quality-baseline.json'));
  const command = tool === 'ruff' ? 'pdm' : path.join(ROOT, 'frontend/node_modules/.bin/madge');
  const cwd = tool === 'ruff' ? path.join(ROOT, 'backend') : ROOT;
  const prefix = path.join(directory, tool === 'ruff' ? 'backend-ruff' : 'frontend-madge-circular');
  fs.mkdirSync(directory, { recursive: true });
  const versionArgs = tool === 'ruff' ? ['run', 'ruff', '--version'] : ['--version'];
  const version = execute(command, versionArgs, cwd);
  fs.writeFileSync(`${prefix}.version.txt`, version.stdout + version.stderr);
  requireValid(!version.stderr.trim(), `${tool} version check emitted errors; see ${prefix}.version.txt`);
  validateVersion(tool, version.stdout, version.status);
  const args = tool === 'ruff' ? ['run', 'ruff', 'check', '.', '--output-format=json']
    : ['--circular', '--extensions', 'ts,tsx', '--json', path.join(ROOT, 'frontend/src')];
  const start = performance.now();
  const result = execute(command, args, cwd);
  fs.writeFileSync(`${prefix}.json`, result.stdout);
  fs.writeFileSync(`${prefix}.stderr.txt`, result.stderr);
  fs.writeFileSync(`${prefix}.status.json`, JSON.stringify({ version: VERSIONS[tool], command: [command, ...args], exit: result.status, seconds: (performance.now() - start) / 1000 }, null, 2) + '\n');
  requireValid(!result.stderr.trim(), `${tool} emitted errors; see ${prefix}.stderr.txt`);
  const actual = tool === 'ruff' ? parseRuff(result.stdout, result.status, cwd) : parseMadge(result.stdout, result.status);
  const diff = compareFindings(tool, actual, baseline[tool]);
  const detail = { tool, version: VERSIONS[tool], source_commit: baseline.source_commit, ...diff };
  fs.writeFileSync(`${prefix}.comparison.json`, JSON.stringify(detail, null, 2) + '\n');
  console.log(`[BASELINE] ${tool}: ${diff.accepted} accepted legacy findings; ${diff.added.length} new; ${diff.retired.length} retired.`);
  for (const item of actual) {
    if (tool === 'madge') console.log(`  Cycle: ${item.files.join(' -> ')} -> ${item.files[0]}`);
  }
  for (const item of diff.added.slice(0, 20)) {
    console.error(tool === 'ruff' ? `  backend/${item.path}:${item.line}:${item.column} ${item.code} ${item.message}`
      : `  NEW cycle: ${item.files.join(' -> ')} -> ${item.files[0]}`);
  }
  if (diff.added.length > 20) console.error(`  ${diff.added.length - 20} additional findings in ${prefix}.comparison.json`);
  if (diff.retired.length) console.log('  Remove retired entries from the baseline; do not replace them with unrelated allowances.');
  if (diff.added.length) {
    console.error(`Fix the new findings. Deliberate baseline changes require a specific rationale and review; see docs/testing-and-ci.md.`);
    return 1;
  }
  console.log(`  Full current findings: ${prefix}.json; comparison: ${prefix}.comparison.json`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = run(process.argv[2], process.argv[3]); }
  catch (error) { console.error(`[INCONCLUSIVE] ${error.message}`); process.exitCode = 2; }
}

module.exports = { parseRuff, parseMadge, compareFindings, validateVersion, execute, readBaseline, run };
