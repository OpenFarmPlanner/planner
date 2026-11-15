const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { evaluate, parseApproval, approvedReview, readArtifact, snapshot, enforce, verifiedNativeCodexReview, verifiedNativeContext } =
  require('../.github/scripts/security-review-completion.cjs');

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const SCOPE = ['backend/farm/views/crops.py'];
const triage = { head_sha: HEAD, scope: SCOPE, security_required: true };
const completed = { state: 'claude_completed', provider: 'claude', result: 'no_issues', head_sha: HEAD, scope: SCOPE, url: 'run' };
const input = changes => ({ head: HEAD, scope: SCOPE, triage, ...changes });

test('only verified completion or an explicit exemption/approval can allow the gate', () => {
  assert.equal(evaluate(input({ claude: completed })).state, 'claude_completed');
  assert.equal(evaluate(input({ claude: completed })).allowed, true);
  const skipped = evaluate(input({ triage: { ...triage, security_required: false } }));
  assert.equal(skipped.state, 'triage_skipped');
  assert.match(skipped.reason, /not security reviewed/);
  for (const [state, changes] of [
    ['triage_pending', { triage: null }],
    ['review_pending', {}],
    ['claude_allowance_exhausted', { claude: { state: 'claude_allowance_exhausted' } }],
    ['claude_failed', { failed: true }],
    ['codex_pending', { request: {} }],
    ['codex_rejected', { request: {}, rejection: {} }],
    ['manual_review_required', { triage: { ...triage, self_changed: true } }],
    ['manual_review_required', { triage: { ...triage, self_push: true } }],
    ['stale_review', { claude: { ...completed, head_sha: OLD } }],
    ['stale_review', { claude: { ...completed, scope: [] } }],
    ['stale_review', { triage: { ...triage, head_sha: OLD, security_required: false } }],
  ]) {
    const result = evaluate(input(changes));
    assert.equal(result.state, state);
    assert.equal(result.allowed, false, state);
  }
});

function approvalComment(mode = 'manual', sha = HEAD, overrides = {}) {
  const statement = mode === 'manual'
    ? 'I independently reviewed this exact commit and approve its security review.'
    : 'I verified the completed Codex Security Report for this exact commit.';
  const report = mode === 'manual' ? 'https://github.com/owner/repo/pull/1#issuecomment-10'
    : 'https://chatgpt.com/codex/tasks/task_review';
  return { id: 11, user: { login: 'maintainer', type: 'User' }, created_at: '2026-11-12T10:01:00Z',
    html_url: 'https://github.com/owner/repo/pull/1#issuecomment-11',
    body: `/security-review approve ${mode} ${sha} ${report}\n${statement}\nResult: No unresolved findings\nReviewed base: ${OLD}\nReason: provider unavailable`, ...overrides };
}
const reportComment = { id: 10, user: { login: 'reviewer', type: 'User' },
  created_at: '2026-11-12T10:00:00Z', body: `<!-- manual-security-review:${HEAD} -->\nScope: \`${SCOPE[0]}\`\nReviewed base: ${OLD}\nResult: No unresolved findings` };

test('approval requires a human, an exact SHA, explicit statement and a supported report URL', () => {
  assert.ok(parseApproval(approvalComment(), HEAD));
  assert.ok(parseApproval(approvalComment('codex'), HEAD));
  assert.ok(parseApproval({ ...approvalComment(), body: approvalComment().body.replaceAll('\n', '\r\n') }, HEAD));
  assert.equal(parseApproval(approvalComment('manual', OLD), HEAD), null);
  assert.equal(parseApproval(approvalComment('codex', HEAD, { user: { type: 'Bot' } }), HEAD), null);
  assert.equal(parseApproval(approvalComment('codex', HEAD, { body: approvalComment('codex').body.replace('chatgpt.com', 'evil.test') }), HEAD), null);
  assert.equal(parseApproval({ ...approvalComment(), body: '/security-review approve manual ' + HEAD + ' https://github.com\nLGTM' }, HEAD), null);
  assert.equal(parseApproval({ ...approvalComment('codex'), body: approvalComment('codex').body.replace('Result: No unresolved findings', '') }, HEAD), null);
});

test('manual contingency is authorized, scoped, linked, and rejects authoring-session self-review', async () => {
  const github = { rest: { repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'admin' } }) } } };
  const args = { github, coordinates: { owner: 'owner', repo: 'repo', issue_number: 1 },
    head: HEAD, base: OLD, scope: SCOPE, comments: [reportComment, approvalComment()] };
  assert.equal((await approvedReview(args)).mode, 'manual');
  for (const body of [reportComment.body + '\nAuthoring-session review',
    reportComment.body.replace(SCOPE[0], 'another-file'), reportComment.body.replace(HEAD, OLD)]) {
    assert.equal(await approvedReview({ ...args, comments: [{ ...reportComment, body }, approvalComment()] }), null);
  }
  github.rest.repos.getCollaboratorPermissionLevel = async () => ({ data: { permission: 'read' } });
  assert.equal(await approvedReview(args), null);
});

test('Codex task attestation remains distinct from automatic completion and manual code review', async () => {
  const github = { rest: { repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'maintain' } }) } } };
  const approval = await approvedReview({ github, coordinates: {}, comments: [approvalComment('codex')], head: HEAD, base: OLD, scope: SCOPE });
  const result = evaluate(input({ approval }));
  assert.equal(result.state, 'codex_completed_attested');
  assert.match(result.reason, /not automated verification/);
});

test('every contingency route binds the current base even without verifiable native evidence', async () => {
  for (const native of [false, true]) {
    for (const mode of ['manual', 'codex']) {
      const f = native ? nativeSnapshotFixture() : fixture();
      f.args.expectedHead = HEAD;
      if (native) f.receipt.body = f.receipt.body.replace('chatgpt.com', 'unsupported.example');
      else f.args.github.rest.repos = { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'maintain' } }) };
      f.args.codexVerifier = async () => ({ allowed: false, state: 'codex_evidence_invalid' });
      const approval = approvalComment(mode);
      f.comments.push(reportComment, approval);
      assert.equal((await snapshot(f.args)).allowed, true);
      approval.body = approval.body.replace(`Reviewed base: ${OLD}\n`, '');
      assert.equal((await snapshot(f.args)).allowed, false, `${native}/${mode}: head-only approval`);
      approval.body = approvalComment(mode).body;
      f.args.github.rest.pulls.get = async () => ({ data: { state: 'open', base: { sha: HEAD },
        labels: [], user: { login: 'author' }, head: { sha: HEAD, repo: { full_name: 'owner/repo' } } } });
      assert.equal((await snapshot(f.args)).allowed, false, `${native}/${mode}: old-base approval`);
    }
  }
});

function fixture(changes = {}) {
  const pr = { number: 1, state: 'open', draft: false, base: { sha: OLD }, user: { login: 'author' }, labels: [],
    head: { sha: HEAD, ref: 'fix/test', repo: { full_name: 'owner/repo' } }, ...changes };
  const jobs = [{ name: 'Triage', conclusion: 'success' }, { name: 'Claude security review', conclusion: 'success' }];
  const comments = [];
  const run = { id: 99, run_attempt: 1, head_sha: HEAD, head_branch: 'fix/test', head_repository: { full_name: 'owner/repo' }, pull_requests: [{ number: 1 }] };
  const methods = { files() {}, comments() {}, jobs() {} };
  const github = { rest: {
    pulls: { get: async () => ({ data: pr }), listFiles: methods.files },
    issues: { listComments: methods.comments },
    actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: [run] } }), listJobsForWorkflowRun: methods.jobs },
  }, paginate: async method => method === methods.files ? SCOPE.map(filename => ({ filename, status: 'modified' }))
    : method === methods.comments ? comments : jobs };
  const artifacts = { 'security-review-triage': { ...triage, pull_request: 1 }, 'security-review-completion': completed };
  return { pr, jobs, comments, run, artifacts, args: { github,
    context: { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { number: 1 } } },
    expectedHead: HEAD, artifactReader: async ({ name }) => artifacts[name] ?? null } };
}

test('snapshot requires completed provider job and evidence for current head/scope', async () => {
  const f = fixture();
  assert.equal((await snapshot(f.args)).state, 'claude_completed');
  f.jobs[1].conclusion = 'failure';
  assert.equal((await snapshot(f.args)).allowed, false);
  f.jobs[1].conclusion = 'success';
  f.artifacts['security-review-completion'] = { ...completed, head_sha: OLD };
  assert.equal((await snapshot(f.args)).state, 'stale_review');
  f.pr.head.sha = OLD;
  assert.equal((await snapshot(f.args)).state, 'stale_head');
});

test('authenticated local execution is accepted without a manual approval or available cloud provider', async () => {
  const f = fixture();
  f.jobs[1].conclusion = 'failure';
  f.artifacts['security-review-completion'] = { state: 'claude_allowance_exhausted' };
  f.args.codexVerifier = async input => {
    assert.equal(input.head, HEAD);
    assert.equal(input.base, OLD);
    assert.deepEqual(input.scope, SCOPE);
    return { state: 'codex_local_completed', allowed: true, evidence: 'signed report' };
  };
  assert.equal((await snapshot(f.args)).allowed, true);
  f.args.codexVerifier = async () => ({ state: 'codex_local_incomplete', allowed: false });
  assert.equal((await snapshot(f.args)).allowed, false);
});

test('real GitHub empty pull_requests metadata is supported without accepting another PR artifact', async () => {
  const f = fixture();
  f.run.pull_requests = [];
  assert.equal((await snapshot(f.args)).state, 'claude_completed');
  f.run.head_branch = 'another-branch';
  assert.equal((await snapshot(f.args)).allowed, false);
});

test('own-fix pushes require genuine review of the final head, without starting a review loop', async () => {
  const f = fixture();
  f.artifacts['security-review-triage'] = { ...triage, pull_request: 1, self_push: true };
  delete f.artifacts['security-review-completion'];
  f.jobs[1].conclusion = 'skipped';
  const original = { ...f.run, id: 98, head_sha: OLD };
  f.args.github.rest.actions.listWorkflowRuns = async () => ({ data: { workflow_runs: [f.run, original] } });
  const previous = f.args.github.paginate;
  f.args.github.paginate = async (method, args) => method === f.args.github.rest.actions.listJobsForWorkflowRun && args.run_id === 98
    ? [{ name: 'Claude security review', conclusion: 'success' }] : previous(method, args);
  let finalReport = { ...completed, head_sha: OLD };
  const reader = f.args.artifactReader;
  f.args.artifactReader = async args => args.run.id === 98
    ? args.name === 'security-review-triage' ? { pull_request: 1 } : finalReport : reader(args);
  assert.equal((await snapshot(f.args)).allowed, false);
  finalReport = completed;
  assert.equal((await snapshot(f.args)).state, 'claude_completed');
  f.args.github.paginate = async (method, args) => method === f.args.github.rest.actions.listJobsForWorkflowRun && args.run_id === 98
    ? [{ name: 'Claude security review', status: 'in_progress', conclusion: null }] : previous(method, args);
  assert.equal((await snapshot(f.args)).state, 'review_pending');
});

test('delivered request, bot rejection, silence and a reaction are never clean completion', async () => {
  const f = fixture();
  f.jobs[1].conclusion = 'failure';
  f.artifacts['security-review-completion'] = { state: 'claude_allowance_exhausted' };
  f.comments.push({ created_at: '2026-11-12T10:00:00Z', body: `@codex security review\n<!-- codex-security-fallback:${HEAD} -->`, reactions: { eyes: 1 } });
  assert.equal((await snapshot(f.args)).state, 'codex_pending');
  f.comments.push({ created_at: '2026-11-12T10:00:03Z', user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' },
    body: 'To use Codex here, create a Codex account and connect to github.' });
  assert.equal((await snapshot(f.args)).state, 'codex_rejected');
});

test('draft, fork, Dependabot and explicit skip exemptions are not security reviewed', async () => {
  for (const changes of [{ draft: true }, { user: { login: 'dependabot[bot]' } },
    { labels: [{ name: 'skip-claude' }] }, { head: { sha: HEAD, repo: { full_name: 'fork/repo' } } }]) {
    const result = await snapshot(fixture(changes).args);
    assert.equal(result.state, 'triage_skipped');
    assert.match(result.reason, /not security reviewed/);
  }
});

test('reruns/new pushes cannot inherit older triage or review evidence', async () => {
  const f = fixture();
  f.run.head_sha = OLD;
  assert.equal((await snapshot(f.args)).allowed, false);
  f.run.head_sha = HEAD;
  f.artifacts['security-review-triage'] = { ...triage, pull_request: 2 };
  assert.equal((await snapshot(f.args)).allowed, false);
  f.artifacts['security-review-triage'] = { ...triage, pull_request: 1, security_required: false };
  f.pr.labels = [{ name: 'claude-security' }];
  assert.equal((await snapshot(f.args)).allowed, false);
});

test('artifact evidence is bound to its trusted workflow run and current attempt', async () => {
  const run = { id: 99, run_attempt: 2, head_sha: HEAD };
  const artifact = { id: 10, name: 'security-review-completion', expired: false, size_in_bytes: 1000,
    workflow_run: { id: 99, head_sha: HEAD } };
  let report = { schema: 1, run_id: 99, run_attempt: 2, ...completed };
  const github = { rest: { actions: { listWorkflowRunArtifacts() {}, downloadArtifact: async () => ({ data: execFileSync('python3', ['-c',
    'import io,json,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("security-review-completion.json",sys.argv[1]); z.close(); sys.stdout.buffer.write(b.getvalue())',
    JSON.stringify(report)]) }) } }, paginate: async () => [artifact] };
  const args = { github, coordinates: { owner: 'owner', repo: 'repo' }, run,
    name: 'security-review-completion', filename: 'security-review-completion.json' };
  assert.equal((await readArtifact(args)).state, 'claude_completed');
  report = { ...report, run_attempt: 1 };
  assert.equal(await readArtifact(args), null);
  report = { ...report, run_attempt: 2, run_id: 100 };
  assert.equal(await readArtifact(args), null);
  artifact.workflow_run.head_sha = OLD;
  assert.equal(await readArtifact(args), null);
  artifact.workflow_run.head_sha = HEAD;
  artifact.expired = true;
  assert.equal(await readArtifact(args), null);
});

test('self-changing review workflow cannot turn its own edited triage into an exemption', async () => {
  const f = fixture();
  f.args.github.rest.pulls.listFiles = () => {};
  const previous = f.args.github.paginate;
  f.args.github.paginate = async (method, args) => method === f.args.github.rest.pulls.listFiles
    ? [{ filename: '.github/workflows/claude-pr.yml', status: 'modified' }] : previous(method, args);
  f.artifacts['security-review-triage'] = { ...triage, scope: ['.github/workflows/claude-pr.yml'], security_required: false, pull_request: 1 };
  assert.equal((await snapshot(f.args)).state, 'manual_review_required');
});

test('bounded polling reports timeout, permits an evidenced retry, and stops on rejection', async () => {
  let time = 0;
  const output = [], summary = { addHeading() { return this; }, addRaw(value) { output.push(value); return this; }, async write() {} };
  const core = { info() {}, summary, setOutput() {}, setFailed(value) { output.push(value); } };
  const args = { github: {}, context: { repo: { owner: 'owner', repo: 'repo' } }, core, expectedHead: HEAD, timeoutMs: 100, intervalMs: 50,
    now: () => time, wait: async ms => { time += ms; } };
  assert.equal((await enforce({ ...args, inspect: async () => evaluate(input({ request: {} })) })).state, 'timed_out');
  assert.ok(output.some(line => /blocked: timed_out/.test(line)));
  assert.ok(output.some(line => /trusted local Codex launcher/.test(line)));
  assert.equal((await enforce({ ...args, inspect: async () => evaluate(input({ claude: completed })) })).allowed, true);
  time = 0;
  assert.equal((await enforce({ ...args, inspect: async () => evaluate(input({ request: {}, rejection: {} })) })).state, 'codex_rejected');
  assert.equal(time, 0);
  assert.equal((await enforce({ ...args, inspect: async () => { throw new Error('API unavailable'); } })).state, 'evidence_unavailable');
});

test('required quality job loads immutable base policy and bootstrap needs explicit human approval', async () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const quality = workflow.slice(workflow.indexOf('  quality:'));
  assert.match(quality, /persist-credentials: false/);
  assert.match(quality, /needs: security-review-completion/);
  assert.match(quality, /if: always\(\)/);
  assert.match(quality, /needs\.security-review-completion\.result != 'success'/);
  assert.doesNotMatch(quality, /actions: read|pull-requests: read/);
  const start = workflow.indexOf('      - name: Evaluate security review completion');
  const end = workflow.indexOf('  quality:', start);
  const script = workflow.slice(start, end).split('          script: |\n')[1]
    .split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
  const runScript = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', 'require', script);
  const { args, comments } = fixture();
  args.context.payload.pull_request = { number: 1, head: { sha: HEAD }, base: { sha: OLD } };
  args.github.rest.repos = {
    getContent: async ({ ref }) => { assert.equal(ref, OLD); throw Object.assign(new Error('missing'), { status: 404 }); },
    getCollaboratorPermissionLevel: async () => ({ data: { permission: 'admin' } }),
  };
  const summary = { addHeading() { return this; }, addRaw() { return this; }, async write() {} };
  await assert.rejects(runScript(args.github, args.context, { summary }, require), /explicit human maintainer review/);
  comments.push({ user: { type: 'User', login: 'owner' }, body: `/security-review bootstrap ${HEAD}\nI independently reviewed this exact commit and approve installing the security review gate.`, html_url: 'approval' });
  await runScript(args.github, args.context, { summary }, require);
  comments[0].body = comments[0].body.replace(HEAD, OLD);
  await assert.rejects(runScript(args.github, args.context, { summary }, require), /explicit human maintainer review/);
});

const NATIVE_NOW = Date.parse('2026-11-15T07:26:00Z');
function nativeFixture() {
  const base = { user: { id: 199175422, type: 'Bot' }, performed_via_github_app: { id: 1144995 },
    created_at: '2026-11-15T07:25:17Z', updated_at: '2026-11-15T07:25:21Z' };
  const evidence = { repository: 'owner/repo', pullRequestNumber: 1, headSha: HEAD, status: 'completed' };
  const summary = { ...structuredClone(base), id: 1, node_id: 'summary', html_url: 'https://github.com/owner/repo/pull/1#issuecomment-1',
    body: `<!-- codex-security-review:v1 ${JSON.stringify(evidence)} -->\n<!-- codex-review-state:v1 ${JSON.stringify({ security_review: { commit_sha: HEAD, status: 'completed', has_any_findings: null, has_unresolved_findings: null } })} -->` };
  summary.created_at = '2026-11-15T07:25:01Z';
  summary.history = [{ diff: summary.body.replaceAll('completed', 'running') +
    `\n| 🔒 **Security Review** | 🔄 **Running** since <relative-time datetime="2026-11-15T07:25:00Z">2026-11-15T07:25:00Z</relative-time> | \`${HEAD.slice(0, 7)}\` | Manual request |`,
    editedAt: '2026-11-15T07:25:01Z', deletedAt: null, editor: { __typename: 'Bot', databaseId: 199175422 } }];
  const receipt = { ...structuredClone(base), id: 2, node_id: 'receipt', html_url: 'https://github.com/owner/repo/pull/1#issuecomment-2',
    body: `<!-- codex-review-receipt:v1 -->\n\n### 🛡️ Codex Security Review\n\nSecurity review completed. No security issues were found in this pull request.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\`\n\n[View security finding report](https://chatgpt.com/codex/cloud/tasks/task_review)` };
  const comments = [summary, receipt];
  const graphql = async query => query.includes('query NativeContext(')
    ? { repository: { pullRequest: { baseRefName: 'main', baseRefOid: OLD, headRefOid: HEAD, baseRef: { target: { oid: OLD } },
      timelineItems: { totalCount: 40, nodes: [], pageInfo: { hasNextPage: false } } } } }
    : { nodes: comments.map(comment => ({ id: comment.node_id,
      body: comment.body, updatedAt: comment.updated_at, lastEditedAt: null, editor: null,
      userContentEdits: { nodes: comment.history ?? [], pageInfo: { hasNextPage: false, endCursor: null } },
      author: { __typename: 'Bot', databaseId: 199175422 } })) };
  return { evidence, summary, receipt, comments, args: { head: HEAD, now: NATIVE_NOW, comments,
    context: { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { number: 1 } } },
    github: { graphql, rest: { git: { getRef: async () => { throw Object.assign(new Error('Not found'), { status: 404 }); } }, repos: { getCommit: async ({ ref }) => {
      if (![HEAD, HEAD.slice(0, 10)].includes(ref)) throw new Error('Unknown commit');
      return { data: { sha: HEAD } };
    } } } } } };
}

test('genuine current-head native clean completion needs no human comment or signing key', async () => {
  const f = nativeFixture();
  const result = await verifiedNativeCodexReview(f.args);
  assert.equal(result.state, 'codex_native_completed');
  assert.equal(result.allowed, true);
  assert.equal(result.evidence, f.receipt.html_url);
});

test('ordinary code review, human copies, and lookalike bot names are not native evidence', async () => {
  for (const mutate of [
    f => { f.summary.body = 'Code review completed. No issues.'; },
    f => { f.summary.user = { id: 199175422, type: 'User' }; },
    f => { f.summary.user.id = 123; },
    f => { f.summary.performed_via_github_app.id = 123; },
    f => { delete f.summary.performed_via_github_app; },
    f => { f.summary.body = f.summary.body.replace(HEAD, 'b'.repeat(40)); },
  ]) {
    const f = nativeFixture(); mutate(f);
    assert.equal(await verifiedNativeCodexReview(f.args), null);
  }
});

test('wrong PR, malformed summary, and nonterminal outcomes remain blocked', async () => {
  for (const changes of [{ repository: 'other/repo' }, { pullRequestNumber: 2 },
    { status: 'running' }, { status: 'failed' }, { status: 'cancelled' }]) {
    const f = nativeFixture();
    f.summary.body = `<!-- codex-security-review:v1 ${JSON.stringify({ ...f.evidence, ...changes })} -->`;
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
  }
  const f = nativeFixture(); f.summary.body = '<!-- codex-security-review:v1 {invalid} -->';
  assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
});

test('missing, nonclean, stale, mismatched or forged receipts never complete review', async () => {
  for (const mutate of [
    f => { f.comments.pop(); },
    f => { f.receipt.body = f.receipt.body.replace('No security issues were found in this pull request.', 'Found a security issue.'); },
    f => { f.receipt.body = f.receipt.body.replace(HEAD.slice(0, 10), 'bbbbbbbbbb'); },
    f => { f.receipt.body = f.receipt.body.replace(HEAD.slice(0, 10), 'aaaa'); },
    f => { f.receipt.body = f.receipt.body.replace('chatgpt.com', 'evil.test'); },
    f => { f.receipt.html_url = 'https://github.com/owner/repo/pull/2#issuecomment-2'; },
    f => { f.receipt.created_at = '2026-11-14T07:25:17Z'; },
    f => { f.summary.updated_at = '2026-11-01T07:25:21Z'; },
    f => { f.summary.updated_at = '2026-11-16T07:25:21Z'; },
    f => { f.receipt.user.id = 123; },
    f => { delete f.receipt.node_id; },
  ]) {
    const f = nativeFixture(); mutate(f);
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
  }
});

test('a human edit or incomplete/changing GraphQL snapshot cannot preserve app provenance', async () => {
  for (const mutate of [
    nodes => { nodes[0].editor = { __typename: 'User', databaseId: 1 }; nodes[0].lastEditedAt = 'now'; },
    nodes => { nodes[1].author = { __typename: 'User', databaseId: 199175422 }; },
    nodes => { nodes[1].body += 'changed'; },
    nodes => { nodes[1].updatedAt = 'changed'; },
    nodes => { delete nodes[1].editor; },
    nodes => { delete nodes[0].lastEditedAt; },
    nodes => { nodes.pop(); },
  ]) {
    const f = nativeFixture(); const read = f.args.github.graphql;
    f.args.github.graphql = async () => { const data = await read(); mutate(data.nodes); return data; };
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
  }
});

test('newer running review or findings supersede an earlier clean result for the same head', async () => {
  const f = nativeFixture();
  f.comments.push({ ...f.summary, id: 3, updated_at: '2026-11-15T07:26:01Z',
    body: f.summary.body.replace('completed', 'running') });
  assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
  f.comments.pop();
  f.comments.push({ ...f.receipt, id: 4, created_at: '2026-11-15T07:25:20Z',
    body: f.receipt.body.replace('No security issues were found in this pull request.', 'Security findings remain.') });
  assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
});

function nativeSnapshotFixture() {
  const f = nativeFixture();
  const listFiles = () => {}, listComments = () => {}, listArtifacts = 'GET /repos/{owner}/{repo}/actions/artifacts';
  f.contextRecord = { schema: 1, run_id: 12, run_attempt: 1, pull_request: 1,
    head_sha: HEAD, base_sha: OLD, base_ref: 'main', scope: SCOPE, workflow_sha: OLD };
  f.contextRun = { id: 12, run_attempt: 1, path: '.github/workflows/native-security-context.yml',
    event: 'workflow_dispatch', head_sha: OLD, head_branch: 'main', head_repository: { full_name: 'owner/repo' },
    created_at: '2026-11-15T07:24:00Z' };
  f.contextArtifacts = [{ id: 15, name: `native-review-context-1-${HEAD}`,
    created_at: '2026-11-15T07:24:30Z', workflow_run: { id: 12 } }];
  f.args.artifactReader = async () => f.contextRecord;
  f.args.github.rest = {
    git: f.args.github.rest.git,
    pulls: { get: async () => ({ data: { state: 'open', base: { sha: OLD }, labels: [], user: { login: 'owner' },
      head: { sha: HEAD, repo: { full_name: 'owner/repo' } } } }), listFiles },
    issues: { listComments },
    actions: { listArtifacts, getWorkflowRun: async () => ({ data: f.contextRun }) },
    repos: { ...f.args.github.rest.repos,
      getCollaboratorPermissionLevel: async () => ({ data: { permission: 'maintain' } }) },
  };
  f.args.github.paginate = async method => method === listFiles ? SCOPE.map(filename => ({ filename }))
    : method === listArtifacts ? f.contextArtifacts : f.comments;
  return f;
}

test('snapshot uses native completion under the base policy without a Claude rerun or human attestation', async () => {
  const f = nativeSnapshotFixture();
  const result = await snapshot({ ...f.args, expectedHead: HEAD });
  assert.equal(result.allowed, true);
  assert.equal(result.state, 'codex_native_completed');
  const incomplete = { state: 'codex_local_incomplete', allowed: false, reason: 'signed finding' };
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => incomplete })).state, 'codex_local_incomplete');
  f.summary.body = f.summary.body.replace('completed', 'running');
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).allowed, false);
});


test('running native review is polled until completion without a CI rerun', async () => {
  let inspections = 0, time = 0;
  const result = await enforce({ github: {}, context: { repo: { owner: 'owner', repo: 'repo' } },
    expectedHead: HEAD, now: () => time, wait: async ms => { time += ms; }, intervalMs: 10,
    timeoutMs: 100, core: { info() {}, setOutput() {}, setFailed() { assert.fail('must wait for completion'); },
      summary: { addHeading() { return this; }, addRaw() { return this; }, async write() {} } },
    inspect: async () => {
      const f = nativeFixture(); inspections++;
      if (inspections === 1) f.summary.body = f.summary.body.replace('completed', 'running');
      return verifiedNativeCodexReview(f.args);
    } });
  assert.equal(inspections, 2);
  assert.equal(time, 10);
  assert.equal(result.state, 'codex_native_completed');
});

test('a completed summary waits for its publishing receipt while stale evidence remains invalid', async () => {
  const f = nativeFixture(); f.comments.pop();
  assert.equal((await verifiedNativeCodexReview(f.args)).state, 'codex_native_pending');
  const updated = f.summary.updated_at;
  f.summary.updated_at = '2026-11-14T07:25:21Z';
  assert.equal((await verifiedNativeCodexReview(f.args)).state, 'codex_native_invalid');
  f.summary.updated_at = updated;
  let inspections = 0, time = 0;
  const result = await enforce({ github: {}, context: { repo: { owner: 'owner', repo: 'repo' } },
    expectedHead: HEAD, now: () => time, wait: async ms => { time += ms; }, intervalMs: 10,
    timeoutMs: 100, core: { info() {}, setOutput() {}, setFailed() { assert.fail('must wait for publication'); },
      summary: { addHeading() { return this; }, addRaw() { return this; }, async write() {} } },
    inspect: async () => { if (++inspections === 2) f.comments.push(f.receipt);
      return verifiedNativeCodexReview(f.args); } });
  assert.equal(inspections, 2);
  assert.equal(time, 10);
  assert.equal(result.state, 'codex_native_completed');
});

test('receipt publication cannot be bypassed with an earlier contingency or signed result', async () => {
  const f = nativeSnapshotFixture(); f.comments.pop();
  f.summary.updated_at = new Date().toISOString();
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending');
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'codex_native_pending');
});


test('unverifiable provider evidence preserves the explicit independent human contingency', async () => {
  for (const mutate of [
    f => { f.receipt.body = f.receipt.body.replace('chatgpt.com', 'unsupported.example'); },
    f => { f.args.github.graphql = async () => { throw new Error('GitHub unavailable'); }; },
  ]) {
    const f = nativeSnapshotFixture(); mutate(f);
    f.comments.push(reportComment, approvalComment());
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'manual_review_approved');
  }
  const f = fixture(); f.comments.push(reportComment, approvalComment());
  f.args.github.rest.repos = { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'maintain' } }) };
  assert.equal((await snapshot({ ...f.args, codexVerifier: async () => ({ allowed: false,
    state: 'codex_evidence_invalid', reason: 'expired signed receipt' }) })).state, 'manual_review_approved');
  assert.equal((await snapshot({ ...f.args, codexVerifier: async () => {
    throw new Error('Provider evidence API unavailable');
  } })).state, 'manual_review_approved');
});

test('a contingency cannot hide a supported completed nonclean native result', async () => {
  const f = nativeSnapshotFixture();
  f.receipt.body = f.receipt.body.replace('No security issues were found in this pull request.', 'Found security issues.');
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_incomplete');
});

test('invalid sibling summaries cannot hide authenticated pending reviews or findings', async () => {
  for (const reverse of [false, true]) {
    for (const kind of ['pending', 'summary-finding', 'receipt-finding', 'malformed-sibling']) {
      const f = nativeSnapshotFixture();
      const sibling = { ...f.summary, id: 9, node_id: 'edited-summary',
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-9' };
      f.comments.push(sibling, reportComment, approvalComment());
      const read = f.args.github.graphql;
      f.args.github.graphql = async query => { const data = await read(query);
        const edited = data.nodes?.find(node => node.id === sibling.node_id);
        if (edited) { edited.editor = { __typename: 'User', databaseId: 1 }; edited.lastEditedAt = 'now'; }
        return data; };
      if (kind === 'summary-finding') {
        f.summary.body = f.summary.body.replace('"has_any_findings":null', '"has_any_findings":true');
      } else if (kind === 'receipt-finding') {
        f.receipt.body = f.receipt.body.replace('No security issues were found in this pull request.', 'Security findings remain.');
      } else {
        f.summary.body = f.summary.body.replaceAll('completed', 'running');
        if (kind === 'malformed-sibling') sibling.body = '<!-- codex-security-review:v1 {broken} -->';
      }
      if (reverse) f.comments.reverse();
      const result = await snapshot({ ...f.args, expectedHead: HEAD });
      assert.equal(result.state, ['pending', 'malformed-sibling'].includes(kind)
        ? 'codex_native_pending' : 'codex_native_incomplete', kind);
    }
  }
});

test('authenticated nonclean receipts block even when their summary is unavailable', async () => {
  const f = nativeSnapshotFixture();
  f.comments.splice(f.comments.indexOf(f.summary), 1);
  f.receipt.body = f.receipt.body.replace('No security issues were found in this pull request.', 'Security findings remain.');
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_incomplete');
});


test('native commit abbreviations must resolve unambiguously to the entire current SHA', async () => {
  for (const getCommit of [
    async () => ({ data: { sha: HEAD.slice(0, 10) + 'b'.repeat(30) } }),
    async () => { throw Object.assign(new Error('Ambiguous abbreviated commit'), { status: 422 }); },
    async () => { throw Object.assign(new Error('Commit missing'), { status: 404 }); },
  ]) {
    const f = nativeFixture(); f.args.github.rest.repos.getCommit = getCommit;
    const result = await verifiedNativeCodexReview(f.args);
    assert.equal(result.allowed, false);
    assert.equal(result.state, 'codex_native_invalid');
  }
});


test('hex-named Git references cannot shadow a reviewed commit abbreviation', async () => {
  const f = nativeFixture();
  f.args.github.rest.git.getRef = async ({ ref }) => {
    if (ref.startsWith('heads/')) return { data: { object: { sha: HEAD } } };
    throw Object.assign(new Error('Not found'), { status: 404 });
  };
  assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
  f.args.github.rest.git.getRef = async () => { throw new Error('API unavailable'); };
  assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
});


test('overlapping same-head native reviews cannot hide a findings receipt with a later clean one', async () => {
  for (const findingsFirst of [true, false]) {
    const f = nativeSnapshotFixture();
    const other = { ...structuredClone(f.receipt), id: 5, node_id: 'findings',
      html_url: 'https://github.com/owner/repo/pull/1#issuecomment-5',
      created_at: findingsFirst ? '2026-11-15T07:25:16Z' : '2026-11-15T07:25:18Z',
      body: f.receipt.body.replace('No security issues were found in this pull request.', 'Found security issues.')
        .replace('task_review', 'task_other') };
    f.comments.push(other, reportComment, approvalComment());
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_incomplete');
  }
});

test('a newer running native review takes precedence over an older human contingency', async () => {
  const f = nativeSnapshotFixture();
  f.summary.body = f.summary.body.replace('completed', 'running');
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending');
});


test('an older-head summary updated later cannot hide a pending current-head review', async () => {
  const f = nativeSnapshotFixture();
  f.summary.body = f.summary.body.replace('completed', 'running');
  f.comments.push({ ...structuredClone(f.summary), id: 9, node_id: 'other-summary',
    html_url: 'https://github.com/owner/repo/pull/1#issuecomment-9', updated_at: '2026-11-15T07:26:01Z',
    body: `<!-- codex-security-review:v1 ${JSON.stringify({ ...f.evidence, headSha: OLD })} -->` },
    reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending');
});


test('an older-head receipt published later does not reject clean current-head completion', async () => {
  const f = nativeFixture();
  f.comments.push({ ...structuredClone(f.receipt), id: 9, node_id: 'other-receipt',
    html_url: 'https://github.com/owner/repo/pull/1#issuecomment-9', created_at: '2026-11-15T07:26:01Z',
    body: f.receipt.body.replace(HEAD.slice(0, 10), OLD.slice(0, 10)) });
  assert.equal((await verifiedNativeCodexReview(f.args)).state, 'codex_native_completed');
});


test('second-granularity timestamp ties keep a pending review ahead of completed evidence', async () => {
  for (const reverse of [false, true]) {
    const f = nativeSnapshotFixture();
    const running = { ...structuredClone(f.summary), id: 9, node_id: 'tied-summary',
      html_url: 'https://github.com/owner/repo/pull/1#issuecomment-9',
      body: f.summary.body.replace('completed', 'running') };
    f.comments.push(running, reportComment, approvalComment());
    if (reverse) f.comments.reverse();
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending');
  }
});


test('any authenticated same-head running task blocks a later completed task', async () => {
  const f = nativeSnapshotFixture();
  f.comments.push({ ...structuredClone(f.summary), id: 9, node_id: 'older-running',
    html_url: 'https://github.com/owner/repo/pull/1#issuecomment-9',
    updated_at: '2026-11-15T07:25:00Z', body: f.summary.body.replace('completed', 'running') },
    reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending');
});

test('a human-edited pending marker is unverifiable evidence rather than an authenticated running task', async () => {
  const f = nativeSnapshotFixture();
  f.summary.body = f.summary.body.replace('completed', 'running');
  const read = f.args.github.graphql;
  f.args.github.graphql = async () => { const data = await read();
    data.nodes[0].editor = { __typename: 'User', databaseId: 1 }; data.nodes[0].lastEditedAt = 'now'; return data; };
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'manual_review_approved');
});


test('native review context binds the exact main base and changed-file scope', async () => {
  for (const mutate of [
    f => { f.contextRecord.base_sha = 'c'.repeat(40); },
    f => { f.contextRecord.scope = ['hidden-code.py']; },
    f => { f.contextRecord.workflow_sha = HEAD; },
    f => { f.contextArtifacts[0].created_at = '2026-11-15T07:26:00Z'; },
  ]) {
    const f = nativeSnapshotFixture(); mutate(f);
    f.comments.push(reportComment, approvalComment());
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
  }
});

test('a queued context run cannot certify a receipt published before its artifact', async () => {
  const f = nativeSnapshotFixture();
  f.contextRun.created_at = '2026-11-15T07:20:00Z';
  f.contextArtifacts[0].created_at = '2026-11-15T07:26:00Z';
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
  delete f.contextArtifacts[0].created_at;
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
});

test('a task started before a base refresh cannot use context published before its completion', async () => {
  const f = nativeSnapshotFixture();
  f.contextArtifacts[0].created_at = '2026-11-15T07:25:10Z';
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
  f.contextArtifacts[0].created_at = '2026-11-15T07:24:30Z';
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_completed');
});

test('native task start requires an authentic running revision for this full head', async () => {
  const clean = nativeFixture();
  assert.equal((await verifiedNativeCodexReview(clean.args)).review_started_at, '2026-11-15T07:25:00.000Z');
  for (const mutate of [
    f => { f.summary.history = []; },
    f => { f.summary.history[0].editor = { __typename: 'User', databaseId: 1 }; },
    f => { f.summary.history[0].deletedAt = '2026-11-15T07:25:02Z'; },
    f => { f.summary.history[0].diff = f.summary.history[0].diff.replaceAll(HEAD, OLD); },
    f => { f.summary.history[0].diff = f.summary.history[0].diff.replaceAll('07:25:00Z', '07:26:00Z'); },
    f => { f.summary.history[0].editedAt = '2026-11-15T07:26:00Z'; },
    f => { f.summary.history[0].diff = f.summary.history[0].diff.replace('**Security Review**', '**Code Review**'); },
  ]) {
    const f = nativeFixture(); mutate(f);
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false);
  }
});

test('a retargeted PR cannot reuse a clean native review while retaining its head', async () => {
  const f = nativeSnapshotFixture(); const read = f.args.github.graphql;
  f.args.github.graphql = async query => { const data = await read(query);
    if (data.repository) data.repository.pullRequest.timelineItems.nodes.push({ __typename: 'BaseRefChangedEvent' });
    return data; };
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
});

test('unfiltered timeline totals do not count as base-change history', async () => {
  const f = nativeSnapshotFixture();
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_completed');
  const read = f.args.github.graphql;
  f.args.github.graphql = async query => { const data = await read(query);
    if (data.repository) delete data.repository.pullRequest.timelineItems.nodes;
    return data; };
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
});

test('native completion waits for trusted context and rejects another workflow as its producer', async () => {
  const f = nativeSnapshotFixture(); f.contextRun.path = '.github/workflows/untrusted.yml';
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_pending');
  f.contextRun.path = '.github/workflows/native-security-context.yml';
  f.contextArtifacts = [];
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_pending');
});

test('old-base CI snapshots fail after a base update without a head update', async () => {
  const f = fixture(); f.args.context.payload.pull_request.base = { sha: 'c'.repeat(40) };
  assert.equal((await snapshot(f.args)).state, 'stale_base');
});

test('trusted context producer captures API file scope without executing PR code', async () => {
  const source = fs.readFileSync('.github/workflows/native-security-context.yml', 'utf8');
  assert.doesNotMatch(source, /actions\/checkout|git checkout|git clone/);
  const script = source.split('          script: |\n')[1].split('\n      - name:')[0]
    .split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'require', 'process', script);
  const expected = { number: 1, state: 'open', head: { sha: HEAD }, base: { sha: OLD, ref: 'main' } };
  let captures = [], reads = 0, changeAt = 0;
  const github = { rest: { pulls: { get: async () => ({ data: changeAt && ++reads === changeAt
    ? { ...expected, base: { sha: HEAD, ref: 'main' } } : expected }), listFiles() {} } },
    paginate: async () => [{ filename: 'new.py', previous_filename: 'old.py', status: 'renamed' }] };
  const args = [github, { repo: { owner: 'owner', repo: 'repo' },
    payload: { inputs: { pull_request: '1', head_sha: HEAD, base_sha: OLD } },
    ref: 'refs/heads/main', sha: OLD, runId: 12 }, () => ({ writeFileSync: (path, data) => captures.push(JSON.parse(data)) }),
  { env: { GITHUB_RUN_ATTEMPT: '1', GITHUB_WORKFLOW_SHA: OLD } }];
  await run(...args);
  assert.deepEqual(captures[0].scope, ['new.py', 'old.py']);
  assert.equal(captures[0].base_sha, OLD);
  assert.equal(captures[0].workflow_sha, OLD);
  for (changeAt of [1, 2]) { reads = 0; captures = [];
    await assert.rejects(run(...args), /PR changed/); assert.equal(captures.length, 0); }
  changeAt = 0; captures = [];
  args[3].env.GITHUB_WORKFLOW_SHA = HEAD;
  await assert.rejects(run(...args), /workflow source/); assert.equal(captures.length, 0);
});


test('context transport failure does not hide a separately valid base-bound signed review', async () => {
  const f = nativeSnapshotFixture(); f.args.artifactReader = async () => { throw new Error('Artifact unavailable'); };
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'codex_local_completed');
});

test('base and metadata edits both run the normal required CI jobs', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, edited\]/);
  for (const id of ['frontend-tests', 'backend-tests', 'backend-postgres-tests', 'security-review-completion', 'quality']) {
    const block = workflow.slice(workflow.indexOf(`  ${id}:\n`)).split(/\n  [a-z][a-z-]+:\n/)[0];
    assert.doesNotMatch(block, /Ignored metadata edit|github\.event\.action|github\.event\.changes\.base/);
    const condition = block.match(/^    if: (.+)$/m)?.[1];
    assert.equal(condition, id === 'quality' ? 'always()'
      : id === 'security-review-completion' ? "github.event_name == 'pull_request'" : undefined);
  }
  assert.match(workflow, /current\.base\.sha !== pr\.base\.sha/);
});


test('a valid base-bound signed review does not need a missing native context artifact', async () => {
  const f = nativeSnapshotFixture(); f.contextArtifacts = [];
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'codex_local_completed');
});

test('a context producer rerun remains pending until its current-attempt artifact arrives', async () => {
  const f = nativeSnapshotFixture(); f.contextRun.status = 'in_progress'; f.args.artifactReader = async () => null;
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_pending');
});


test('native inline findings reported in the authenticated summary block an older clean receipt', async () => {
  const f = nativeSnapshotFixture();
  f.summary.body = f.summary.body.replace('"has_any_findings":null', '"has_any_findings":true');
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_incomplete');
});


function addBaseBoundContingency(f, base = OLD, reportBase = OLD) {
  f.comments.push({ ...reportComment, body: reportComment.body.replace(`Reviewed base: ${OLD}`, `Reviewed base: ${reportBase}`) },
    { ...approvalComment(), body: approvalComment().body.replace(`Reviewed base: ${OLD}`, `Reviewed base: ${base}`) });
}

test('missing or unavailable context supports an optional independently reviewed base-bound contingency', async () => {
  for (const transport of [false, true]) {
    const f = nativeSnapshotFixture(); addBaseBoundContingency(f);
    if (transport) f.args.artifactReader = async () => { throw new Error('Context transport unavailable'); };
    else f.contextArtifacts = [];
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'manual_review_approved');
  }
});

test('context contingency rejects head-only, wrong-base or unbound reports and cannot override a real mismatch', async () => {
  for (const kind of ['head-only', 'wrong-base', 'report-base', 'mismatch']) {
    const f = nativeSnapshotFixture();
    if (kind === 'head-only') f.comments.push(
      { ...reportComment, body: reportComment.body.replace(`Reviewed base: ${OLD}\n`, '') },
      { ...approvalComment(), body: approvalComment().body.replace(`Reviewed base: ${OLD}\n`, '') });
    else addBaseBoundContingency(f, kind === 'wrong-base' ? HEAD : OLD, kind === 'report-base' ? HEAD : OLD);
    if (kind === 'mismatch') f.contextRecord.scope = ['another-file'];
    else f.contextArtifacts = [];
    const result = await snapshot({ ...f.args, expectedHead: HEAD });
    assert.equal(result.allowed, false, kind);
  }
});


test('superseded main-base context artifacts do not block a fresh current-base capture', async () => {
  for (const reverse of [false, true]) {
    const f = nativeSnapshotFixture();
    const read = f.args.github.rest.actions.getWorkflowRun;
    f.args.github.rest.actions.getWorkflowRun = async args => args.run_id === 13
      ? { data: { ...f.contextRun, id: 13, head_sha: 'c'.repeat(40) } } : read(args);
    f.args.artifactReader = async ({ run }) => run.id === 13
      ? { ...f.contextRecord, run_id: 13, base_sha: 'c'.repeat(40), workflow_sha: 'c'.repeat(40) }
      : f.contextRecord;
    f.contextArtifacts.push({ ...f.contextArtifacts[0], id: 16, workflow_run: { id: 13 } });
    if (reverse) f.contextArtifacts.reverse();
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_completed');
  }
  const f = nativeSnapshotFixture();
  f.contextRecord.base_sha = f.contextRecord.workflow_sha = 'c'.repeat(40);
  f.contextRun.head_sha = 'c'.repeat(40);
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_pending');
});

test('a changed actual main ref cannot be waived with old-base human or signed evidence', async () => {
  const f = nativeSnapshotFixture(); const read = f.args.github.graphql;
  f.args.github.graphql = async query => { const data = await read(query);
    if (data.repository) data.repository.pullRequest.baseRef.target.oid = HEAD;
    return data; };
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'stale_base');
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'stale_base');
});

test('the context requester dispatches only the fixed read-only recorder on main', async () => {
  const source = fs.readFileSync('.github/workflows/native-security-context-request.yml', 'utf8');
  assert.doesNotMatch(source, /actions\/checkout|git checkout|git clone/);
  assert.match(source, /actions: write/);
  const script = source.split('          script: |\n')[1]
    .split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', script);
  let calls = [];
  const github = { rest: { actions: { createWorkflowDispatch: async args => calls.push(args) } } };
  const pr = { number: 1, head: { sha: HEAD, repo: { full_name: 'owner/repo' } }, base: { sha: OLD, ref: 'main' } };
  const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: pr } };
  await run(github, context);
  assert.deepEqual(calls, [{ owner: 'owner', repo: 'repo', workflow_id: 'native-security-context.yml', ref: 'main',
    inputs: { pull_request: '1', head_sha: HEAD, base_sha: OLD } }]);
  for (const change of [() => { pr.base.ref = 'untrusted'; },
    () => { pr.base.ref = 'main'; pr.head.repo.full_name = 'fork/repo'; }]) {
    calls = []; change(); await run(github, context); assert.deepEqual(calls, []);
  }
});

test('only a dispatch on main can authenticate the recorder workflow source', async () => {
  const f = nativeSnapshotFixture();
  assert.equal(f.contextRun.head_sha, f.contextRecord.workflow_sha);
  assert.notEqual(f.contextRun.head_sha, HEAD);
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_completed');
  f.contextRun.event = 'pull_request_target'; f.contextRun.head_sha = HEAD;
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_pending');
  f.contextRun.event = 'workflow_dispatch'; f.contextRun.head_sha = OLD; f.contextRun.head_branch = 'untrusted';
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_pending');
});


test('an older completion cannot be rebound to a later same-head task start', async () => {
  const f = nativeSnapshotFixture();
  f.comments.push({ ...structuredClone(f.receipt), id: 19, node_id: 'pre-context-receipt',
    html_url: 'https://github.com/owner/repo/pull/1#issuecomment-19',
    created_at: '2026-11-15T07:23:00Z', updated_at: '2026-11-15T07:23:00Z' });
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_ambiguous');
});

test('every native receipt must follow the running revision beyond timestamp precision', async () => {
  for (const offset of [0, 999, 1000]) {
    const f = nativeFixture();
    f.receipt.created_at = new Date(Date.parse(f.summary.history[0].editedAt) + offset).toISOString();
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, offset === 1000, String(offset));
    if (!offset) {
      const newer = { ...f.receipt, id: 19, node_id: 'newer-duplicate',
        html_url: 'https://github.com/owner/repo/pull/1#issuecomment-19', created_at: '2026-11-15T07:25:17Z' };
      f.comments.push(newer);
      assert.equal((await verifiedNativeCodexReview(f.args)).state, 'codex_native_ambiguous');
    }
  }
});

test('overlapping same-head tasks cannot assign a later start to an earlier receipt', async () => {
  const f = nativeSnapshotFixture();
  const earlier = structuredClone(f.summary.history[0]);
  earlier.diff = earlier.diff.replaceAll('07:25:00Z', '07:23:00Z');
  earlier.editedAt = '2026-11-15T07:23:01Z';
  f.summary.created_at = earlier.editedAt;
  f.summary.history.push(earlier);
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_ambiguous');
});

test('duplicate running revisions remain ambiguous even with identical start and edit timestamps', async () => {
  for (const tiedEdit of [false, true]) {
    const f = nativeFixture(); const second = structuredClone(f.summary.history[0]);
    if (!tiedEdit) second.editedAt = '2026-11-15T07:25:02Z';
    f.summary.history.push(second);
    assert.equal((await verifiedNativeCodexReview(f.args)).state, 'codex_native_ambiguous');
  }
});

test('an existing human contingency cannot override an ambiguous potentially pending native task', async () => {
  const f = nativeSnapshotFixture();
  f.summary.history.push(structuredClone(f.summary.history[0]));
  f.comments.push(reportComment, approvalComment());
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_ambiguous');
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
    codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'codex_native_ambiguous');
});

test('unsupported earlier running revisions cannot disappear from task correlation', async () => {
  for (const kind of ['row', 'delay', 'metadata', 'malformed', 'submillisecond']) {
    const f = nativeFixture(); const earlier = structuredClone(f.summary.history[0]);
    earlier.diff = earlier.diff.replaceAll('07:25:00Z', '07:23:00Z');
    earlier.editedAt = '2026-11-15T07:23:01Z';
    f.summary.created_at = earlier.editedAt;
    if (kind === 'row') earlier.diff = earlier.diff.replace('**Security Review**', '**Unknown**');
    if (kind === 'delay') earlier.diff = earlier.diff.replaceAll('07:23:00Z', '07:15:00Z');
    if (kind === 'metadata') earlier.diff = earlier.diff.replace('"status":"running"', '"status":"completed"');
    if (kind === 'malformed') earlier.diff = earlier.diff.split('\n').map(line => line.startsWith('<!-- codex-security-review:v1 ')
      ? '<!-- codex-security-review:v1 {broken} -->' : line).join('\n');
    if (kind === 'submillisecond') {
      f.summary.created_at = earlier.editedAt = '2026-11-15T07:25:01Z';
      earlier.diff = earlier.diff.replaceAll('07:23:00Z', '07:25:00.0001Z');
    }
    f.summary.history.push(earlier);
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, false, kind);
  }
});

test('visible same-head running rows remain evidence when both hidden markers are unusable', async () => {
  for (const kind of ['malformed', 'unsupported', 'row-format', 'other-head']) {
    const f = nativeSnapshotFixture(); const earlier = structuredClone(f.summary.history[0]);
    earlier.diff = earlier.diff.replaceAll('07:25:00Z', '07:23:00Z');
    earlier.editedAt = '2026-11-15T07:23:01Z'; f.summary.created_at = earlier.editedAt;
    if (kind === 'unsupported') earlier.diff = earlier.diff.replaceAll(':v1 ', ':v2 ');
    else earlier.diff = earlier.diff.split('\n').map(line =>
      ['<!-- codex-security-review:v1 ', '<!-- codex-review-state:v1 '].some(prefix => line.startsWith(prefix))
        ? '<!-- unusable provider metadata -->' : line).join('\n');
    if (kind === 'row-format') earlier.diff = earlier.diff.replace('🔒', '🔐');
    if (kind === 'other-head') earlier.diff = earlier.diff.replaceAll(HEAD.slice(0, 7), OLD.slice(0, 7));
    f.summary.history.push(earlier); f.comments.push(reportComment, approvalComment());
    const result = await snapshot({ ...f.args, expectedHead: HEAD });
    assert.equal(result.state, kind === 'other-head' ? 'codex_native_completed' : 'codex_native_ambiguous', kind);
  }
});

test('authenticated visible running summaries block even when current hidden markers are unusable', async () => {
  for (const kind of ['missing', 'malformed', 'unsupported']) {
    const f = nativeSnapshotFixture(); f.summary.body = f.summary.history[0].diff;
    if (kind === 'missing') f.summary.body = f.summary.body.split('\n').filter(line => !line.startsWith('<!-- codex-')).join('\n');
    if (kind === 'malformed') f.summary.body = f.summary.body.split('\n').map(line => line.startsWith('<!-- codex-')
      ? '<!-- codex-security-review:v1 {broken} -->' : line).join('\n');
    if (kind === 'unsupported') f.summary.body = f.summary.body.replaceAll(':v1 ', ':v2 ');
    f.comments.push(reportComment, approvalComment());
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending', kind);
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
      codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'codex_native_pending', kind);
  }
});

test('authenticated cross-read mutations cannot fall through to older approval or signed evidence', async () => {
  for (const stage of ['summary-body', 'summary-version', 'receipt', 'history']) {
    const f = nativeSnapshotFixture(); const read = f.args.github.graphql;
    f.args.github.graphql = async (query, vars) => {
      const data = await read(query); if (!data.nodes) return data;
      const node = data.nodes.find(item => item.id === (stage === 'receipt' ? f.receipt.node_id : f.summary.node_id));
      if (stage === 'history' && !query.includes('userContentEdits')) return data;
      if (node) {
        if (stage !== 'summary-version') node.body = node.body.replaceAll('completed', 'running');
        node.updatedAt = '2026-11-15T07:25:22Z';
        node.lastEditedAt = node.updatedAt; node.editor = { __typename: 'Bot', databaseId: 199175422 };
      }
      return data;
    };
    f.comments.push(reportComment, approvalComment());
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_pending', stage);
    assert.equal((await snapshot({ ...f.args, expectedHead: HEAD,
      codexVerifier: async () => ({ allowed: true, state: 'codex_local_completed' }) })).state, 'codex_native_pending', stage);
  }
});

test('a changing native snapshot automatically refetches and completes once consistent', async () => {
  const f = nativeFixture(); const read = f.args.github.graphql;
  f.args.github.graphql = async query => { const data = await read(query);
    const node = data.nodes.find(item => item.id === f.summary.node_id);
    node.updatedAt = '2026-11-15T07:25:22Z';
    node.lastEditedAt = node.updatedAt; node.editor = { __typename: 'Bot', databaseId: 199175422 };
    return data; };
  let inspections = 0, time = 0;
  const result = await enforce({ github: {}, context: { repo: { owner: 'owner', repo: 'repo' } },
    expectedHead: HEAD, now: () => time, intervalMs: 10, timeoutMs: 100,
    wait: async ms => { time += ms; f.summary.updated_at = '2026-11-15T07:25:22Z'; },
    core: { info() {}, setOutput() {}, setFailed() { assert.fail('must refetch changing evidence'); },
      summary: { addHeading() { return this; }, addRaw() { return this; }, async write() {} } },
    inspect: async () => { inspections++; return verifiedNativeCodexReview(f.args); } });
  assert.equal(inspections, 2); assert.equal(time, 10); assert.equal(result.state, 'codex_native_completed');
});

test('second-precision artifact timestamps cannot certify a task in the same timestamp second', async () => {
  const f = nativeSnapshotFixture();
  f.contextArtifacts[0].created_at = '2026-11-15T07:25:00Z';
  f.summary.history[0].diff = f.summary.history[0].diff.replaceAll('07:25:00Z', '07:25:00.500Z');
  assert.equal((await snapshot({ ...f.args, expectedHead: HEAD })).state, 'codex_native_context_invalid');
});

test('distinct receipt tasks are ambiguous even if only one start is visible', async () => {
  const f = nativeFixture();
  f.comments.push({ ...structuredClone(f.receipt), id: 19, node_id: 'second-task',
    html_url: 'https://github.com/owner/repo/pull/1#issuecomment-19',
    body: f.receipt.body.replace('task_review', 'task_other') });
  assert.equal((await verifiedNativeCodexReview(f.args)).state, 'codex_native_ambiguous');
});

test('task history must be complete across pages and retains snapshot provenance', async () => {
  for (const kind of ['valid', 'deleted', 'changed', 'truncated']) {
    const f = nativeFixture(); const read = f.args.github.graphql;
    f.args.github.graphql = async (query, vars) => {
      const data = await read(query);
      if (!query.includes('userContentEdits')) return data;
      const node = data.nodes.find(node => node.id === f.summary.node_id);
      if (vars.cursor) {
        if (kind === 'deleted') node.userContentEdits.nodes[0].deletedAt = '2026-11-15T07:25:10Z';
        if (kind === 'changed') node.body += 'changed';
        if (kind === 'truncated') node.userContentEdits.pageInfo = { hasNextPage: true, endCursor: vars.cursor };
      } else {
        node.userContentEdits = { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'older-page' } };
      }
      return data;
    };
    assert.equal((await verifiedNativeCodexReview(f.args)).allowed, kind === 'valid', kind);
  }
});
