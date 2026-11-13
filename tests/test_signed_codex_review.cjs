const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { terminalReview, reviewerArgs, run, KEY_ID, SOURCES, MARKER } =
  require('../scripts/ci/run_codex_review.cjs');
const { signedCodexPayload, verifiedCodexReview } =
  require('../.github/scripts/security-review-completion.cjs');

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), SCOPE = ['new.py', 'old.py'];
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const keys = { [KEY_ID]: publicKey };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const review = { reviewed_sha: HEAD, complete: true, scope: SCOPE, findings: [],
  limitations: [], analysis: 'Traced the changed permission boundary.', review_notes: ['Static review.'] };
const events = [
  { type: 'thread.started', thread_id: '12345678-1234-1234-1234-123456789abc' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'command_execution', command: 'git diff', status: 'completed', exit_code: 0 } },
  { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(review) } },
  { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 100 } },
];
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n');
const sourceContent = name => `trusted source ${name}`;
const receipt = changes => ({ schema: 1, provider: 'codex-local', issuer: KEY_ID,
  repository: 'owner/repo', pull_request: 1, head_sha: HEAD, base_sha: BASE, scope: SCOPE,
  sources: Object.fromEntries(SOURCES.map(name => [name, hash(sourceContent(name))])),
  thread_id: events[0].thread_id, completed_at: new Date().toISOString(), exit_code: 0,
  fresh: true, sandbox: 'restricted-read-only', execution_sha256: 'c'.repeat(64),
  prompt_sha256: 'd'.repeat(64), result: 'no_issues', review, ...changes });
function signed(payload, signingKey = privateKey) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { html_url: 'report', body: `${MARKER}\n\`\`\`json\n${JSON.stringify({
    payload: bytes.toString('base64'), signature: crypto.sign(null, bytes, signingKey).toString('base64'),
  })}\n\`\`\`\n` };
}
const args = comments => ({ comments, head: HEAD, base: BASE, scope: SCOPE, keys,
  context: { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { number: 1 } } },
  github: { rest: { repos: { getContent: async ({ path: filename, ref }) => {
    assert.equal(ref, BASE);
    return { data: { encoding: 'base64', content: Buffer.from(sourceContent(filename)).toString('base64') } };
  } } } } });

test('only an authenticated exact-head execution receipt completes local review automatically', async () => {
  assert.equal((await verifiedCodexReview(args([signed(receipt())]))).state, 'codex_local_completed');
  assert.equal(await verifiedCodexReview(args([{ body: 'Codex reviewed everything. No issues.' }])), null);
  const unknown = crypto.generateKeyPairSync('ed25519');
  assert.equal(signedCodexPayload(signed(receipt(), unknown.privateKey), keys), null);
  assert.equal(signedCodexPayload(signed(receipt()).body, keys), null);
  const tampered = signed(receipt());
  tampered.body = tampered.body.replace('signature":"', 'signature":"AAA');
  assert.equal(signedCodexPayload(tampered, keys), null);
  for (const changes of [{ repository: 'other/repo' }, { pull_request: 2 }, { head_sha: BASE }]) {
    assert.equal(await verifiedCodexReview(args([signed(receipt(changes))])), null);
  }
});

test('signed but stale, partial, failed or wrong-launcher evidence never passes', async () => {
  for (const changes of [{ base_sha: HEAD }, { scope: ['new.py'] }, { scope: [...SCOPE, ...SCOPE] },
    { fresh: false }, { exit_code: 1 }, { sandbox: 'danger-full-access' }, { sources: {} },
    { execution_sha256: '' }, { thread_id: '' }, { completed_at: '2020-01-01T00:00:00Z' },
    { completed_at: '2099-01-01T00:00:00Z' }, { result: 'incomplete' },
    { review: { ...review, complete: false } }, { review: { ...review, findings: ['Potential IDOR'] } },
    { review: { ...review, limitations: ['Skipped old.py'] } },
    { review: { ...review, scope: ['new.py'] } }]) {
    const result = await verifiedCodexReview(args([signed(receipt(changes))]));
    assert.equal(result.allowed, false, JSON.stringify(changes));
  }
});

test('newer signed findings supersede older clean receipts even if the old comment is replayed later', async () => {
  const now = Date.now();
  const clean = signed(receipt({ completed_at: new Date(now - 1000).toISOString() }));
  const findings = signed(receipt({ review: { ...review, findings: ['Unresolved issue'] } }));
  assert.equal((await verifiedCodexReview(args([findings, clean]))).state, 'codex_local_incomplete');
});

test('terminal execution requires a fresh turn, actual inspection and a successful final event', () => {
  assert.deepEqual(terminalReview(jsonl(events)).review, review);
  for (const rows of [events.slice(0, -1), events.slice(1), [events[0], ...events],
    [...events, { type: 'error' }], [...events.slice(0, -1), { type: 'turn.failed' }],
    events.filter(row => row.item?.type !== 'command_execution'),
    [...events.slice(0, -1), { type: 'item.completed', item: { type: 'file_change' } }, events.at(-1)]]) {
    assert.throws(() => terminalReview(jsonl(rows)));
  }
});

test('reviewer uses a restricted filesystem and no shell network or approval escalation', () => {
  const argv = reviewerArgs('/tmp/bundle', '/repo/.git', '/runtime');
  assert.ok(argv.includes('--ignore-user-config'));
  assert.ok(argv.includes('--ephemeral'));
  assert.ok(argv.includes('--strict-config'));
  assert.ok(argv.includes('approval_policy="never"'));
  assert.ok(argv.includes('permissions.security-review.network.enabled=false'));
  assert.ok(argv.some(value => value.includes('":root"="deny"') && value.includes('"/tmp/bundle"="read"')));
  assert.ok(!argv.includes('--sandbox')); // Older sandbox flags would override the restricted profile.
  assert.ok(!argv.includes('resume'));
});

test('launcher signs only its own fresh execution; it does not accept a supplied report or sign on CLI failure', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'signed-review-test-'));
  const keyFile = path.join(directory, 'key.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let fail = false;
  t.mock.method(cp, 'spawnSync', (binary, argv, options) => {
    if (binary === 'volta') return { status: 0, stdout: __filename };
    if (binary === 'codex') {
      assert.equal(options.env.GITHUB_TOKEN, undefined);
      assert.equal(options.env.SSH_AUTH_SOCK, undefined);
      return { status: fail ? 1 : 0, stdout: jsonl(events), stderr: '' };
    }
    if (binary === 'git' && argv[0] === 'show') {
      return { status: 0, stdout: fs.readFileSync(path.join(__dirname, '..', argv[1].slice(BASE.length + 1))) };
    }
    if (binary === 'git') return { status: 0, stdout: path.join(directory, 'common-git') };
    const output = argv.at(-1);
    if (argv.includes('prepare')) {
      fs.mkdirSync(output);
      fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ repo: 'owner/repo',
        number: 1, base: BASE, head: HEAD, scope: SCOPE }));
      fs.writeFileSync(path.join(output, 'prompt.txt'), 'Review independently.');
    } else fs.writeFileSync(path.join(output, 'report.md'), 'No unresolved findings.');
    return { status: 0, stdout: '' };
  });
  const output = path.join(directory, 'success');
  assert.equal(run(1, output, keyFile).result, 'no_issues');
  assert.equal(signedCodexPayload({ body: fs.readFileSync(path.join(output, 'signed-report.md'), 'utf8') }, keys).head_sha, HEAD);
  fail = true;
  const failed = path.join(directory, 'failed');
  assert.throws(() => run(1, failed, keyFile), /Codex failed/);
  assert.ok(!fs.existsSync(path.join(failed, 'signed-report.md')));
});
