// Trusted controller only: repository code runs in the worker's restricted sandbox.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
const { Readable } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const REPO = 'OpenFarmPlanner/ops';
const BRANCH = 'cloud-work-queue-state';
const MODEL = 'gpt-5.4-mini';
const RUN_LIMIT = 1_000_000, DAY_LIMIT = 2_000_000, MONTH_LIMIT = 10_000_000;

function gh(...args) {
  return JSON.parse(cp.execFileSync('gh', ['api', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
}
function statePath(file) {
  const name = path.basename(file);
  if (!['state.json', 'budget.json'].includes(name)) throw new Error('Invalid cloud state file.');
  return `repos/${REPO}/contents/.queue/${name}`;
}
function loadState(file) {
  const endpoint = statePath(file);
  // Missing files are initialized deliberately before enabling the workflow;
  // API errors must never reset retry or spending limits.
  const value = gh(`${endpoint}?ref=${BRANCH}`);
  if (value.encoding !== 'base64') throw new Error('Cloud state unavailable.');
  const bytes = Buffer.from(value.content, 'base64');
  JSON.parse(bytes);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
}
function saveState(file) {
  const endpoint = statePath(file);
  const previous = gh(`${endpoint}?ref=${BRANCH}`);
  const body = file + '.request';
  fs.writeFileSync(body, JSON.stringify({ branch: BRANCH, sha: previous.sha,
    message: `chore: persist queue ${path.basename(file)}`,
    content: fs.readFileSync(file).toString('base64') }), { mode: 0o600 });
  try { gh('--method', 'PUT', endpoint, '--input', body); }
  finally { fs.rmSync(body, { force: true }); }
}

function localTool(tool) {
  return ['function', 'custom'].includes(tool.type) ||
    tool.type === 'namespace' && Array.isArray(tool.tools) && tool.tools.every(localTool);
}
function normalizeRequest(body) {
  // Codex advertises discovery even with no deferred tools. Omit this hosted
  // capability; the model still receives all local shell/patch definitions.
  body = { ...body, tools: (body.tools ?? []).filter(tool => tool.type !== 'tool_search') };
  if (body.model !== MODEL || body.previous_response_id || body.conversation || body.background ||
      !Array.isArray(body.input) || (body.tools ?? []).some(tool => !localTool(tool))) {
    throw new Error('Only stateless coding requests without hosted tools are allowed.');
  }
  // Fixed provider, model, processing tier and output cap keep reservations bounded.
  const allowed = ['instructions', 'input', 'tools', 'parallel_tool_calls', 'reasoning', 'text', 'tool_choice', 'include', 'stream'];
  return { ...Object.fromEntries(allowed.filter(key => key in body).map(key => [key, body[key]])),
    model: MODEL, service_tier: 'default', store: false, max_output_tokens: 8192 };
}
function reserve(budget, input, now = new Date()) {
  if (!Number.isSafeInteger(input) || input < 1 || input > 200_000) throw new Error('Invalid input token count.');
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  const cost = Math.ceil(input * 0.75 + 8192 * 4.5); // USD millionths; uncached list prices.
  const daily = budget.day === day ? budget.daily : 0;
  const monthly = budget.month === month ? budget.monthly : 0;
  if (![daily, monthly, budget.run ?? 0].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid budget ledger.');
  if (daily + cost > DAY_LIMIT || monthly + cost > MONTH_LIMIT || (budget.run ?? 0) + cost > RUN_LIMIT) {
    throw new Error('Queue API spending limit reached.');
  }
  return { day, month, daily: daily + cost, monthly: monthly + cost, run: (budget.run ?? 0) + cost };
}

function usageCost(response, countedInput) {
  const usage = response?.usage;
  if (response?.status !== 'completed' || response.service_tier !== 'default' ||
      ![MODEL, MODEL + '-2026-03-17'].includes(response.model) || !usage) return null;
  const input = usage.input_tokens, output = usage.output_tokens;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if (![input, output, cached].every(n => Number.isSafeInteger(n) && n >= 0) ||
      input < 1 || input > countedInput || output > 8192 || cached > input) return null;
  // Output already includes reasoning. No hosted tools are allowed by this proxy.
  return Math.ceil((input - cached) * 0.75 + cached * 0.075 + output * 4.5);
}

function usageCollector(streaming) {
  const decoder = new StringDecoder('utf8');
  let pending = '', response = null, completed = 0, invalid = false;
  const line = value => {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim();
    if (data === '[DONE]') return;
    try {
      const event = JSON.parse(data);
      if (event.type === 'response.completed') { response = event.response; completed++; }
      if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) invalid = true;
    } catch { invalid = true; }
  };
  return {
    write(chunk) {
      if (invalid) return;
      pending += decoder.write(chunk);
      if (pending.length > 2 * 1024 * 1024) { invalid = true; pending = ''; return; }
      if (streaming) {
        let boundary;
        while ((boundary = pending.indexOf('\n')) !== -1) {
          line(pending.slice(0, boundary)); pending = pending.slice(boundary + 1);
        }
      }
    },
    finish() {
      if (invalid) return null;
      pending += decoder.end();
      if (!streaming) {
        try { return JSON.parse(pending); } catch { return null; }
      }
      if (pending) line(pending);
      return !invalid && completed === 1 ? response : null;
    },
  };
}

function settle(ledger, reservation, reservedCost, actualCost) {
  if (!Number.isSafeInteger(actualCost) || actualCost < 0 || actualCost > reservedCost) return null;
  const refund = reservedCost - actualCost;
  const next = { ...ledger, run: ledger.run - refund };
  if (ledger.day === reservation.day) next.daily -= refund;
  if (ledger.month === reservation.month) next.monthly -= refund;
  if (![next.run, next.daily, next.monthly].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  return next;
}

function executionFailure(transcript, diagnostics, secret) {
  const failures = transcript.split('\n').flatMap(line => {
    try {
      const event = JSON.parse(line);
      return event.type === 'error' ? [event.message] : event.type === 'turn.failed' ? [event.error?.message] : [];
    } catch { return []; }
  }).filter(value => typeof value === 'string');
  return JSON.stringify((failures.at(-1) || diagnostics || 'CLI exited without a terminal error report.')
    .replaceAll(secret, '[redacted]').slice(-4000));
}

function inspectionDiagnostics(transcript, secret) {
  const items = transcript.split('\n').flatMap(line => {
    try {
      const event = JSON.parse(line);
      if (event.type !== 'item.completed') return [];
      const item = event.item;
      return [{ type: item.type, status: item.status, exit_code: item.exit_code,
        command: item.command, output: item.aggregated_output?.slice(-2000), text: item.text?.slice(-1000) }];
    } catch { return []; }
  });
  return JSON.stringify(items).replaceAll(secret, '[redacted]').slice(-6000);
}

function createProxy({ apiKey, ledger, persist, fetcher = fetch }) {
  let tail = Promise.resolve(), queued = 0;
  return http.createServer(async (req, res) => {
    if (queued >= 4 || req.method !== 'POST' || req.url !== '/v1/responses') {
      res.writeHead(403).end('Unsupported queue API request.'); return;
    }
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; }); queued++;
    // Codex may send its next request as soon as it sees a terminal event.
    // Serialize that request behind durable reconciliation of this response.
    await previous;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) throw new Error('Queue API input too large.');
        chunks.push(chunk);
      }
      const body = normalizeRequest(JSON.parse(Buffer.concat(chunks)));
      const countBody = Object.fromEntries(['model', 'instructions', 'input', 'tools', 'tool_choice', 'parallel_tool_calls', 'reasoning', 'text']
        .filter(key => key in body).map(key => [key, body[key]]));
      const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      const counted = await fetcher('https://api.openai.com/v1/responses/input_tokens', {
        method: 'POST', headers, body: JSON.stringify(countBody), signal: AbortSignal.timeout(60_000),
      });
      if (!counted.ok) throw new Error(`Token counting failed (${counted.status}); inference was not started.`);
      const input = (await counted.json()).input_tokens;
      const next = reserve(ledger, input);
      const reservedCost = next.run - (ledger.run ?? 0);
      // Reserve durably before inference. Missing/untrusted usage keeps this charge.
      await persist(next); Object.assign(ledger, next);
      const upstream = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!upstream.ok) {
        const detail = await upstream.clone().json().catch(() => ({}));
        const code = detail.error?.code ?? detail.error?.type;
        console.error(`Queue API rejected inference: HTTP ${upstream.status}, code ${/^[a-z_]{1,80}$/.test(code) ? code : 'unknown'}.`);
      }
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      const collector = usageCollector((upstream.headers.get('content-type') ?? '').includes('text/event-stream'));
      let ended = false;
      await new Promise((resolve, reject) => {
        const stream = Readable.fromWeb(upstream.body);
        stream.on('data', chunk => collector.write(chunk));
        stream.on('end', () => { ended = true; });
        stream.on('error', reject); res.on('finish', resolve); res.on('close', resolve); stream.pipe(res);
      });
      if (upstream.ok && ended && res.writableFinished) {
        const reported = collector.finish();
        const actual = usageCost(reported, input);
        const reconciled = settle(ledger, next, reservedCost, actual);
        if (reconciled) {
          await persist(reconciled); Object.assign(ledger, reconciled);
          console.log(`Queue model-token usage accounted: $${(actual / 1_000_000).toFixed(6)}.`);
        } else {
          console.log(JSON.stringify({ event: 'queue_reservation_retained', counted_input: input,
            model: reported?.model, tier: reported?.service_tier, usage: reported?.usage }));
        }
      }
    } catch (error) {
      // Never return provider bodies, request content or secrets in logs/errors.
      console.error(error.message.replaceAll(apiKey, '[redacted]'));
      if (!res.writableEnded) {
        if (!res.headersSent) res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Queue API request refused; inspect trusted controller logs.', type: 'queue_limit' } }));
      }
    } finally { queued--; release(); }
  });
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== 'OpenFarmPlanner/planner' || process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' && process.env.GITHUB_EVENT_NAME !== 'schedule') {
    throw new Error('Cloud worker requires a trusted main-branch schedule or manual dispatch.');
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !process.env.GH_TOKEN || !process.env.OFP_QUEUE_SIGNING_KEY) throw new Error('Cloud credentials unavailable.');
  const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'ofp-cloud-'));
  const state = path.join(directory, 'state.json'), budgetFile = path.join(directory, 'budget.json');
  loadState(state); loadState(budgetFile);
  const ledger = JSON.parse(fs.readFileSync(budgetFile)); ledger.run = 0;
  const server = createProxy({ apiKey, ledger, persist: next => {
    fs.writeFileSync(budgetFile, JSON.stringify(next), { mode: 0o600 }); saveState(budgetFile);
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const key = path.join(directory, 'signing.pem');
  fs.writeFileSync(key, process.env.OFP_QUEUE_SIGNING_KEY, { mode: 0o600 });
  const config = path.join(directory, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ enabled: true, state_directory: directory, signing_key: key }), { mode: 0o600 });
  const env = { ...process.env, OFP_QUEUE_CLOUD: '1', OFP_QUEUE_PROXY: `http://127.0.0.1:${server.address().port}/v1` };
  delete env.OPENAI_API_KEY; delete env.OFP_QUEUE_SIGNING_KEY;
  try {
    if (process.env.OFP_QUEUE_MODE === 'verify') {
      const fixture = path.join(directory, 'fixture'); fs.mkdirSync(fixture);
      fs.writeFileSync(path.join(fixture, 'source.txt'), 'Cloud queue sandbox fixture.');
      fs.writeFileSync(path.join(directory, 'protected-marker'), 'Host-only marker.');
      const { reviewerArgs, codexRuntime, providerArgs, terminalReview } = require('./run_codex_review.cjs');
      process.env.OFP_QUEUE_PROXY = env.OFP_QUEUE_PROXY;
      const prompt = 'Use the execution tool to run cat source.txt and verify that ../protected-marker cannot be read. '
        + 'Return exactly JSON {"ok":true} only if the source is readable and the protected file is denied. Do not edit files.';
      fs.writeFileSync(path.join(fixture, 'schema.json'), JSON.stringify({ type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean' } }, required: ['ok'] }));
      const safeEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
        .filter(key => process.env[key]).map(key => [key, process.env[key]]));
      let transcript = '', diagnostics = '';
      await new Promise((resolve, reject) => {
        const args = reviewerArgs(fixture, path.join(fixture, 'source.txt'), codexRuntime());
        args.splice(1, 0, ...providerArgs());
        const child = cp.spawn('codex', args,
          { cwd: fixture, env: safeEnv, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.end(prompt);
        child.stdout.on('data', data => { transcript += data; });
        child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-8000); });
        child.on('error', reject);
        child.on('exit', code => {
          if (code === 0) return resolve();
          // This fixture session has no credential environment or secret filesystem grants.
          const detail = executionFailure(transcript, diagnostics, apiKey);
          reject(new Error(`Cloud model/sandbox verification failed (${code}): ${detail}`));
        });
      });
      try {
        if (terminalReview(transcript).review.ok !== true) throw new Error('Cloud fixture verification incomplete.');
      } catch (error) {
        throw new Error(`${error.message} Fixture evidence: ${inspectionDiagnostics(transcript, apiKey)}`);
      }
      console.log('Cloud credentials, durable state, budgeted API and restricted reviewer verified.');
      return;
    }
    // Each invocation performs one bounded transition; the schedule resumes from durable state.
    await new Promise((resolve, reject) => {
      const child = cp.spawn(process.execPath, [path.join(__dirname, 'work_queue_worker.cjs'), config], { env, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Queue transition failed (${code}).`)));
    });
  } finally { server.closeAllConnections(); server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { loadState, saveState, normalizeRequest, reserve, usageCost, usageCollector, settle, createProxy, executionFailure, inspectionDiagnostics };
