const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  parseRuff, parseMadge, compareFindings, validateVersion, execute, readBaseline,
} = require('../scripts/ci/quality_findings.cjs');

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-findings-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'example.py'), 'import unused\n');
  return root;
}

function diagnostic(root, overrides = {}) {
  return {
    filename: path.join(root, 'example.py'), code: 'F401', message: '`unused` imported but unused',
    location: { row: 1, column: 8 }, end_location: { row: 1, column: 14 }, ...overrides,
  };
}

test('clean reports and supported versions pass; inconsistent exit codes fail', () => {
  assert.deepEqual(parseRuff('[]', 0, '/unused'), []);
  assert.deepEqual(parseMadge('[]', 0), []);
  assert.equal(validateVersion('ruff', 'ruff 0.8.6\n', 0), '0.8.6');
  assert.equal(validateVersion('madge', '8.0.0\n', 0), '8.0.0');
  for (const parse of [parseRuff, parseMadge]) {
    for (const code of [1, 2, null]) assert.throws(() => parse('[]', code, '/unused'));
    for (const report of ['', '{}', 'null', '[', 'ERROR: crash']) {
      assert.throws(() => parse(report, 0, '/unused'));
    }
  }
  assert.throws(() => parseMadge('[["a.ts","b.ts"]]', 0));
});

test('tool failures, missing binaries and unsupported versions are inconclusive', () => {
  assert.throws(() => execute('/definitely/missing-quality-tool', [], process.cwd()));
  for (const [tool, version] of [['ruff', 'ruff 0.9.0'], ['madge', '9.0.0']]) {
    assert.throws(() => validateVersion(tool, version, 0));
    assert.throws(() => validateVersion(tool, version, 1));
  }
  assert.throws(() => validateVersion('ruff', '', 0));
});

test('Ruff reports actionable locations and matches exact source with multiplicity', (t) => {
  const root = fixture(t);
  const actual = parseRuff(JSON.stringify([diagnostic(root)]), 1, root);
  assert.equal(actual[0].path, 'example.py');
  assert.equal(actual[0].line, 1);
  assert.equal(actual[0].source, 'import unused');
  assert.equal(compareFindings('ruff', actual, []).added.length, 1);
  assert.equal(compareFindings('ruff', actual, actual).accepted, 1);
  assert.equal(compareFindings('ruff', [], actual).retired.length, 1);
  assert.equal(compareFindings('ruff', [actual[0], actual[0]], actual).added.length, 1);
  assert.equal(compareFindings('ruff', [{ ...actual[0], line: 9 }], actual).added.length, 0);
  assert.equal(compareFindings('ruff', [{ ...actual[0], source: 'import different' }], actual).added.length, 1);
});

test('malformed Ruff diagnostics and missing/outside source files fail closed', (t) => {
  const root = fixture(t);
  for (const change of [
    { filename: '/outside.py' }, { filename: path.join(root, 'missing.py') },
    { code: null }, { message: '' }, { location: { row: 0, column: 1 } },
    { code: ['F401'] }, { location: { row: 1, column: 999 } },
    { location: { row: 99, column: 1 } }, { end_location: { row: 0, column: 1 } },
  ]) assert.throws(() => parseRuff(JSON.stringify([diagnostic(root, change)]), 1, root));
});

test('cycles normalize rotation while preserving direction and reject new cycles', () => {
  const allowed = parseMadge('[["a.ts","b.ts","c.ts"]]', 1);
  assert.equal(compareFindings('madge', parseMadge('[["b.ts","c.ts","a.ts"]]', 1), allowed).added.length, 0);
  assert.equal(compareFindings('madge', parseMadge('[["a.ts","c.ts","b.ts"]]', 1), allowed).added.length, 1);
  assert.equal(compareFindings('madge', parseMadge('[["a.ts"]]', 1), []).added.length, 1);
  for (const report of ['[[]]', '[[1]]', '[["../a.ts"]]', '[["a.ts","a.ts"]]', '[["a.ts"],["a.ts"]]']) {
    assert.throws(() => parseMadge(report, 1));
  }
});

test('baseline corruption or unexplained allowances fail closed', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'baseline.json');
  const baseline = {
    schema: 1, source_commit: 'a'.repeat(40), versions: { ruff: '0.8.6', madge: '8.0.0' },
    reasons: {}, ruff: [], madge: [],
  };
  writeFileSync(file, JSON.stringify(baseline));
  assert.deepEqual(readBaseline(file), baseline);
  for (const change of [
    { schema: 2 }, { source_commit: '' }, { versions: { ruff: '999', madge: '8.0.0' } },
    { ruff: [{}] }, { madge: [{ files: ['a.ts'], reason: '' }] },
  ]) {
    writeFileSync(file, JSON.stringify({ ...baseline, ...change }));
    assert.throws(() => readBaseline(file));
  }
  writeFileSync(file, '{');
  assert.throws(() => readBaseline(file));
});

test('real controlled Ruff violation fails independently of legacy warnings', (t) => {
  const root = fixture(t);
  const binary = path.resolve(__dirname, '../backend/.venv/bin/ruff');
  const result = spawnSync(binary, ['check', '--isolated', '--select', 'F401', '--output-format=json', root], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const diff = compareFindings('ruff', parseRuff(result.stdout, result.status, root), []);
  assert.equal(diff.added[0].code, 'F401');
  assert.equal(diff.added[0].path, 'example.py');
});

test('real controlled Madge cycle fails independently of the accepted cycle', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'a.ts'), "import { b } from './b'; export const a = () => b;\n");
  writeFileSync(path.join(root, 'b.ts'), "import { a } from './a'; export const b = () => a;\n");
  const binary = path.resolve(__dirname, '../frontend/node_modules/.bin/madge');
  const result = spawnSync(binary, ['--circular', '--extensions', 'ts,tsx', '--json', root], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const diff = compareFindings('madge', parseMadge(result.stdout, result.status), []);
  assert.deepEqual(diff.added[0].files, ['a.ts', 'b.ts']);
});

test('gate CLI fails on real fixture regressions, accepts explained baselines and rejects crashes', (t) => {
  const root = fixture(t);
  for (const directory of ['scripts/ci', 'backend', 'frontend/src', 'bin']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  const script = path.join(root, 'scripts/ci/quality_findings.cjs');
  copyFileSync(path.resolve(__dirname, '../scripts/ci/quality_findings.cjs'), script);
  symlinkSync(path.resolve(__dirname, '../frontend/node_modules'), path.join(root, 'frontend/node_modules'), 'dir');
  const baseline = {
    schema: 1, source_commit: 'a'.repeat(40), versions: { ruff: '0.8.6', madge: '8.0.0' },
    reasons: {}, ruff: [], madge: [],
  };
  const baselineFile = path.join(root, 'scripts/ci/quality-baseline.json');
  const saveBaseline = () => writeFileSync(baselineFile, JSON.stringify(baseline));
  saveBaseline();
  const ruff = path.resolve(__dirname, '../backend/.venv/bin/ruff');
  const pdm = path.join(root, 'bin/pdm');
  writeFileSync(pdm, '#!/usr/bin/env node\n' +
    `const r = require('node:child_process').spawnSync(${JSON.stringify(ruff)}, process.argv.slice(4), {stdio:'inherit'}); process.exit(r.status ?? 2);\n`, { mode: 0o755 });
  const reports = path.join(root, 'reports');
  const gate = (tool) => spawnSync(process.execPath, [script, tool, reports], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}` },
  });
  const source = path.join(root, 'backend/example.py');
  writeFileSync(source, 'import unused\n');
  let result = gate('ruff');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /backend\/example.py:1:8 F401/);
  baseline.ruff = parseRuff(readFileSync(path.join(reports, 'backend-ruff.json'), 'utf8'), 1, path.join(root, 'backend'));
  baseline.reasons.F401 = 'Controlled fixture allowance used to test the gate.';
  saveBaseline();
  assert.equal(gate('ruff').status, 0);
  writeFileSync(source, 'value = 1\n');
  assert.equal(gate('ruff').status, 0);
  writeFileSync(path.join(root, 'frontend/src/a.ts'), "import { b } from './b'; export const a = () => b;\n");
  writeFileSync(path.join(root, 'frontend/src/b.ts'), "import { a } from './a'; export const b = () => a;\n");
  result = gate('madge');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /NEW cycle: a.ts -> b.ts -> a.ts/);
  baseline.madge = [{ files: ['a.ts', 'b.ts'], reason: 'Controlled fixture allowance.' }];
  saveBaseline();
  assert.equal(gate('madge').status, 0);
  writeFileSync(path.join(root, 'frontend/src/b.ts'), 'export const b = 1;\n');
  assert.equal(gate('madge').status, 0);
  writeFileSync(pdm, '#!/usr/bin/env node\n' +
    `process.stdout.write(process.argv.includes('--version') ? 'ruff 0.8.6\\n' : '[]'); process.exit(process.argv.includes('--version') ? 0 : 1);\n`);
  result = gate('ruff');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /INCONCLUSIVE.*exit code disagrees/);
});
