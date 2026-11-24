const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function verifySmoke(shard, rosters, report) {
  assert.ok(Number.isInteger(shard) && shard >= 1 && shard <= rosters.length, 'Unknown PR smoke shard');
  const all = rosters.flat();
  assert.ok(rosters.every(roster => roster.length > 0), 'Empty PR smoke shard');
  assert.equal(new Set(all).size, all.length, 'Duplicate PR smoke entry');
  assert.equal(report.status, 'passed');
  assert.equal(report.partition, `${shard}/${rosters.length}`);
  const expected = rosters[shard - 1].map(title => ` › chromium › ${title}`).sort();
  const completed = report.tests.map(test => {
    assert.equal(test.status, 'passed', test.title);
    return test.title;
  }).sort();
  assert.deepEqual(completed, expected, 'Each listed Chromium journey must pass exactly once');
}

if (require.main === module) {
  const rosters = [1, 2, 3].map(shard => fs.readFileSync(
    path.join(__dirname, 'pr-smoke', `${shard}.txt`), 'utf8',
  ).split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/test-results/e2e-timings.json'), 'utf8'));
  verifySmoke(Number(process.argv[2]), rosters, report);
}
module.exports = { verifySmoke };
