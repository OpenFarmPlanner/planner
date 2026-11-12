const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { evaluate, parseApproval, approvedReview, readArtifact, snapshot, enforce } =
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
    body: `/security-review approve ${mode} ${sha} ${report}\n${statement}\nResult: No unresolved findings\nReason: provider unavailable`, ...overrides };
}
const reportComment = { id: 10, user: { login: 'reviewer', type: 'User' },
  created_at: '2026-11-12T10:00:00Z', body: `<!-- manual-security-review:${HEAD} -->\nScope: \`${SCOPE[0]}\`\nResult: No unresolved findings` };

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
    head: HEAD, scope: SCOPE, comments: [reportComment, approvalComment()] };
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
  const approval = await approvedReview({ github, coordinates: {}, comments: [approvalComment('codex')], head: HEAD, scope: SCOPE });
  const result = evaluate(input({ approval }));
  assert.equal(result.state, 'codex_completed_attested');
  assert.match(result.reason, /not automated verification/);
});

function fixture(changes = {}) {
  const pr = { number: 1, state: 'open', draft: false, user: { login: 'author' }, labels: [],
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
  const args = { github: {}, context: {}, core, expectedHead: HEAD, timeoutMs: 100, intervalMs: 50,
    now: () => time, wait: async ms => { time += ms; } };
  assert.equal((await enforce({ ...args, inspect: async () => evaluate(input({ request: {} })) })).state, 'timed_out');
  assert.ok(output.some(line => /blocked: timed_out/.test(line)));
  assert.equal((await enforce({ ...args, inspect: async () => evaluate(input({ claude: completed })) })).allowed, true);
  time = 0;
  assert.equal((await enforce({ ...args, inspect: async () => evaluate(input({ request: {}, rejection: {} })) })).state, 'codex_rejected');
  assert.equal(time, 0);
  assert.equal((await enforce({ ...args, inspect: async () => { throw new Error('API unavailable'); } })).state, 'evidence_unavailable');
});

test('required quality job loads immutable base policy and bootstrap needs explicit human approval', async () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const start = workflow.indexOf('      - name: Enforce security review completion');
  const end = workflow.indexOf('      - name: Upload quality reports', start);
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
