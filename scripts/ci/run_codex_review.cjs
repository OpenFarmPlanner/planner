// The host operator trusts this launcher and protects its signing key. PR code never runs here.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const spawnSync = (...args) => childProcess.spawnSync(...args);

const ROOT = path.resolve(__dirname, '../..');
const KEY_ID = 'martin-local-2026-11';
const MARKER = '<!-- codex-execution:v1 -->';
const SOURCES = ['scripts/ci/run_codex_review.cjs', 'scripts/ci/local_security_review.py'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function execute(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${binary} did not complete successfully.`);
  return result.stdout.trim();
}

function terminalReview(text) {
  const events = text.trim().split('\n').map(line => JSON.parse(line));
  const threads = events.filter(event => event.type === 'thread.started');
  if (threads.length !== 1 || !/^[0-9a-f-]{36}$/.test(threads[0].thread_id) ||
      events.filter(event => event.type === 'turn.started').length !== 1 ||
      events.at(-1)?.type !== 'turn.completed' ||
      events.some(event => ['error', 'turn.failed'].includes(event.type))) {
    throw new Error('Codex did not complete one fresh successful turn.');
  }
  const items = events.filter(event => event.type === 'item.completed').map(event => event.item);
  if (!items.some(item => item?.type === 'command_execution' && item.status === 'completed' && item.exit_code === 0) ||
      items.some(item => ['file_change', 'mcp_tool_call', 'web_search'].includes(item?.type))) {
    throw new Error('The reviewer did not perform a read-only local inspection.');
  }
  const message = items.filter(item => item?.type === 'agent_message').at(-1);
  return { thread: threads[0].thread_id, review: JSON.parse(message?.text ?? '') };
}

function codexRuntime() {
  let binary;
  try { binary = execute('volta', ['which', 'codex']); }
  catch { binary = execute('which', ['codex']); }
  binary = fs.realpathSync(binary);
  return binary.endsWith('.js') ? path.resolve(path.dirname(binary), '..') : binary;
}

function reviewerArgs(output, gitDirectory, runtime) {
  const filesystem = { ':root': 'deny', ':minimal': 'read', [output]: 'read',
    [gitDirectory]: 'read', [runtime]: 'read' };
  const inline = '{' + Object.entries(filesystem).map(([key, value]) =>
    `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',') + '}';
  return ['exec', '--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--json',
    '--skip-git-repo-check', '--cd', output, '--output-schema', path.join(output, 'schema.json'),
    '-c', 'approval_policy="never"', '-c', 'default_permissions="security-review"',
    '-c', `permissions.security-review.filesystem=${inline}`,
    '-c', 'permissions.security-review.network.enabled=false', '-'];
}

function providerArgs() {
  if (!process.env.OFP_QUEUE_PROXY) return [];
  const url = new URL(process.env.OFP_QUEUE_PROXY);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' ||
      url.username || url.password || url.search || url.hash) throw new Error('Invalid queue API proxy.');
  return ['-c', 'web_search="disabled"', '-c', 'model="gpt-5.4-mini"', '-c', 'model_reasoning_effort="high"',
    '-c', 'model_provider="queue"', '-c', 'model_providers.queue.name="Budgeted queue API"',
    '-c', `model_providers.queue.base_url=${JSON.stringify(url.href)}`,
    '-c', 'model_providers.queue.wire_api="responses"',
    '-c', 'model_providers.queue.request_max_retries=0',
    '-c', 'model_providers.queue.stream_max_retries=0'];
}

function run(number, output, keyFile) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR number.');
  if (!output.startsWith(os.tmpdir() + path.sep)) throw new Error('Use a new directory under /tmp.');
  if (fs.statSync(keyFile).mode & 0o077) throw new Error('The signing key must have mode 0600.');
  execute('python3', [path.join(__dirname, 'local_security_review.py'), 'prepare', String(number),
    '--output', output], { cwd: ROOT });
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  // Execute only an installed launcher/helper identical to the immutable PR base.
  const sources = {};
  for (const filename of SOURCES) {
    const installed = fs.readFileSync(path.join(ROOT, filename));
    const base = spawnSync('git', ['show', `${manifest.base}:${filename}`], { cwd: ROOT });
    if (base.status !== 0 || !installed.equals(base.stdout)) {
      throw new Error('The launcher must match the installed PR base. Update the PR from main first.');
    }
    sources[filename] = digest(installed);
  }
  const gitDirectory = execute('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: path.join(output, 'source') });
  const runtime = codexRuntime();
  if ([output, gitDirectory, runtime].some(root => keyFile === root || keyFile.startsWith(root + path.sep))) {
    throw new Error('The signing key must be outside the reviewer filesystem.');
  }
  const prompt = fs.readFileSync(path.join(output, 'prompt.txt'), 'utf8') +
    `\nYour working directory is the trusted bundle, not the PR. Use git -C ${JSON.stringify(
      path.join(output, 'source'))} and inspect that source tree. Do not access host files.
You MUST use execution tools to inspect the actual diff and source files before
returning the report. Claims without successful inspection commands are rejected.
For diff inspection use --no-ext-diff --no-textconv; never execute PR code.\n`;
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TZ', 'CODEX_HOME', 'SSL_CERT_FILE',
    'SSL_CERT_DIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_PAGER: 'cat' });
  const execution = spawnSync('codex', [...providerArgs(), ...reviewerArgs(output, gitDirectory, runtime)], {
    cwd: output, input: prompt, env, encoding: 'utf8', timeout: 30 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, 'execution.jsonl'), execution.stdout ?? '');
  fs.writeFileSync(path.join(output, 'execution.stderr'), execution.stderr ?? '');
  if (execution.error || execution.status !== 0) throw new Error('Codex failed; no completion signed.');
  const { thread, review } = terminalReview(execution.stdout);
  fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(review));
  // Recheck live head/base/scope and source cleanliness with the installed helper.
  const finish = spawnSync('python3', [path.join(__dirname, 'local_security_review.py'),
    'finish', '--output', output], { cwd: ROOT, encoding: 'utf8' });
  // Even an incomplete result is signed, so newer findings can supersede an older clean result.
  const payload = { schema: 1, provider: 'codex-local', issuer: KEY_ID,
    repository: manifest.repo, pull_request: number, head_sha: manifest.head,
    base_sha: manifest.base, scope: manifest.scope, sources, thread_id: thread,
    completed_at: new Date().toISOString(), exit_code: 0, fresh: true,
    sandbox: 'restricted-read-only', execution_sha256: digest(execution.stdout),
    prompt_sha256: digest(prompt), result: finish.status === 0 ? 'no_issues' : 'incomplete', review };
  const bytes = Buffer.from(JSON.stringify(payload));
  // Load the key only AFTER the reviewer process exits. It was never in its environment or FS grants.
  const signature = crypto.sign(null, bytes, fs.readFileSync(keyFile)).toString('base64');
  const envelope = { payload: bytes.toString('base64'), signature };
  const report = finish.status === 0 ? fs.readFileSync(path.join(output, 'report.md'), 'utf8')
    : 'Local Codex review incomplete or findings remain. See signed result below.\n';
  const body = `${report}\n${MARKER}\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`\n`;
  if (body.length > 60_000) throw new Error('Signed report exceeds GitHub comment limit.');
  fs.writeFileSync(path.join(output, 'signed-report.md'), body);
  console.log(`Signed ${payload.result} result: ${output}/signed-report.md`);
  return payload;
}

if (require.main === module) {
  try {
    const [number, output, keyFile = path.join(os.homedir(), '.config/openfarmplanner/codex-review-key.pem')] =
      process.argv.slice(2);
    run(Number(number), path.resolve(output), fs.realpathSync(keyFile));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { terminalReview, reviewerArgs, codexRuntime, run, SOURCES, MARKER, KEY_ID, providerArgs };
