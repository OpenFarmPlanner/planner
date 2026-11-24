const assert = require('node:assert/strict');
const { test } = require('node:test');

test('PR smoke requires the exact nonempty roster and successful results for the shard', () => {
  const { verifySmoke } = require('../scripts/ci/verify_pr_smoke.cjs');
  const rosters = [['a.spec.ts › suite › a'], ['b.spec.ts › b'], ['c.spec.ts › c']];
  const result = { title: ' › chromium › a.spec.ts › suite › a', status: 'passed' };
  const report = { partition: '1/3', status: 'passed', tests: [result] };
  verifySmoke(1, rosters, report);
  for (const tests of [[], [result, result], [{ ...result, status: 'skipped' }],
    [{ ...result, title: ' › chromium › b.spec.ts › b' }]]) {
    assert.throws(() => verifySmoke(1, rosters, { ...report, tests }));
  }
  assert.throws(() => verifySmoke(2, rosters, report));
  assert.throws(() => verifySmoke(1, [rosters[0], rosters[1], []], report));
  assert.throws(() => verifySmoke(1, [rosters[0], rosters[1], rosters[0]], report));
});
