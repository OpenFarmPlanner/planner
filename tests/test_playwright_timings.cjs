const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Reporter = require('../scripts/ci/playwright_timings.cjs');

function fixture(t, tests) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-timings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, 'results', 'timings.json');
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line.trim()));
  const reporter = new Reporter({ outputFile });
  reporter.onBegin({ configFile: path.join(directory, 'playwright.config.ts'), workers: 1,
    shard: { current: 1, total: 3 } }, { allTests: () => tests });
  return { reporter, outputFile, lines };
}

function caseOf(id, filename) {
  return { id, location: { file: path.resolve('e2e', filename) },
    parent: { project: () => ({ name: 'chromium' }) },
    titlePath: () => ['chromium', filename, 'a test with a\nnewline'] };
}

const outcome = { status: 'passed', startTime: new Date('2026-11-14T10:00:00Z'), duration: 2200 };

test('records nested fixtures once and preserves failed attempts and retries', t => {
  const subject = caseOf('one', 'one.spec.ts');
  const { reporter, outputFile, lines } = fixture(t, [subject]);
  const login = { category: 'test.step', title: 'Fixture: login', duration: 1000, parent: null };
  reporter.onStepEnd(subject, { retry: 0 }, {
    category: 'test.step', title: 'Fixture: setup', duration: 300, parent: login,
  });
  reporter.onStepEnd(subject, { retry: 0 }, login);
  reporter.onTestEnd(subject, { retry: 0, status: 'failed', duration: 1200 });
  reporter.onStepEnd(subject, { retry: 1 }, {
    category: 'test.step', title: 'Fixture: setup', duration: 200, parent: null,
  });
  reporter.onTestEnd(subject, { retry: 1, status: 'passed', duration: 800 });
  reporter.onEnd(outcome);

  const report = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.deepEqual(report.tests.map(row => [row.status, row.retry, row.fixture_ms]),
    [['failed', 0, 1000], ['passed', 1, 200]]);
  assert.equal(report.files[0].duration_ms, 2000);
  assert.equal(report.files[0].fixture_ms, 1200);
  assert.equal(report.retries, 1);
  assert.equal(report.selected.length, 1);
  assert.equal(report.duration_ms, outcome.duration);
  for (const line of lines) {
    assert.ok(!line.includes('\n'));
    JSON.parse(line.slice(line.indexOf(' ') + 1));
  }
});

test('keeps fixture measurements separate between tests and attempts', t => {
  const first = caseOf('one', 'one.spec.ts');
  const second = caseOf('two', 'two.spec.ts');
  const { reporter, outputFile } = fixture(t, [first, second]);
  reporter.onStepEnd(first, { retry: 0 }, {
    category: 'test.step', title: 'Fixture: setup', duration: 100, parent: null,
  });
  reporter.onStepEnd(second, { retry: 0 }, {
    category: 'pw:api', title: 'API request', duration: 200, parent: null,
  });
  reporter.onTestEnd(first, { retry: 0, status: 'passed', duration: 300 });
  reporter.onTestEnd(second, { retry: 0, status: 'skipped', duration: 0 });
  reporter.onTestEnd(first, { retry: 1, status: 'passed', duration: 50 });
  reporter.onEnd({ ...outcome, status: 'failed' });

  const report = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.tests.map(row => row.fixture_ms), [100, 0, 0]);
  assert.equal(report.files.length, 2);
  assert.equal(report.selected.length, 2);
  assert.deepEqual(report.shard, { current: 1, total: 3 });
});
