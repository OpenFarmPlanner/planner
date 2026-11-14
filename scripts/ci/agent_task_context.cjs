// Run from a trusted checkout, never from the task's PR branch.
const cp = require('node:child_process');
const REPO = 'OpenFarmPlanner/planner';
const OWNER_ID = 159707412;
const OWNER_LOGIN = 'stipsitzm';

function approvedUser(user) {
  return user?.__typename === 'User' && user.databaseId === OWNER_ID && user.login === OWNER_LOGIN;
}

function approvedText(item) {
  return Object.hasOwn(item, 'lastEditedAt') && Object.hasOwn(item, 'editor') && approvedUser(item.author) && (item.lastEditedAt == null
    ? item.editor == null || approvedUser(item.editor) : approvedUser(item.editor));
}

function projectContext(item) {
  if (!item || !approvedText(item)) throw new Error('Task author or last editor is not the authorized owner.');
  if (item.labels?.pageInfo.hasNextPage) throw new Error('Task labels are truncated.');
  return {
    number: item.number, title: item.title, body: item.body, state: item.state.toLowerCase(),
    updated_at: item.updatedAt, user: { id: OWNER_ID, login: OWNER_LOGIN },
    labels: item.labels?.nodes ?? [],
    ...(item.__typename === 'PullRequest' ? { pull_request: {} } : {}),
    comments: (item.comments?.nodes ?? []).filter(approvedText).map(comment => ({ body: comment.body })),
  };
}

function github(...args) {
  const result = cp.spawnSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Cannot verify GitHub task context.');
  const value = JSON.parse(result.stdout);
  if (value.errors) throw new Error('Incomplete GitHub task context.');
  return value;
}

function readTask(number, { comments = false } = {}) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid task number.');
  const permission = github(`repos/${REPO}/collaborators/${OWNER_LOGIN}/permission`);
  if (permission.user?.id !== OWNER_ID || !['admin', 'maintain', 'write'].includes(permission.permission)) {
    throw new Error('The authorized owner no longer has repository write access.');
  }
  const person = '{ __typename login ... on User { databaseId } }';
  const fields = `__typename number title body state updatedAt lastEditedAt author ${person} editor ${person}
    labels(first:100) { pageInfo { hasNextPage } nodes { name } }
    comments(first:100,after:$cursor) @include(if:$comments) {
      pageInfo { hasNextPage endCursor } nodes { body lastEditedAt author ${person} editor ${person} }
    }`;
  const query = `query($number:Int!,$comments:Boolean!,$cursor:String) {
    repository(owner:"OpenFarmPlanner",name:"planner") { issueOrPullRequest(number:$number) {
      ... on Issue { ${fields} } ... on PullRequest { ${fields} }
    } }
  }`;
  let cursor = null, context = null, revision = null;
  const seen = new Set();
  do {
    const args = ['graphql', '-f', `query=${query}`, '-F', `number=${number}`, '-F', `comments=${comments}`];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const item = github(...args).data?.repository?.issueOrPullRequest;
    const page = projectContext(item);
    if (revision !== null && revision !== item.updatedAt) throw new Error('Task changed during context collection.');
    revision = item.updatedAt;
    if (context) context.comments.push(...page.comments);
    else context = page;
    if (item.comments?.pageInfo.hasNextPage && !item.comments.pageInfo.endCursor) throw new Error('Missing comment cursor.');
    cursor = item.comments?.pageInfo.hasNextPage ? item.comments.pageInfo.endCursor : null;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('Incomplete comment pagination.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return context;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/ci/agent_task_context.cjs ISSUE_OR_PR_NUMBER');
    process.stdout.write(JSON.stringify(readTask(Number(process.argv[2]), { comments: true }), null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { approvedUser, approvedText, projectContext, readTask };
