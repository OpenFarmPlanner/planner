const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Standing trust is installed through review of this base policy, never through a PR report.
const CODEX_SIGNERS = { 'martin-local-2026-11': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA4qTU20eIF+4hSJaVuEAr0rhS4mbniiHd3MZv4JX2ufw=
-----END PUBLIC KEY-----` };
const CODEX_SOURCES = ['scripts/ci/run_codex_review.cjs', 'scripts/ci/local_security_review.py'];

const SHA = /^[0-9a-f]{40}$/;
const sameScope = (left, right) => Array.isArray(left) &&
  JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
const passed = (state, reason, evidence) => ({ state, reason, evidence, allowed: true });
const blocked = (state, reason) => ({ state, reason, allowed: false });

function signedCodexPayload(comment, keys = CODEX_SIGNERS) {
  const match = (comment.body ?? '').match(/^<!-- codex-execution:v1 -->\n```json\n([^\n]+)\n```(?:\n|$)/m);
  if (!match || match[1].length > 60_000) return null;
  try {
    const envelope = JSON.parse(match[1]);
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') return null;
    const bytes = Buffer.from(envelope.payload, 'base64');
    const payload = JSON.parse(bytes.toString('utf8'));
    if (!Object.hasOwn(keys, payload.issuer) || !crypto.verify(null, bytes,
      keys[payload.issuer], Buffer.from(envelope.signature, 'base64'))) return null;
    return payload;
  } catch { return null; }
}

async function verifiedCodexReview({ github, context, comments, head, base, scope,
  now = Date.now(), keys = CODEX_SIGNERS }) {
  const receipts = comments.map(comment => ({ payload: signedCodexPayload(comment, keys), comment }))
    .filter(({ payload: item }) => item?.repository === `${context.repo.owner}/${context.repo.repo}` &&
      item.pull_request === context.payload.pull_request.number && item.head_sha === head)
    .sort((a, b) => String(b.payload.completed_at).localeCompare(String(a.payload.completed_at)));
  if (!receipts.length) return null;
  const { payload: item, comment } = receipts[0];
  const invalid = reason => blocked('codex_evidence_invalid', reason);
  const exactScope = value => Array.isArray(value) && value.every(file => typeof file === 'string') &&
    JSON.stringify([...value].sort()) === JSON.stringify(scope);
  const age = now - Date.parse(item.completed_at);
  if (!Number.isFinite(age) || age < -300_000 || age > 7 * 24 * 60 * 60_000) {
    return invalid('Signed local review evidence is expired or has an invalid timestamp.');
  }
  if (item.schema !== 1 || item.provider !== 'codex-local' || item.base_sha !== base ||
      !exactScope(item.scope) || item.fresh !== true || item.exit_code !== 0 ||
      item.sandbox !== 'restricted-read-only' || !/^[0-9a-f-]{36}$/.test(item.thread_id) ||
      !/^[0-9a-f]{64}$/.test(item.execution_sha256) || !/^[0-9a-f]{64}$/.test(item.prompt_sha256)) {
    return invalid('The signed review does not match the current base, scope or execution contract.');
  }
  for (const filename of CODEX_SOURCES) {
    const { data } = await github.rest.repos.getContent({ ...context.repo, path: filename, ref: base });
    if (data.encoding !== 'base64' || typeof data.content !== 'string') return invalid('Trusted launcher is unavailable.');
    const hash = crypto.createHash('sha256').update(Buffer.from(data.content, 'base64')).digest('hex');
    if (item.sources?.[filename] !== hash) return invalid('The launcher/helper differs from the trusted base.');
  }
  const review = item.review;
  if (item.result !== 'no_issues' || review?.complete !== true || review.reviewed_sha !== head ||
      !exactScope(review.scope) || !Array.isArray(review.findings) || review.findings.length ||
      !Array.isArray(review.limitations) || review.limitations.length ||
      typeof review.analysis !== 'string' || !review.analysis.trim() ||
      !Array.isArray(review.review_notes) || review.review_notes.some(note => typeof note !== 'string')) {
    return blocked('codex_local_incomplete', 'The latest signed independent review is incomplete or has unresolved findings.');
  }
  return passed('codex_local_completed',
    'A trusted launcher verified fresh independent Codex execution, exact scope and a clean result. No per-PR human approval is required.',
    comment.html_url);
}

function evaluate({ head, scope, triage, claude, approval, request, rejection, failed, providerPending }) {
  if (approval) return passed(approval.mode === 'codex' ? 'codex_completed_attested' : 'manual_review_approved',
    'A maintainer explicitly attested the exact-head review; this is not automated verification.', approval.url);
  if (!triage) return blocked(failed ? 'triage_failed' : 'triage_pending', 'No current triage evidence is available.');
  if (triage.head_sha !== head || !sameScope(triage.scope, scope)) {
    return blocked('stale_review', 'Triage belongs to a different head or scope.');
  }
  if (triage.security_required === false) {
    return passed('triage_skipped', 'Security triage intentionally did not require a review; not security reviewed.');
  }
  if (triage.security_required !== true) return blocked('triage_failed', 'The triage decision is invalid.');
  if (claude?.state === 'claude_completed' && claude.provider === 'claude' &&
      ['no_issues', 'issues_fixed'].includes(claude.result) && claude.head_sha === head && sameScope(claude.scope, scope)) {
    return passed('claude_completed', 'The successful Claude execution has validated exact-head completion evidence.', claude.url);
  }
  if (claude?.state === 'claude_completed') return blocked('stale_review', 'The completed review is stale.');
  if (triage.self_push && providerPending) return blocked('review_pending', 'The original reviewer is still checking the final fix commit.');
  if (triage.self_changed || triage.self_push || triage.baseline_push) {
    return blocked('manual_review_required', 'The provider loop/self-change guard skips execution, not required review completion.');
  }
  if (request && rejection) return blocked('codex_rejected', 'The Codex connector rejected the delivered request.');
  if (request) return blocked('codex_pending', 'The request was delivered; no completed security review is verified.');
  if (claude?.state === 'claude_allowance_exhausted') {
    return blocked('claude_allowance_exhausted', 'Claude did not complete; fallback request delivery is pending.');
  }
  if (failed || claude?.state === 'claude_failed') return blocked('claude_failed', 'Claude did not complete a verifiable security review.');
  return blocked('review_pending', 'The required security review is still pending.');
}

function parseApproval(comment, head) {
  if (comment.user?.type !== 'User') return null;
  const body = (comment.body ?? '').replace(/\r\n?/g, '\n');
  const match = body.match(/^\/security-review approve (manual|codex) ([0-9a-f]{40}) (https:\/\/\S+)\n/);
  if (!match || match[2] !== head) return null;
  const statement = match[1] === 'codex'
    ? 'I verified the completed Codex Security Report for this exact commit.'
    : 'I independently reviewed this exact commit and approve its security review.';
  if (!body.split('\n').includes(statement)) return null;
  if (match[1] === 'codex' && !body.split('\n').includes('Result: No unresolved findings')) return null;
  try {
    const url = new URL(match[3]);
    if (url.username || url.password || url.search) return null;
    if (match[1] === 'codex' && (url.hostname !== 'chatgpt.com' ||
        !/^\/codex\/(?:cloud\/)?tasks\/[^/]+\/?$/.test(url.pathname))) return null;
    return { mode: match[1], report: url, url: comment.html_url };
  } catch { return null; }
}

async function approvedReview({ github, coordinates, comments, head, scope }) {
  for (const comment of [...comments].reverse()) {
    const approval = parseApproval(comment, head);
    if (!approval) continue;
    let permission;
    try {
      ({ data: permission } = await github.rest.repos.getCollaboratorPermissionLevel({
        owner: coordinates.owner, repo: coordinates.repo, username: comment.user.login,
      }));
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
    if (!['admin', 'maintain'].includes(permission.permission) && !permission.user?.permissions?.maintain) continue;
    if (approval.mode === 'manual') {
      const prefix = `/${coordinates.owner}/${coordinates.repo}/pull/${coordinates.issue_number}`;
      if (approval.report.hostname !== 'github.com' || approval.report.pathname !== prefix) continue;
      const id = approval.report.hash.match(/^#issuecomment-(\d+)$/)?.[1];
      const report = comments.find(item => String(item.id) === id);
      // The authoring agent's own review is never completion evidence.
      if (!report || report.user?.type !== 'User' || report.created_at > comment.created_at ||
          /authoring.session|self.review|not independent/i.test(report.body ?? '')) continue;
      const marker = `<!-- manual-security-review:${head} -->`;
      if (!(report.body ?? '').includes(marker) || !(report.body ?? '').includes('Result: No unresolved findings')) continue;
      if (!scope.every(file => (report.body ?? '').includes(`\`${file}\``))) continue;
    }
    return approval;
  }
  return null;
}

async function readArtifact({ github, coordinates, run, name, filename }) {
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    owner: coordinates.owner, repo: coordinates.repo, run_id: run.id, per_page: 100,
  });
  const artifact = artifacts.find(item => item.name === name && !item.expired);
  if (!artifact || artifact.size_in_bytes > 1024 * 1024 ||
      artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha) return null;
  const { data } = await github.rest.actions.downloadArtifact({ owner: coordinates.owner,
    repo: coordinates.repo, artifact_id: artifact.id, archive_format: 'zip' });
  // Octokit follows GitHub's signed redirect and returns the archive bytes.
  // Do not fetch response.url without authentication as though it were the ZIP.
  const bytes = Buffer.from(data);
  if (bytes.length > 1024 * 1024) throw new Error('The review evidence artifact is too large.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'security-review-'));
  try {
    const archive = path.join(directory, 'evidence.zip');
    fs.writeFileSync(archive, bytes);
    const report = JSON.parse(execFileSync('unzip', ['-p', archive, filename], { maxBuffer: 1024 * 1024 }).toString());
    if (report.schema !== 1 || report.run_id !== run.id || report.run_attempt !== run.run_attempt) return null;
    return { ...report, url: run.html_url };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function snapshot({ github, context, expectedHead, artifactReader = readArtifact,
  codexVerifier = verifiedCodexReview }) {
  const coordinates = { ...context.repo, issue_number: context.payload.pull_request.number };
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: coordinates.issue_number });
  if (!SHA.test(expectedHead) || pr.head.sha !== expectedHead) {
    return blocked('stale_head', 'A new push invalidated this run; the new head needs its own checks and review.');
  }
  const exemption = pr.draft ? 'draft' : pr.state !== 'open' ? 'closed' :
    pr.head.repo?.full_name !== `${coordinates.owner}/${coordinates.repo}` ? 'fork' :
      pr.user.login === 'dependabot[bot]' ? 'Dependabot' :
        pr.labels.some(label => label.name === 'skip-claude') ? 'explicit skip-claude exemption' : null;
  if (exemption) return passed('triage_skipped', `${exemption}; intentionally exempt, not security reviewed.`);
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...context.repo, pull_number: coordinates.issue_number, per_page: 100,
  });
  if (files.length >= 3000) return blocked('scope_unavailable', 'GitHub truncated the changed-file scope.');
  const scope = [...new Set(files.flatMap(file => file.status === 'renamed'
    ? [file.filename, file.previous_filename] : [file.filename]))].sort();
  const comments = await github.paginate(github.rest.issues.listComments, { ...coordinates, per_page: 100 });
  const approval = await approvedReview({ github, coordinates, comments, head: expectedHead, scope });
  // Approval is explicit, head-bound and recorded separately from provider completion.
  if (approval) return evaluate({ head: expectedHead, scope, approval });
  const codex = await codexVerifier({ github, context, comments, head: expectedHead,
    base: pr.base.sha, scope });
  if (codex) return codex;
  // A PR can change the triage script embedded in this workflow. Preserve
  // the provider's self-change guard without trusting its edited skip output.
  if (scope.includes('.github/workflows/claude-pr.yml')) {
    return blocked('manual_review_required', 'The review workflow changes itself and needs explicit maintainer review.');
  }
  const { data: { workflow_runs: runs } } = await github.rest.actions.listWorkflowRuns({
    ...context.repo, workflow_id: 'claude-pr.yml', event: 'pull_request', branch: pr.head.ref, per_page: 100,
  });
  let triage, claude, failed = false, providerPending = false;
  const jobsByRun = new Map();
  const matchingRun = run => run.head_repository?.full_name === `${coordinates.owner}/${coordinates.repo}` &&
    run.head_branch === pr.head.ref && (!run.pull_requests?.length ||
    run.pull_requests.some(item => item.number === coordinates.issue_number));
  for (const run of runs) {
    if (!matchingRun(run)) continue;
    // GitHub returns an empty pull_requests array for some same-repository
    // runs. The exact branch/head and artifact PR number still bind evidence.
    // Ignore unrelated labels, whose triage job is deliberately skipped. A
    // newer meaningful run must not inherit an older successful decision.
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      ...context.repo, run_id: run.id, filter: 'latest', per_page: 100,
    });
    jobsByRun.set(run.id, jobs);
    const triageJob = jobs.find(job => job.name === 'Triage');
    if (run.head_sha === expectedHead && triageJob?.conclusion !== 'skipped') {
      triage = await artifactReader({ github, coordinates, run, name: 'security-review-triage', filename: 'security-review-triage.json' });
      if (triage && (triage.pull_request !== coordinates.issue_number ||
          triage.security_required === false && pr.labels.some(label => label.name === 'claude-security'))) triage = null;
      const securityJob = jobs.find(job => job.name === 'Claude security review');
      failed = ['failure', 'cancelled', 'timed_out'].includes(securityJob?.conclusion) || triageJob?.conclusion === 'failure';
      const report = await artifactReader({ github, coordinates, run, name: 'security-review-completion', filename: 'security-review-completion.json' });
      if (report && securityJob?.conclusion === 'success') claude = report;
      else if (report) claude = { ...report, state: report.state === 'claude_completed' ? 'claude_failed' : report.state };
      break;
    }
  }
  // A guarded Claude fix push can be covered by the still-running original
  // reviewer, but only if that review finishes on this exact FINAL head/scope.
  // Never carry a pre-fix result forward just because the push is from a bot.
  if (triage?.self_push && !claude && !failed) {
    for (const run of runs.filter(item => matchingRun(item) && item.head_sha !== expectedHead)) {
      const jobs = jobsByRun.get(run.id) ?? await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        ...context.repo, run_id: run.id, filter: 'latest', per_page: 100,
      });
      if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status) ||
          jobs.some(job => job.name === 'Claude security review' && job.status !== 'completed')) providerPending = true;
      if (!jobs.some(job => job.name === 'Claude security review' && job.conclusion === 'success')) continue;
      const original = await artifactReader({ github, coordinates, run, name: 'security-review-triage', filename: 'security-review-triage.json' });
      if (original?.pull_request !== coordinates.issue_number) continue;
      const report = await artifactReader({ github, coordinates, run, name: 'security-review-completion', filename: 'security-review-completion.json' });
      if (report?.head_sha === expectedHead && sameScope(report.scope, scope)) { claude = report; break; }
    }
  }
  const request = comments.filter(comment => (comment.body ?? '').startsWith('@codex security review\n') &&
    (comment.body ?? '').includes(`<!-- codex-security-fallback:${expectedHead} -->`)).at(-1);
  const rejection = request && comments.find(comment => comment.user?.login === 'chatgpt-codex-connector[bot]' &&
    comment.user?.type === 'Bot' && comment.created_at >= request.created_at &&
    /(?:create a Codex account|connect to github|unable to|could not|not authorized|not enabled)/i.test(comment.body ?? ''));
  return evaluate({ head: expectedHead, scope, triage, claude, approval, request, rejection, failed, providerPending });
}

async function enforce({ github, context, core, expectedHead, timeoutMs = 20 * 60_000,
  intervalMs = 30_000, inspect = snapshot, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const deadline = now() + timeoutMs;
  let previous, result;
  do {
    try {
      result = await inspect({ github, context, expectedHead });
    } catch {
      result = blocked('evidence_unavailable', 'Required GitHub evidence could not be read; check API permissions and artifact availability.');
    }
    if (result.state !== previous) core.info(`Security review: ${result.state}. ${result.reason}`);
    previous = result.state;
    if (result.allowed || ['stale_head', 'codex_rejected', 'codex_local_incomplete', 'codex_evidence_invalid', 'manual_review_required', 'claude_failed', 'triage_failed', 'scope_unavailable', 'evidence_unavailable'].includes(result.state)) break;
    if (now() >= deadline) { result = blocked('timed_out', `Timed out while ${result.state}: ${result.reason}`); break; }
    await wait(Math.min(intervalMs, deadline - now()));
  } while (true);
  await core.summary.addHeading('Security review completion').addRaw(
    `State: **${result.state}**\n\nHead: \`${expectedHead}\`\n\n${result.reason}\n\n` +
    (result.evidence ? `Evidence: ${result.evidence}\n` : '') +
    (!result.allowed ? '\nRecovery: publish fresh signed evidence from the trusted local Codex launcher, ' +
      'or obtain explicit maintainer approval of an independent manual report. No Claude allowance is required. ' +
      'See [review recovery](https://github.com/' + context.repo.owner + '/' + context.repo.repo +
      '/blob/main/docs/security-automation.md#recovery-and-explicit-human-contingency). ' +
      'After approval, rerun all failed jobs in this CI run together.\n' : '')).write();
  core.setOutput('security_review_state', result.state);
  if (!result.allowed) core.setFailed(`Security review gate blocked: ${result.state}. ${result.reason}`);
  return result;
}

module.exports = { evaluate, parseApproval, approvedReview, readArtifact, snapshot, enforce,
  signedCodexPayload, verifiedCodexReview, CODEX_SIGNERS, CODEX_SOURCES };
