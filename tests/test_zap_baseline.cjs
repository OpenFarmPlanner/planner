const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { assess } = require('../scripts/ci/zap/assess.cjs');
const { IMAGE, TARGET } = require('../scripts/ci/zap/run.cjs');

function fixture() {
  return {
    status: { stage: 'scan', exit: 2, image: IMAGE, target: TARGET },
    coverage: { target: TARGET, passive_remaining: 0, requests: [
      ...['/', '/en', '/fr', '/es', '/api/schema/', '/__zap_fixture__/']
        .map(route => ({ method: 'GET', path: route, status: 200 })),
      { method: 'GET', path: '/api/crops/', status: 401 },
    ] },
    report: { '@version': '2.17.0', site: [{ '@host': '127.0.0.1', '@port': '4173', alerts: [{
      pluginid: '10021', riskcode: '1', instances: [{ uri: TARGET + '__zap_fixture__/' }],
    }] }] },
  };
}
const policy = { schema: 1, mode: 'advisory-rollout', rules: {} };
function evaluate(f) { return assess(f.status, f.coverage, f.report, policy); }

test('a completed passive scan reports the benign fixture without claiming a clean scan', () => {
  const result = evaluate(fixture());
  assert.equal(result.status, 'completed-with-findings');
  assert.equal(result.findings[0].classification, 'benign-fixture');
});

for (const code of [1, 3, 127, null]) {
  test(`scanner exit ${code} cannot masquerade as completed coverage`, () => {
    const f = fixture(); f.status.exit = code;
    assert.throws(() => evaluate(f), /did not complete/);
  });
}

for (const change of [
  f => { f.coverage.passive_remaining = 1; },
  f => { f.coverage.requests = []; },
  f => { f.coverage.requests = f.coverage.requests.filter(row => row.path !== '/api/crops/'); },
  f => { f.coverage.requests[0].status = 503; },
  f => { f.coverage.requests[0].method = 'POST'; },
  f => { f.status.stage = 'startup'; },
  f => { f.report['@version'] = 'weekly'; },
  f => { f.report.site[0]['@host'] = 'example.org'; },
  f => { f.report.site[0].alerts[0].instances[0].uri = 'https://example.org/'; },
  f => { f.report.site[0].alerts[0].instances[0].uri = TARGET; },
  f => { f.report.site[0].alerts = []; },
  f => { f.status.exit = 0; },
  f => { f.status.target = 'https://example.org/'; },
]) {
  test(`invalid or incomplete scan is rejected (${change.toString()})`, () => {
    const f = fixture(); change(f);
    assert.throws(() => evaluate(f));
  });
}

test('a new rule remains visible and explicitly needs triage without blanket warning failure', () => {
  const f = fixture();
  f.report.site[0].alerts.push({ pluginid: '99999', riskcode: '2', instances: [{ uri: TARGET }] });
  const result = evaluate(f);
  assert.equal(result.findings[1].classification, 'needs-triage');
  assert.equal(result.status, 'completed-with-findings');
});

test('an unexpected high-risk rule on the fixture still requires triage', () => {
  const f = fixture();
  f.report.site[0].alerts.push({ pluginid: '99999', riskcode: '3',
    instances: [{ uri: TARGET + '__zap_fixture__/' }] });
  const result = evaluate(f);
  assert.equal(result.findings[0].classification, 'benign-fixture');
  assert.equal(result.findings[1].classification, 'needs-triage');
  assert.equal(result.findings[1].risk, 3);
});

test('unanswered optional crawler records are explicit coverage gaps, never completed responses', () => {
  const f = fixture();
  f.coverage.requests.push({ method: 'GET', path: '/unanswered', status: 0 });
  const result = evaluate(f);
  assert.equal(result.requestCount, 7);
  assert.deepEqual(result.coverageGaps, ['/unanswered']);
  f.coverage.requests[0].status = 0;
  assert.throws(() => evaluate(f), /Required anonymous route/);
});

test('initial annotations do not excuse missing API headers or different comment evidence', () => {
  const f = fixture();
  f.report.site[0].alerts.push(
    { pluginid: '10021', riskcode: '1', instances: [{ uri: TARGET + 'api/crops/' }] },
    { pluginid: '10027', riskcode: '0', instances: [{ uri: TARGET, evidence: 'different comment' }] },
    { pluginid: '10096', riskcode: '1', instances: [{ uri: TARGET + 'assets/test.js', evidence: '1700000000' }] },
  );
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/ci/zap/baseline.json'), 'utf8'));
  const result = assess(f.status, f.coverage, f.report, baseline);
  assert.deepEqual(result.findings.slice(1).map(row => row.classification), ['needs-triage', 'needs-triage', 'needs-triage']);
});

test('the PR workflow has read-only credentials, no target input and always publishes outcomes', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/zap-security.yml'), 'utf8');
  assert.match(workflow, /pull_request:\s+branches: \[main\]/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|inputs:|continue-on-error/);
  assert.match(workflow, /Classify findings and verify completion\s+if: always\(\)/);
  assert.match(workflow, /Upload scan outcomes and reports\s+if: always\(\)/);
});
