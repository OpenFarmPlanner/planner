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

// GitHub supplies these immutable numeric identities; display names alone are not provenance.
const NATIVE_CODEX_APP = 1144995;
const NATIVE_CODEX_BOT = 199175422;
const nativeCodexAuthor = comment => comment.user?.type === 'Bot' &&
  comment.user.id === NATIVE_CODEX_BOT && comment.performed_via_github_app?.id === NATIVE_CODEX_APP;

async function nativeEvidenceProvenance({ github, context, checked, history = false, verified = () => {} }) {
  if (checked.length > 100) return 'Too many native records to verify in one snapshot.';
  const prefix = `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${context.payload.pull_request.number}#issuecomment-`;
  for (const comment of checked) {
    if (comment.html_url !== `${prefix}${comment.id}` || !comment.node_id) {
      return 'Native security evidence is not bound to this PR.';
    }
  }
  // Maintainers can edit comments. Verify the actual last editor as well as the creating app,
  // and compare the independently read body/version to avoid trusting a changing snapshot.
  let nodes;
  try {
    ({ nodes } = await github.graphql(`query($ids:[ID!]!) {
    nodes(ids:$ids) { ... on IssueComment {
      id body updatedAt lastEditedAt
      ${history ? 'userContentEdits(first:100) { nodes { diff editedAt deletedAt editor { __typename ... on Bot { databaseId } } } }' : ''}
      author { __typename ... on Bot { databaseId } }
      editor { __typename ... on Bot { databaseId } }
    } }
  }`, { ids: checked.map(item => item.node_id) }));
  } catch {
    return 'Native provenance could not be read from GitHub.';
  }
  const trustedActor = actor => actor?.__typename === 'Bot' && actor.databaseId === NATIVE_CODEX_BOT;
  for (const comment of checked) {
    const node = nodes?.find(item => item?.id === comment.node_id);
    if (!node || node.body !== comment.body || node.updatedAt !== comment.updated_at ||
        !trustedActor(node.author) || !Object.hasOwn(node, 'lastEditedAt') || !Object.hasOwn(node, 'editor') ||
        (node.lastEditedAt != null ? !trustedActor(node.editor) : node.editor != null && !trustedActor(node.editor))) {
      return 'Native evidence changed or was edited outside the trusted Codex app.';
    }
  }
  verified(nodes);
  return null;
}

async function verifiedNativeCodexReview({ github, context, comments, head, now = Date.now() }) {
  const marker = /^<!-- codex-security-review:v1 (\{[^\n]+\}) -->$/m;
  const invalid = reason => blocked('codex_native_invalid', reason);
  const summaries = [];
  for (const comment of comments.filter(item => nativeCodexAuthor(item) && marker.test(item.body ?? ''))) {
    let evidence;
    try { evidence = JSON.parse(comment.body.match(marker)[1]); }
    catch { return invalid('The native security summary is malformed.'); }
    if (evidence.headSha === head) summaries.push({ comment, evidence });
  }
  const pending = item => ['running', 'queued', 'pending'].includes(item.evidence.status);
  summaries.sort((a, b) => Number(pending(b)) - Number(pending(a)) ||
    String(b.comment.updated_at).localeCompare(String(a.comment.updated_at)) || Number(b.comment.id) - Number(a.comment.id));
  if (!summaries.length) return null;
  const summaryProblem = await nativeEvidenceProvenance({ github, context,
    checked: summaries.map(item => item.comment) });
  if (summaryProblem) return invalid(summaryProblem);
  const securityState = comment => {
    const match = comment.body.match(/^<!-- codex-review-state:v1 (\{[^\n]+\}) -->$/m);
    try { return match ? JSON.parse(match[1]).security_review : null; } catch { return null; }
  };
  for (const item of summaries) {
    const state = securityState(item.comment);
    if (state?.commit_sha === head && (state.has_any_findings === true || state.has_unresolved_findings === true)) {
      return blocked('codex_native_incomplete', 'The trusted native summary reports security findings for this head.');
    }
  }
  const { comment: summary, evidence } = summaries[0];
  if (evidence.repository !== `${context.repo.owner}/${context.repo.repo}` ||
      evidence.pullRequestNumber !== context.payload.pull_request.number) {
    return invalid('The latest native security review belongs to another PR or head.');
  }
  if (['running', 'queued', 'pending'].includes(evidence.status)) {
    return blocked('codex_native_pending', 'The native security review is still in progress.');
  }
  if (evidence.status !== 'completed') return invalid('The latest native security review has not completed.');
  const state = securityState(summary);
  if (state?.commit_sha !== head || state.status !== 'completed') {
    return invalid('The native security result summary is missing or inconsistent.');
  }

  const receipts = comments.filter(comment => nativeCodexAuthor(comment) &&
    /^### 🛡️ Codex Security Review$/m.test(comment.body ?? '') &&
    comment.body.startsWith('<!-- codex-review-receipt:v1 -->\n'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  // A summary does not carry a task ID. Never infer a clean outcome by pairing
  // two independent "latest" records: every observed receipt for this head must
  // be clean, regardless of overlapping tasks or their completion order.
  const relevant = receipts.filter(item => {
    const ref = item.body.match(/^\*\*Reviewed commit:\*\* `([0-9a-f]{10,40})`$/m)?.[1];
    return ref && head.startsWith(ref);
  });
  const receipt = relevant[0];
  if (!receipt) return invalid('No native security result receipt for the current head is available.');
  const checked = [summary, ...relevant];
  if (checked.length > 100) return invalid('Too many native receipts to verify in one consistent snapshot.');

  let verifiedNodes;
  const problem = await nativeEvidenceProvenance({ github, context, checked, history: true,
    verified: nodes => { verifiedNodes = nodes; } });
  if (problem) return invalid(problem);
  const finished = Date.parse(summary.updated_at), issued = Date.parse(receipt.created_at);
  if (!Number.isFinite(finished) || !Number.isFinite(issued) || Math.abs(finished - issued) > 300_000 ||
      now - finished < -300_000 || now - finished > 7 * 24 * 60 * 60_000) {
    return invalid('The native receipt is stale or does not match the latest review completion.');
  }
  const starts = [];
  for (const edit of verifiedNodes?.find(node => node.id === summary.node_id)?.userContentEdits?.nodes ?? []) {
    if (edit.deletedAt !== null || edit.editor?.__typename !== 'Bot' || edit.editor.databaseId !== NATIVE_CODEX_BOT ||
        typeof edit.diff !== 'string') continue;
    let previous;
    try { previous = JSON.parse(edit.diff.match(marker)?.[1]); } catch { continue; }
    const previousState = securityState({ body: edit.diff });
    if (previous?.repository !== evidence.repository || previous.pullRequestNumber !== evidence.pullRequestNumber ||
        previous.headSha !== head || previous.status !== 'running' ||
        previousState?.commit_sha !== head || previousState.status !== 'running') continue;
    const row = edit.diff.match(/^\| 🔒 \*\*Security Review\*\* \| 🔄 \*\*Running\*\* since <relative-time datetime="([^"]+)">[^<]+<\/relative-time> \| `([0-9a-f]{7,40})` \|/m);
    const start = Date.parse(row?.[1]), edited = Date.parse(edit.editedAt);
    if (row && head.startsWith(row[2]) && Number.isFinite(start) && Number.isFinite(edited) &&
        start <= edited && edited - start <= 300_000 && edited <= issued) starts.push(start);
  }
  if (!starts.length) return invalid('The native task start could not be verified from app-authored comment history.');
  const started = Math.max(...starts);
  for (const candidate of relevant) {
    const sha = candidate.body.match(/^\*\*Reviewed commit:\*\* `([0-9a-f]{10,40})`$/m)?.[1];
    const task = candidate.body.match(/^\[View security finding report\]\((https:\/\/chatgpt\.com\/codex\/(?:cloud\/)?tasks\/[a-zA-Z0-9_-]+)\)$/m)?.[1];
    if (!sha || !head.startsWith(sha) || !task) {
      return invalid('The native security receipt does not establish a clean review for this head.');
    }
    // Resolve the provider's abbreviation through GitHub's commit object API. A prefix
    // collision must fail closed; startsWith alone would bind only 40 bits of the SHA.
    if (sha.length < 40) {
      // The commit endpoint also accepts named refs. Do not let a hex-named branch/tag
      // shadow an ambiguous object abbreviation (including Git's other DWIM namespaces).
      const refs = [sha, `tags/${sha}`, `heads/${sha}`, `remotes/${sha}`, `remotes/${sha}/HEAD`];
      try {
        const named = await Promise.all(refs.map(async ref => {
          try { await github.rest.git.getRef({ ...context.repo, ref }); return true; }
          catch (error) { if (error.status === 404) return false; throw error; }
        }));
        if (named.some(Boolean)) return invalid('The abbreviated reviewed SHA is shadowed by a named Git reference.');
      } catch {
        return invalid('Named-reference ambiguity could not be checked.');
      }
    }
    let reviewed;
    try {
      ({ data: reviewed } = await github.rest.repos.getCommit({ ...context.repo, ref: sha }));
    } catch {
      return invalid('The reviewed commit is missing, ambiguous or could not be resolved.');
    }
    if (reviewed.sha !== head) return invalid('The reviewed commit does not resolve to the full current head.');
    if (!candidate.body.split('\n').includes('Security review completed. No security issues were found in this pull request.')) {
      return candidate.body.split('\n').some(line => line.startsWith('Security review completed. '))
        ? blocked('codex_native_incomplete', 'The completed native review does not report a clean result.')
        : invalid('The native security receipt format is unsupported.');
    }
  }
  if (!relevant.includes(receipt)) return invalid('The latest receipt is not bound to the current head.');
  return { ...passed('codex_native_completed',
    'The trusted Codex GitHub app reports a completed, clean security review for this exact PR/head. No human attestation is required.',
    receipt.html_url), receipt_created_at: receipt.created_at, review_started_at: new Date(started).toISOString() };
}

const NATIVE_CONTEXT_WORKFLOW = '.github/workflows/native-security-context.yml';

async function verifiedNativeContext({ github, context, head, base, scope, reviewStartTime, artifactReader = readArtifact }) {
  const invalid = reason => blocked('codex_native_context_invalid', reason);
  const unavailable = reason => blocked('codex_native_context_unavailable', reason);
  if (!SHA.test(base ?? '') || !Array.isArray(scope)) return invalid('Native review context is incomplete.');
  let repository;
  try {
    ({ repository } = await github.graphql(`query NativeContext($owner:String!,$repo:String!,$number:Int!) {
      repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
        baseRefName baseRefOid headRefOid
        timelineItems(first:100,itemTypes:[BASE_REF_CHANGED_EVENT,BASE_REF_FORCE_PUSHED_EVENT]) {
          nodes { __typename } pageInfo { hasNextPage }
        }
      } }
    }`, { owner: context.repo.owner, repo: context.repo.repo, number: context.payload.pull_request.number }));
  } catch { return unavailable('The native review base history could not be verified.'); }
  const pr = repository?.pullRequest;
  if (pr?.baseRefName !== 'main' || pr.baseRefOid !== base || pr.headRefOid !== head ||
      !Array.isArray(pr.timelineItems?.nodes) || pr.timelineItems.nodes.length !== 0 ||
      pr.timelineItems?.pageInfo?.hasNextPage !== false) {
    return invalid('Native completion requires an unchanged main target and no retarget/force-push history.');
  }
  const name = `native-review-context-${context.payload.pull_request.number}-${head}`;
  let artifacts;
  try { artifacts = await github.paginate('GET /repos/{owner}/{repo}/actions/artifacts', { ...context.repo, name, per_page: 100 }); }
  catch { return unavailable('Trusted native review context artifacts could not be read.'); }
  let earliest = Infinity, count = 0;
  for (const artifact of artifacts) {
    if (artifact.name !== name || artifact.expired || !artifact.workflow_run?.id) continue;
    let run;
    try { ({ data: run } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: artifact.workflow_run.id })); }
    catch { return unavailable('The context producer run could not be verified.'); }
    if (run.path !== NATIVE_CONTEXT_WORKFLOW || run.event !== 'pull_request_target' ||
        run.head_repository?.full_name !== `${context.repo.owner}/${context.repo.repo}`) continue;
    if (run.head_sha !== base) continue; // A prior main base cannot certify the current scope.
    let report;
    try { report = await artifactReader({ github, coordinates: context.repo, run, name, filename: 'native-review-context.json' }); }
    catch { return unavailable('The trusted context record could not be read.'); }
    if (!report && ['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status)) {
      return blocked('codex_native_context_pending', 'The trusted context producer is still publishing its current attempt.');
    }
    if (!report || report.pull_request !== context.payload.pull_request.number || report.head_sha !== head ||
        report.base_sha !== base || report.base_ref !== 'main' || report.workflow_sha !== run.head_sha ||
        run.head_sha !== base || !sameScope(report.scope, scope)) {
      return invalid('The native review context belongs to another base or changed-file scope.');
    }
    const created = Date.parse(artifact.created_at);
    if (!Number.isFinite(created)) return invalid('The native context timestamp is unavailable.');
    earliest = Math.min(earliest, created); count++;
  }
  if (!count) return blocked('codex_native_context_pending', 'Waiting for the trusted base/scope context producer.');
  if (!Number.isFinite(Date.parse(reviewStartTime)) || earliest > Date.parse(reviewStartTime)) {
    return invalid('The native task started before its trusted review context.');
  }
  return null;
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
    return { mode: match[1], report: url, url: comment.html_url,
      base_sha: body.match(/^Reviewed base: ([0-9a-f]{40})$/m)?.[1] ?? null };
  } catch { return null; }
}

async function approvedReview({ github, coordinates, comments, head, scope, base }) {
  for (const comment of [...comments].reverse()) {
    const approval = parseApproval(comment, head);
    if (!approval || !SHA.test(base ?? '') || approval.base_sha !== base) continue;
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
      if (!(report.body ?? '').split('\n').includes(`Reviewed base: ${base}`)) continue;
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
  const eventBase = context.payload.pull_request.base?.sha;
  if (eventBase && pr.base.sha !== eventBase) return blocked('stale_base', 'The PR base changed; its new context needs fresh checks.');
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
  let native = await verifiedNativeCodexReview({ github, context, comments, head: expectedHead });
  if (native?.allowed) {
    const contextResult = await verifiedNativeContext({ github, context, head: expectedHead,
      base: pr.base.sha, scope, reviewStartTime: native.review_started_at, artifactReader });
    if (contextResult) native = contextResult;
  }
  let codex;
  try {
    codex = await codexVerifier({ github, context, comments, head: expectedHead,
      base: pr.base.sha, scope });
  } catch {
    codex = blocked('codex_evidence_invalid', 'Signed provider evidence could not be verified.');
  }
  // Known incomplete/finding results remain blocked. Invalid/unavailable provider
  // evidence can still use an explicitly verified independent human contingency.
  if (codex?.state === 'codex_local_incomplete') return codex;
  if (native?.state === 'codex_native_incomplete') return native;
  if (native?.state === 'codex_native_context_invalid') return codex?.allowed ? codex : native;
  if (['codex_native_context_pending', 'codex_native_context_unavailable'].includes(native?.state)) {
    if (codex?.allowed) return codex;
    const contingency = await approvedReview({ github, coordinates, comments, head: expectedHead,
      scope, base: pr.base.sha });
    return contingency ? evaluate({ head: expectedHead, scope, approval: contingency }) : native;
  }
  if (native?.allowed) return native;
  if (native?.state === 'codex_native_pending') return native;
  const approval = await approvedReview({ github, coordinates, comments, head: expectedHead,
    scope, base: pr.base.sha });
  if (approval) return evaluate({ head: expectedHead, scope, approval });
  if (codex?.allowed) return codex;
  if (native) return native;
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
    if (result.allowed || ['stale_head', 'codex_rejected', 'codex_local_incomplete', 'codex_evidence_invalid', 'manual_review_required', 'claude_failed', 'triage_failed', 'scope_unavailable', 'evidence_unavailable', 'codex_native_incomplete', 'codex_native_invalid', 'codex_native_context_invalid', 'codex_native_context_unavailable', 'stale_base'].includes(result.state)) break;
    if (now() >= deadline) { result = blocked('timed_out', `Timed out while ${result.state}: ${result.reason}`); break; }
    await wait(Math.min(intervalMs, deadline - now()));
  } while (true);
  await core.summary.addHeading('Security review completion').addRaw(
    `State: **${result.state}**\n\nHead: \`${expectedHead}\`\n\n${result.reason}\n\n` +
    (result.evidence ? `Evidence: ${result.evidence}\n` : '') +
    (!result.allowed ? '\nRecovery: obtain verified native completion with its trusted current context, publish fresh signed evidence from the trusted local Codex launcher, ' +
      'or use the optional base-bound independent human contingency when provider evidence is unavailable. Verified native and signed-local completion need no human confirmation. ' +
      'See [review recovery](https://github.com/' + context.repo.owner + '/' + context.repo.repo +
      '/blob/main/docs/security-automation.md#recovery-and-explicit-human-contingency). ' +
      'After completion or optional approval, rerun all failed jobs in this CI run together.\n' : '')).write();
  core.setOutput('security_review_state', result.state);
  if (!result.allowed) core.setFailed(`Security review gate blocked: ${result.state}. ${result.reason}`);
  return result;
}

module.exports = { evaluate, parseApproval, approvedReview, readArtifact, snapshot, enforce,
  signedCodexPayload, verifiedCodexReview, verifiedNativeCodexReview, verifiedNativeContext, CODEX_SIGNERS, CODEX_SOURCES };
