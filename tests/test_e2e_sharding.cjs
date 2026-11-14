const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseShard, discoverFiles, partition, filePattern } = require('../scripts/ci/run_e2e_shard.cjs');

const profile = { schema: 1, files: {
  'e2e/a.spec.ts': { tests: 2, duration_ms: 200 },
  'e2e/b.spec.ts': { tests: 1, duration_ms: 80 },
} };
const group = (file, count) => ({ file: `e2e/${file}.spec.ts`, tests: Array.from({ length: count }, (_, n) => `${file}-${n}`) });

test('balances entire files, scales changed counts, and includes new files exactly once', () => {
  const files = [group('a', 4), group('b', 1), group('new', 2), group('small', 1)];
  const shards = partition(files, profile, 3);
  assert.deepEqual(partition([...files].reverse(), profile, 3), shards);
  const assigned = shards.flatMap(shard => shard.files);
  assert.deepEqual(assigned.map(file => file.file).sort(), files.map(file => file.file).sort());
  assert.equal(new Set(assigned.flatMap(file => file.tests)).size, 8);
  assert.equal(shards[0].estimated_ms, 400);
  assert.equal(assigned.find(file => file.file === 'e2e/new.spec.ts').estimated_ms, 2 * 280 / 3);
  assert.ok(shards.every(shard => shard.files.length));
});

test('balances runtime rather than equal test counts', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => group(name, 1));
  const measured = { schema: 1, files: Object.fromEntries(files.map((file, index) => [file.file,
    { tests: 1, duration_ms: index < 3 ? 100 : 10 }])) };
  const shards = partition(files, measured, 3);
  assert.deepEqual(shards.map(shard => shard.estimated_ms), [110, 110, 110]);
  assert.ok(shards.every(shard => shard.files.length === 2));
});

test('discovers nested describes and retains every browser project variant', () => {
  const spec = (id, file, projects) => ({ id, file, tests: projects.map(projectName => ({ projectName })) });
  const report = { config: { rootDir: '/repo/frontend/e2e' }, suites: [
    { specs: [spec('one', 'a.spec.ts', ['chromium'])], suites: [
      { specs: [spec('two', 'a.spec.ts', ['chromium', 'chromium-scrollbars'])] },
    ] }, { specs: [spec('three', 'scrollbar-layout.spec.ts', ['chromium-scrollbars'])] },
  ] };
  const files = discoverFiles(report, '/repo/frontend');
  assert.equal(files.length, 2);
  assert.deepEqual(files[0].tests, ['one:chromium', 'two:chromium', 'two:chromium-scrollbars']);
  assert.deepEqual(files[1].tests, ['three:chromium-scrollbars']);
  assert.throws(() => discoverFiles({ ...report, errors: [{ message: 'syntax error' }] }, '/repo/frontend'));
  assert.throws(() => discoverFiles({ ...report, suites: [report.suites[0], report.suites[0]] }, '/repo/frontend'));
  assert.throws(() => discoverFiles({ ...report, suites: [] }, '/repo/frontend'));
  assert.throws(() => discoverFiles({ ...report, suites: [{ specs: [spec('x', '../outside.spec.ts', ['chromium'])] }] }, '/repo/frontend'));
});

test('file filters are anchored, literal and keep the separate scrollbar project', () => {
  const pattern = new RegExp(filePattern('e2e/a+[x].spec.ts'));
  assert.ok(pattern.test('/repo/frontend/e2e/a+[x].spec.ts'));
  assert.ok(pattern.test('e2e/a+[x].spec.ts'));
  assert.ok(!pattern.test('e2e/aaaaax.spec.ts'));
  assert.ok(!pattern.test('e2e/a+[x].spec.ts.bak'));
  assert.ok(!pattern.test('other-e2e/a+[x].spec.ts'));
  assert.ok(new RegExp(filePattern('e2e/scrollbar-layout.spec.ts')).test('/repo/frontend/e2e/scrollbar-layout.spec.ts'));
});

test('rejects malformed shard ranges and timing data instead of silently dropping coverage', () => {
  assert.deepEqual(parseShard('2/3'), { current: 2, total: 3 });
  for (const input of ['0/3', '4/3', '1/0', '1/3;echo', '1.5/3', '1/9007199254740992', undefined]) {
    assert.throws(() => parseShard(input));
  }
  for (const bad of [{}, { schema: 1, files: {} }, { schema: 1, files: { x: { tests: 0, duration_ms: 4 } } },
    { schema: 1, files: { x: { tests: 1, duration_ms: NaN } } }]) {
    assert.throws(() => partition([group('a', 1)], bad, 1));
  }
  assert.throws(() => partition([group('a', 1)], profile, 3));
});
