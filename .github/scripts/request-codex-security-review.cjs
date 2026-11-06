module.exports = async function requestReview({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue_number = context.payload.pull_request.number;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: issue_number });
  if (pr.state !== 'open' || pr.draft || pr.head.repo?.full_name !== `${owner}/${repo}` ||
      pr.labels.some(label => label.name === 'skip-claude')) {
    throw new Error('The pull request is no longer eligible for a security review.');
  }
  // Claude's code review may have pushed fixes since the triggering event.
  const sha = pr.head.sha;
  const marker = `<!-- codex-security-fallback:${sha} -->`;
  const { data: user } = await github.rest.users.getAuthenticated();
  if (user.type !== 'User') {
    throw new Error('Codex subscription reviews require a personal GitHub token for a linked user.');
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number, per_page: 100,
  });
  let comment = comments.find(item => item.user?.login === user.login && item.body?.includes(marker));
  if (!comment) {
    const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
    const body = [
      '@codex security review',
      '',
      'Claude exhausted its usage allowance. Please perform the fallback security review.',
      `Requested commit: ${sha}`,
      `Workflow: ${run}`,
      '',
      'Follow AGENTS.md, CLAUDE.md and the security decisions in docs/security-automation.md.',
      'This is a review request; it does not mean the review has completed or found no issues.',
      marker,
    ].join('\n');
    ({ data: comment } = await github.rest.issues.createComment({ owner, repo, issue_number, body }));
  }
  await core.summary
    .addHeading('Codex Security Review requested')
    .addRaw(`Commit: ${sha}\n\n`)
    .addLink('Review request', comment.html_url)
    .addRaw('\n\nUses the linked ChatGPT/Codex allowance, without an OpenAI API key. ' +
      'Review runs asynchronously in Codex. Check the Codex task and Security Report for completion; ' +
      'this job only confirms that the request was posted. Findings require follow-up fixes.\n')
    .write();
};
