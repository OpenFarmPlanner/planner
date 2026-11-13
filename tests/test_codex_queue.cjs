const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = fs.readFileSync('.github/workflows/codex-queue.yml', 'utf8');
const lines = yaml.match(/^\s+script: \|\n([\s\S]*)$/m)[1].trimEnd().split('\n');
const indent = lines[0].search(/\S/);
const script = lines.map(line => line.slice(indent)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const evaluate = new AsyncFunction('github', 'context', 'core', script);
const condition = yaml.match(/if: >-\n([\s\S]*?)\n    runs-on:/)[1].trim();
const shouldRun = new Function('github', `return (${condition});`);

function fixture({ body = '## Ordered implementation issues\n- [ ] #3\n- [ ] #4\n\n## Notes\n- [ ] #99',
  states = {}, current = [], queueState = 'open' } = {}) {
  const changes = [], failures = [];
  const github = { rest: { issues: {
    get: async ({ issue_number: number }) => {
      if (number === 1058) return { data: { state: queueState, body } };
      if (states[number] === 'missing') throw Object.assign(new Error('missing'), { status: 404 });
      return { data: { number, state: 'open', labels: [], ...states[number] } };
    },
    listForRepo() {},
    removeLabel: async ({ issue_number }) => changes.push(['remove', issue_number]),
    addLabels: async ({ issue_number, labels }) => changes.push(['add', issue_number, labels]),
    getLabel: async () => { throw Object.assign(new Error('missing'), { status: 404 }); },
    createLabel: async ({ name }) => changes.push(['create', name]),
  } }, paginate: async () => current };
  return { changes, failures, run: () => evaluate(github, { repo: { owner: 'owner', repo: 'repo' } },
    { warning() {}, info() {}, setFailed: message => failures.push(message) }) };
}

test('queue selects the first eligible listed issue and replaces the previous label', async () => {
  const f = fixture({ current: [{ number: 9 }] });
  await f.run();
  assert.deepEqual(f.changes, [['remove', 9], ['create', 'codex:next'], ['add', 3, ['codex:next']]]);
});

test('closed, blocked, needs-decision, PR and missing entries are skipped; headings bound the list', async () => {
  for (const state of [{ state: 'closed' }, { labels: [{ name: 'blocked' }] },
    { labels: ['NEEDS-DECISION'] }, { pull_request: {} }, 'missing']) {
    const f = fixture({ states: { 3: state } });
    await f.run();
    assert.ok(f.changes.some(item => item[0] === 'add' && item[1] === 4));
  }
  const f = fixture({ states: { 3: { state: 'closed' }, 4: { state: 'closed' } }, current: [{ number: 9 }] });
  await f.run();
  assert.deepEqual(f.changes, [['remove', 9]]);
});

test('a stable queue is idempotent and duplicate/missing queue data causes no label writes', async () => {
  const stable = fixture({ current: [{ number: 3 }] });
  await stable.run();
  assert.deepEqual(stable.changes, []);
  for (const body of ['No ordered section', '## Ordered implementation issues\n- [ ] #3\n- [x] #3']) {
    const f = fixture({ body, current: [{ number: 9 }] });
    await f.run();
    assert.equal(f.failures.length, 1);
    assert.deepEqual(f.changes, []);
  }
});

test('closing the queue performs no mutations and unlisted issue numbers are never chosen', async () => {
  const f = fixture({ queueState: 'closed', current: [{ number: 9 }] });
  await f.run();
  assert.deepEqual(f.changes, []);
  const empty = fixture({ body: '## Ordered implementation issues\nNo items\n\n## Notes\n- [ ] #99' });
  await empty.run();
  assert.deepEqual(empty.changes, []);
});

test('blocking-label changes refresh the marker without reacting to its own codex:next changes', () => {
  const event = (action, number = 3, label = 'blocked') => ({ event_name: 'issues',
    event: { action, issue: { number }, label: { name: label } } });
  for (const action of ['closed', 'reopened', 'labeled', 'unlabeled']) assert.equal(shouldRun(event(action)), true);
  assert.equal(shouldRun(event('edited', 1058)), true);
  assert.equal(shouldRun(event('edited')), false);
  assert.equal(shouldRun(event('labeled', 3, 'codex:next')), false);
  assert.equal(shouldRun(event('unlabeled', 3, 'codex:next')), false);
  assert.equal(shouldRun({ event_name: 'workflow_dispatch' }), true);
});

test('no AI invocation is added and the former API-billed autofix cannot run', () => {
  assert.doesNotMatch(yaml, /OPENAI_API_KEY|codex-action|child_process|exec\(/);
  const disabled = fs.readFileSync('.github/workflows/codex-autofix.yml', 'utf8');
  assert.doesNotMatch(disabled.split('permissions:')[0], /workflow_run:/);
  assert.match(disabled, /\n    if: false\n/);
});
