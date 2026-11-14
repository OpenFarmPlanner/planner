const fs = require('node:fs');
const path = require('node:path');
const { IMAGE, TARGET, REPORTS } = require('./run.cjs');

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function assess(status, coverage, report, policy) {
  requireValid(status?.image === IMAGE && status?.target === TARGET && status?.stage === 'scan'
    && [0, 2].includes(status.exit), 'Scanner did not complete normally.');
  requireValid(coverage?.target === TARGET && coverage.passive_remaining === 0
    && Array.isArray(coverage.requests) && coverage.requests.length > 0,
  'Passive scanning was incomplete or HTTP coverage is missing.');
  requireValid(coverage.requests.every(row => ['GET', 'HEAD'].includes(row.method)
    && typeof row.path === 'string' && row.path.startsWith('/')
    && Number.isInteger(row.status) && (row.status === 0 || (row.status >= 100 && row.status < 600))),
  'Invalid HTTP coverage.');
  for (const [route, codes] of [
    ['/', [200]], ['/en', [200, 301]], ['/fr', [200, 301]], ['/es', [200, 301]],
    ['/api/schema/', [200]], ['/api/crops/', [401, 403]], ['/__zap_fixture__/', [200]],
  ]) {
    requireValid(coverage.requests.some(row => row.path === route && codes.includes(row.status)),
      `Required anonymous route was not observed: ${route}`);
  }
  for (const [route, language] of [['/', 'de'], ['/en', 'en'], ['/fr', 'fr'], ['/es', 'es']]) {
    requireValid(coverage.public_pages?.[route] === language,
      `Prerendered page content was not observed: ${route}`);
  }
  requireValid(policy?.schema === 1 && policy.mode === 'advisory-rollout'
    && policy.rules && !Array.isArray(policy.rules) && typeof policy.rules === 'object',
  'Unsupported annotation policy.');
  requireValid(report?.['@version'] === '2.17.0' && Array.isArray(report.site) && report.site.length === 1,
    'Missing or unsupported ZAP report.');
  const site = report.site[0];
  requireValid(site['@host'] === '127.0.0.1' && String(site['@port']) === '4173'
    && Array.isArray(site.alerts), 'Report does not describe the isolated target.');
  const findings = [];
  for (const alert of site.alerts) {
    requireValid(/^\d+$/.test(String(alert.pluginid)) && /^[0-3]$/.test(String(alert.riskcode))
      && Array.isArray(alert.instances) && alert.instances.length > 0, 'Malformed ZAP alert.');
    for (const instance of alert.instances) {
      const url = new URL(instance.uri);
      requireValid(url.origin === TARGET.slice(0, -1), 'Alert outside the isolated target.');
      const fixture = url.pathname === '/__zap_fixture__/' && String(alert.pluginid) === '10021';
      const candidate = policy.rules[String(alert.pluginid)];
      const rule = candidate
        && !(candidate.excludePathPrefixes ?? []).some(prefix => url.pathname.startsWith(prefix))
        && (!candidate.evidenceContains || String(instance.evidence ?? '').includes(candidate.evidenceContains))
        && (!candidate.evidenceOneOf || candidate.evidenceOneOf.includes(instance.evidence))
        && (!candidate.pathPrefix || url.pathname.startsWith(candidate.pathPrefix))
        ? candidate : undefined;
      findings.push({
        rule: String(alert.pluginid), risk: Number(alert.riskcode), path: url.pathname,
        classification: fixture ? 'benign-fixture' : rule?.classification ?? 'needs-triage',
        reason: fixture ? 'Intentional synthetic coverage finding.' : rule?.reason ?? 'New rule requires review; rollout findings do not block.',
      });
    }
  }
  requireValid(findings.some(row => row.rule === '10021' && row.classification === 'benign-fixture'),
    'The intentional missing-nosniff fixture was not detected.');
  requireValid(status.exit === (site.alerts.length ? 2 : 0), 'Exit code disagrees with the report.');
  return { status: 'completed-with-findings', target: TARGET, image: IMAGE,
    requestCount: coverage.requests.filter(row => row.status !== 0).length,
    publicPages: coverage.public_pages,
    coverageGaps: coverage.requests.filter(row => row.status === 0).map(row => row.path), findings };
}

function main() {
  fs.mkdirSync(REPORTS, { recursive: true });
  let result;
  try {
    const read = name => JSON.parse(fs.readFileSync(path.join(REPORTS, name), 'utf8'));
    requireValid(fs.statSync(path.join(REPORTS, 'report.html')).size > 100, 'HTML report is missing.');
    result = assess(read('scan-status.json'), read('coverage.json'), read('report.json'),
      JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline.json'), 'utf8')));
  } catch (error) {
    result = { status: 'inconclusive', reason: error.message };
  }
  fs.writeFileSync(path.join(REPORTS, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  const counts = {};
  for (const finding of result.findings ?? []) {
    counts[finding.classification] = (counts[finding.classification] ?? 0) + 1;
  }
  const summary = result.status === 'inconclusive'
    ? 'ZAP passive baseline: INCONCLUSIVE. Review the report artifacts; no clean scan is claimed.'
    : `ZAP passive baseline completed: ${result.requestCount} anonymous responses; ${result.coverageGaps.length} crawler records without responses (see result.json). Findings by instance: ${JSON.stringify(counts)}. Rollout findings are advisory.`;
  fs.writeFileSync(path.join(REPORTS, 'summary.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>ZAP scan outcome</title><h1>${result.status}</h1><p>${summary}</p><p>See result.json and, when available, report.html/report.json. Authenticated and active testing are excluded.</p></html>\n`);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  return result.status === 'inconclusive' ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { assess };
