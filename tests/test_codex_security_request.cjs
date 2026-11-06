const { test } = require('node:test');
const assert = require('node:assert/strict');
const requestReview = require('../.github/scripts/request-codex-security-review.cjs');

function fixture(overrides = {}, comments = []) {
  const posted = [];
  const summary = { addHeading() { return this; }, addRaw() { return this; },
    addLink() { return this; }, async write() {} };
  const pr = { state: 'open', draft: false, labels: [],
    head: { sha: 'current-head-after-claude-fixes', repo: { full_name: 'OpenFarmPlanner/planner' } },
    ...overrides };
  return {
    posted,
    args: {
      github: {
        rest: {
          pulls: { get: async () => ({ data: pr }) },
          users: { getAuthenticated: async () => ({ data: { login: 'maintainer', type: 'User' } }) },
          issues: { listComments() {}, createComment: async input => {
            posted.push(input);
            return { data: { html_url: 'https://github.com/review-request' } };
          } },
        },
        paginate: async () => comments,
      },
      context: { repo: { owner: 'OpenFarmPlanner', repo: 'planner' },
        payload: { pull_request: { number: 123, head: { sha: 'old-event-head' } } },
        serverUrl: 'https://github.com', runId: 456 },
      core: { summary },
    },
  };
}

test('requests the native security review for the current head, with subscription identity', async () => {
  const { args, posted } = fixture();
  await requestReview(args);
  assert.equal(posted.length, 1);
  assert.ok(posted[0].body.startsWith('@codex security review\n'));
  assert.ok(posted[0].body.includes('current-head-after-claude-fixes'));
  assert.ok(!posted[0].body.includes('old-event-head'));
  assert.equal(posted[0].issue_number, 123);
});

test('reruns do not duplicate requests by the authenticated user for the same head', async () => {
  const { args, posted } = fixture({}, [{ user: { login: 'maintainer' },
    body: '<!-- codex-security-fallback:current-head-after-claude-fixes -->', html_url: 'request' }]);
  await requestReview(args);
  assert.equal(posted.length, 0);
});

test('another user cannot suppress the request with a copied marker', async () => {
  const { args, posted } = fixture({}, [{ user: { login: 'other' },
    body: '<!-- codex-security-fallback:current-head-after-claude-fixes -->' }]);
  await requestReview(args);
  assert.equal(posted.length, 1);
});

test('closed, draft, skipped and fork PRs do not receive requests', async () => {
  for (const overrides of [{ state: 'closed' }, { draft: true },
    { labels: [{ name: 'skip-claude' }] },
    { head: { sha: 'sha', repo: { full_name: 'other/planner' } } }]) {
    const { args, posted } = fixture(overrides);
    await assert.rejects(requestReview(args), /no longer eligible/);
    assert.equal(posted.length, 0);
  }
});

test('bot identity cannot silently replace the subscription user', async () => {
  const { args, posted } = fixture();
  args.github.rest.users.getAuthenticated = async () => ({ data: { type: 'Bot' } });
  await assert.rejects(requestReview(args), /personal GitHub token/);
  assert.equal(posted.length, 0);
});
