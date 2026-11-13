const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function workflow(name) {
  const yaml = fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8');
  const lines = yaml.match(/^\s+script: \|\n([\s\S]*)$/m)[1].trimEnd().split('\n');
  const indent = lines[0].search(/\S/);
  const script = lines.map(line => line.slice(indent)).join('\n');
  const condition = yaml.match(/    if: >-\n([\s\S]*?)(?=\n    \S)/)[1].trim();
  return { yaml, evaluate: new AsyncFunction('github', 'context', 'core', script),
    shouldRun: new Function('github', `return (${condition});`) };
}
const queue = workflow('work-queue');
const parent = workflow('issue-parent-link');
const notFound = () => Object.assign(new Error('missing'), { status: 404 });
const context = { repo: { owner: 'owner', repo: 'repo' } };
const core = failures => ({ info() {}, setFailed: message => failures.push(message) });

function fixture({ body = '## Ordered work items\n- [ ] #3\n- [ ] #4\n\n## Notes\n- [ ] #99',
  states = {}, current = [], queueState = 'open', pulls = {} } = {}) {
  const changes = [], failures = [];
  const item = number => ({ number, state: 'open', labels: [], ...states[number] });
  const github = { rest: { issues: {
    get: async ({ issue_number: number }) => {
      if (number === 1058) return { data: { state: queueState, body } };
      if (states[number] === 'missing') throw notFound();
      return { data: item(number) };
    },
    listForRepo() {},
    removeLabel: async ({ issue_number, name }) => changes.push(['remove', issue_number, name]),
    addLabels: async ({ issue_number, labels }) => changes.push(['add', issue_number, labels]),
    getLabel: async () => ({ data: {} }),
    createLabel: async ({ name }) => changes.push(['create', name]),
  }, pulls: { get: async ({ pull_number }) => ({ data: { state: 'open', ...pulls[pull_number] } }) } },
  paginate: async (_method, params) => current.filter(issue =>
    issue.labels.includes(params.labels) && (params.state === 'all' || issue.state !== 'closed')) };
  return { changes, failures, github, run: () => queue.evaluate(github, context, core(failures)) };
}

test('queue selects first eligible item and migrates obsolete markers including closed issues', async () => {
  const f = fixture({ current: [{ number: 9, state: 'closed', labels: ['queue:next', 'codex:next'] }] });
  await f.run();
  assert.deepEqual(f.changes, [['remove', 9, 'codex:next'], ['remove', 9, 'queue:next'], ['add', 3, ['queue:next']]]);
});

test('closed, blocked and needs-decision issues are skipped and headings bound the list', async () => {
  for (const state of [{ state: 'closed' }, { labels: [{ name: 'blocked' }] }, { labels: ['NEEDS-DECISION'] }]) {
    const f = fixture({ states: { 3: state } });
    await f.run();
    assert.deepEqual(f.changes, [['add', 4, ['queue:next']]]);
  }
  const f = fixture({ states: { 3: { state: 'closed' }, 4: { state: 'closed' } },
    current: [{ number: 9, labels: ['queue:next'] }] });
  await f.run();
  assert.deepEqual(f.changes, [['remove', 9, 'queue:next']]);
});

test('an open PR is a review gate; merged PRs advance; unmerged closed PRs block', async () => {
  const options = { body: '## Ordered work items\n- [ ] PR #3\n- [ ] #4',
    states: { 3: { pull_request: {}, labels: ['blocked'] } } };
  const open = fixture(options);
  await open.run();
  assert.deepEqual(open.changes, [['add', 3, ['queue:next']]]);
  const merged = fixture({ ...options, pulls: { 3: { merged: true, state: 'closed' } } });
  await merged.run();
  assert.deepEqual(merged.changes, [['add', 4, ['queue:next']]]);
  const closed = fixture({ ...options, pulls: { 3: { state: 'closed' } } });
  await closed.run();
  assert.equal(closed.failures.length, 1);
  assert.deepEqual(closed.changes, []);
});

test('stable selection is idempotent and an absent label is created', async () => {
  const stable = fixture({ states: { 3: { labels: ['queue:next'] } }, current: [{ number: 3, labels: ['queue:next'] }] });
  await stable.run();
  assert.deepEqual(stable.changes, []);
  const missing = fixture();
  missing.github.rest.issues.getLabel = async () => { throw notFound(); };
  await missing.run();
  assert.deepEqual(missing.changes, [['create', 'queue:next'], ['add', 3, ['queue:next']]]);
});

test('invalid, duplicate, missing and incorrectly typed queue rows fail before any writes', async () => {
  for (const body of ['No section', '## Ordered work items\n- [ ] #3\n- [x] #3',
    '## Ordered work items\n- [ ] #0', '## Ordered work items\n- [ ] #9007199254740993',
    '## Ordered work items\n- [ ] PR typo #3\n- [ ] #4']) {
    const f = fixture({ body });
    await f.run();
    assert.equal(f.failures.length, 1, body);
    assert.deepEqual(f.changes, []);
  }
  for (const state of ['missing', { pull_request: {} }]) {
    const f = fixture({ states: { 3: state } });
    await f.run();
    assert.equal(f.failures.length, 1);
    assert.deepEqual(f.changes, []);
  }
  const f = fixture({ body: '## Ordered work items\n- [ ] PR #3' });
  await f.run();
  assert.equal(f.failures.length, 1);
  assert.deepEqual(f.changes, []);
});

test('closed queue makes no mutations; an empty list removes obsolete markers', async () => {
  const f = fixture({ queueState: 'closed' });
  await f.run();
  assert.equal(f.failures.length, 1);
  assert.deepEqual(f.changes, []);
  const empty = fixture({ body: '## Ordered work items\n\n## Notes\n- [ ] #99',
    current: [{ number: 9, labels: ['queue:next'] }] });
  await empty.run();
  assert.deepEqual(empty.changes, [['remove', 9, 'queue:next']]);
});

test('only trusted state events, queue edits and blocking label changes allocate marker jobs', () => {
  const event = (action, number = 3, label = 'blocked', association = 'MEMBER') => ({ event_name: 'issues',
    event: { action, issue: { number, author_association: association }, label: { name: label } } });
  for (const action of ['closed', 'reopened', 'labeled', 'unlabeled']) assert.equal(queue.shouldRun(event(action)), true);
  assert.equal(queue.shouldRun(event('edited', 1058)), true);
  assert.equal(queue.shouldRun(event('edited')), false);
  for (const label of ['queue:next', 'codex:next']) {
    assert.equal(queue.shouldRun(event('labeled', 3, label)), false);
    assert.equal(queue.shouldRun(event('unlabeled', 3, label)), false);
  }
  assert.equal(queue.shouldRun({ event_name: 'workflow_dispatch' }), true);
  for (const action of ['closed', 'reopened']) assert.equal(queue.shouldRun(event(action, 3, '', 'NONE')), false);
  const pr = (association, merged) => ({ event_name: 'pull_request_target',
    event: { pull_request: { author_association: association, merged } } });
  assert.equal(queue.shouldRun(pr('NONE', false)), false);
  assert.equal(queue.shouldRun(pr('NONE', true)), true);
  assert.equal(queue.shouldRun(pr('COLLABORATOR', false)), true);
  assert.match(queue.yaml, /    concurrency:\n      group: work-queue-marker/);
});

function parentFixture({ child = {}, epic = {}, existing = null, error = null, input = '1063' } = {}) {
  const writes = [], reads = [], failures = [];
  const github = { rest: { issues: { get: async ({ issue_number }) => {
    reads.push(issue_number);
    return { data: issue_number === 1063
      ? { number: 1063, id: 987654, author_association: 'MEMBER', body: '**Parent epic:** #912', ...child }
      : { number: 912, title: 'Epic: Planning', ...epic } };
  } } }, request: async (route, params) => {
    if (route.startsWith('GET')) {
      if (error) throw error;
      if (!existing) throw notFound();
      return { data: existing };
    }
    writes.push({ route, ...params });
  } };
  return { writes, reads, failures, run: () => parent.evaluate(github,
    { ...context, eventName: 'workflow_dispatch', payload: { inputs: { issue_number: input } } }, core(failures)) };
}

test('native epic link uses global child ID and explicitly refuses replacement', async () => {
  const f = parentFixture();
  await f.run();
  assert.deepEqual(f.reads, [1063, 912]);
  assert.deepEqual(f.writes, [{ route: 'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
    owner: 'owner', repo: 'repo', issue_number: 912, sub_issue_id: 987654, replace_parent: false,
    headers: { 'X-GitHub-Api-Version': '2026-03-10' } }]);
});

test('existing parent is idempotent and a different parent cannot be replaced', async () => {
  for (const number of [912, 999]) {
    const f = parentFixture({ existing: { number } });
    await f.run();
    assert.deepEqual(f.writes, []);
    assert.equal(f.failures.length, number === 912 ? 0 : 1);
  }
});

test('untrusted/PR children and absent declarations are skipped', async () => {
  for (const child of [{ author_association: 'NONE' }, { pull_request: {} }, { body: 'No parent' }]) {
    const f = parentFixture({ child });
    await f.run();
    assert.deepEqual(f.reads, [1063]);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.failures, []);
  }
});

test('invalid IDs and non-epic parents fail without writes', async () => {
  for (const input of ['0', '-1', '9007199254740993', 'bad']) {
    const f = parentFixture({ input });
    await f.run();
    assert.equal(f.failures.length, 1);
    assert.deepEqual(f.reads, []);
  }
  for (const body of ['Parent epic: #0', 'Parent epic: #1063', 'Parent epic: #9007199254740993']) {
    const f = parentFixture({ child: { body } });
    await f.run();
    assert.equal(f.failures.length, 1);
    assert.deepEqual(f.writes, []);
  }
  for (const epic of [{ title: 'Task' }, { pull_request: {} }]) {
    const f = parentFixture({ epic });
    await f.run();
    assert.equal(f.failures.length, 1);
    assert.deepEqual(f.writes, []);
  }
});

test('unexpected parent API failures propagate instead of creating another link', async () => {
  const f = parentFixture({ error: Object.assign(new Error('forbidden'), { status: 403 }) });
  await assert.rejects(f.run, /forbidden/);
  assert.deepEqual(f.writes, []);
});

test('parent workflow filters untrusted issue events before runner allocation', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR', 'NONE']) {
    assert.equal(parent.shouldRun({ event_name: 'issues', event: { issue: { author_association: association } } }),
      association !== 'NONE');
  }
  assert.equal(parent.shouldRun({ event_name: 'workflow_dispatch' }), true);
});

test('deprecated dispatch delegates to one queue implementation and no workflow calls AI', () => {
  const legacy = fs.readFileSync('.github/workflows/codex-queue.yml', 'utf8');
  assert.match(legacy, /uses: \.\/\.github\/workflows\/work-queue.yml/);
  assert.doesNotMatch(legacy, /issues:\n|script:|pull_request_target:/);
  assert.match(queue.yaml, /  workflow_call:/);
  for (const yaml of [queue.yaml, parent.yaml, legacy]) {
    assert.doesNotMatch(yaml, /OPENAI_API_KEY|codex-action|child_process|exec\(|actions\/checkout|\brun:/);
  }
  const disabled = fs.readFileSync('.github/workflows/codex-autofix.yml', 'utf8');
  assert.doesNotMatch(disabled.split('permissions:')[0], /workflow_run:/);
  assert.match(disabled, /\n    if: false\n/);
});
