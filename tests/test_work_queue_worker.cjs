const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseQueue, selectItem, requiredChecksPass, authorArgs, sanitizeAuthorGit, Worker } = require('../scripts/ci/work_queue_worker.cjs');

test('queue parsing bounds the section, ignores advisory checkboxes and rejects malformed/duplicate rows', () => {
  assert.deepEqual(parseQueue('## Ordered work items\n- [x] #1\n- [ ] PR #2\n\n## Notes\n- [ ] #9'),
    [{ number: 1, isPR: false }, { number: 2, isPR: true }]);
  for (const body of ['', '## Ordered work items\n- [ ] #0', '## Ordered work items\n- [ ] #1\n- [x] #1',
    '## Ordered work items\n- [ ] PR typo #1', '## Ordered work items\n- [ ] #9007199254740993']) {
    assert.throws(() => parseQueue(body));
  }
});

test('live state controls order and an open PR remains a gate even with a blocked label', () => {
  const rows = [{ number: 1, isPR: false }, { number: 2, isPR: true }, { number: 3, isPR: false }];
  const issues = new Map([[1, { state: 'closed', labels: [] }],
    [2, { state: 'open', pull_request: {}, labels: ['blocked'] }], [3, { state: 'open', labels: [] }]]);
  const pulls = new Map([[2, { state: 'open' }]]);
  assert.equal(selectItem(rows, issues, pulls).number, 2);
  pulls.set(2, { state: 'closed', merged: true });
  assert.equal(selectItem(rows, issues, pulls).number, 3);
  issues.get(3).labels = [{ name: 'needs-decision' }];
  assert.equal(selectItem(rows, issues, pulls), null);
  pulls.set(2, { state: 'closed' });
  assert.throws(() => selectItem(rows, issues, pulls), /closed without merging/);
  pulls.set(2, { state: 'closed', merged: true });
  issues.delete(3);
  assert.throws(() => selectItem(rows, issues, pulls), /Missing/);
});

test('the latest required check from the required app must succeed; missing, stale and pending fail closed', () => {
  const rule = [{ context: 'quality', app_id: 10 }];
  const success = { name: 'quality', app: { id: 10 }, id: 1, status: 'completed', conclusion: 'success' };
  assert.equal(requiredChecksPass(rule, [success], []), true);
  for (const check of [{ ...success, id: 2, conclusion: 'failure' },
    { ...success, id: 2, status: 'in_progress' }, { ...success, id: 2, conclusion: 'skipped' }]) {
    assert.equal(requiredChecksPass(rule, [success, check], []), false);
  }
  assert.equal(requiredChecksPass(rule, [{ ...success, app: { id: 99 } }], []), false);
  assert.equal(requiredChecksPass(rule, [], [{ context: 'quality', state: 'success' }]), false);
  assert.equal(requiredChecksPass([], [], []), false);
  assert.equal(requiredChecksPass([{ context: 'external' }], [], [{ id: 1, context: 'external', state: 'success' }]), true);
});

test('author has no host filesystem or signing-key access and cannot escalate approval or inherit config', () => {
  const args = authorArgs('/state/author', '/runtime', ['/state', '/keys/signing.pem', '/trusted']);
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.some(value => value.includes('":root"="deny"') && value.includes('"/state/author"="write"') &&
    value.includes('"/keys/signing.pem"="deny"') && value.includes('"/trusted"="deny"')));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('author-controlled Git commands cannot install host credential helpers or redirect metadata outside the clone', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-git-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, '.git'));
  fs.writeFileSync(path.join(directory, '.git/config'), '[credential]\nhelper = !steal-host-key\n');
  sanitizeAuthorGit(directory);
  assert.ok(!fs.readFileSync(path.join(directory, '.git/config'), 'utf8').includes('helper'));
  fs.symlinkSync('/host/credentials', path.join(directory, '.git/HEAD'));
  assert.throws(() => sanitizeAuthorGit(directory), /Unsafe/);
});

test('dry run reads a queue item and its existing implementation without any writes or model calls', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  t.mock.method(cp, 'spawnSync', (binary, argv) => {
    calls.push([binary, argv]);
    assert.equal(binary, 'gh');
    assert.equal(argv[0], 'api');
    let value;
    if (argv[1] === 'graphql') value = { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false },
      nodes: [{ number: 4, closingIssuesReferences: { pageInfo: { hasNextPage: false }, nodes: [{ number: 3 }] } }] } } } };
    else if (argv[1].endsWith('/1058')) value = { state: 'open', author_association: 'OWNER',
      body: '## Ordered work items\n- [ ] #3\n\n## Standing authorization\nApproved' };
    else value = { state: 'open', labels: [] };
    return { status: 0, stdout: JSON.stringify(value) };
  });
  await new Worker({ enabled: true, state_directory: directory, signing_key: '/keys/key' }, { dryRun: true }).tick();
  assert.equal(calls.length, 3);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('queue edits during an operation and PR head/base changes stop mutations', t => {
  const worker = new Worker({ enabled: true, state_directory: '/nonexistent-test-state', signing_key: '/key' });
  worker.selection = () => ({ number: 2, isPR: false });
  assert.throws(() => worker.assertSelected({ number: 1, isPR: false }), /selection changed/);
  worker.selection = () => ({ number: 1, isPR: false });
  for (const changed of [{ head: { sha: 'new' }, base: { sha: 'base' } },
    { head: { sha: 'head' }, base: { sha: 'new' } }]) {
    worker.currentPull = () => changed;
    assert.throws(() => worker.unchanged({ number: 1, isPR: false },
      { number: 3, head: { sha: 'head' }, base: { sha: 'base' } }), /identity changed/);
  }
});

test('persistent consumed attempts prevent repeating a failed model review after restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ 'pr:4:head:base': { reviewed: true } }));
  const worker = new Worker({ enabled: true, state_directory: directory, signing_key: '/keys/key' });
  worker.currentPull = () => ({ number: 4, head: { sha: 'head' }, base: { sha: 'base' } });
  worker.reviewEvidence = async () => null;
  t.mock.method(cp, 'spawnSync', (binary, argv) => {
    assert.equal(binary, 'gh');
    let value = [[]];
    if (argv.at(-1).includes('check-runs')) value = [{ check_runs: [] }];
    if (argv.at(-1).includes('required_status_checks')) value = { contexts: ['quality'] };
    return { status: 0, stdout: JSON.stringify(value) };
  });
  await assert.rejects(worker.pull({ number: 3, isPR: false }, 4), /already consumed/);
});

test('merge requires clean evidence, current selection, successful gates and resolved threads, and binds the SHA', async t => {
  for (const scenario of ['clean', 'pending-ci', 'unresolved-thread', 'missing-evidence', 'draft', 'changed-head']) {
    await t.test(scenario, async t => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-merge-test-'));
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ 'pr:4:head:base': { refreshed: true, reviewed: true } }));
      const worker = new Worker({ enabled: true, state_directory: directory, signing_key: '/keys/key' });
      const pr = { number: 4, head: { sha: 'head' }, base: { sha: 'base' }, draft: scenario === 'draft', mergeable: true };
      worker.currentPull = () => pr;
      worker.selection = () => ({ number: 3, isPR: false });
      let evidenceCalls = 0;
      worker.reviewEvidence = async () => {
        evidenceCalls++;
        if (scenario === 'changed-head' && evidenceCalls > 1) return null;
        return scenario === 'missing-evidence' ? null : { allowed: true };
      };
      const writes = [];
      t.mock.method(cp, 'spawnSync', (binary, argv) => {
        assert.equal(binary, 'gh');
        if (argv[0] !== 'api') { writes.push(argv); return { status: 0, stdout: '' }; }
        let value;
        const endpoint = argv.at(-1);
        if (argv[1] === 'graphql') value = { data: { repository: { pullRequest: { reviewDecision: '',
          reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ isResolved: scenario !== 'unresolved-thread' }] } } } } };
        else if (endpoint.includes('required_status_checks')) value = { checks: [{ context: 'quality', app_id: 1 }] };
        else if (endpoint.includes('check-runs')) value = [{ check_runs: [
          { id: 2, name: 'quality', app: { id: 1 }, status: scenario === 'pending-ci' ? 'in_progress' : 'completed', conclusion: 'success' },
          { id: 3, name: 'security-review-completion', status: 'completed', conclusion: 'success' },
        ] }];
        else value = [[]];
        return { status: 0, stdout: JSON.stringify(value) };
      });
      if (['unresolved-thread', 'missing-evidence', 'changed-head'].includes(scenario)) {
        await assert.rejects(worker.pull({ number: 3, isPR: false }, 4));
      } else await worker.pull({ number: 3, isPR: false }, 4);
      const merges = writes.filter(argv => argv[0] === 'pr' && argv[1] === 'merge');
      assert.equal(merges.length, scenario === 'clean' ? 1 : 0);
      if (merges.length) assert.deepEqual(merges[0].slice(-2), ['--match-head-commit', 'head']);
    });
  }
});
