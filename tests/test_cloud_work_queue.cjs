const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const { once } = require('node:events');
const { normalizeRequest, reserve, usageCost, usageCollector, settle, createProxy, executionFailure, inspectionDiagnostics } = require('../scripts/ci/cloud_work_queue.cjs');
const { providerArgs } = require('../scripts/ci/run_codex_review.cjs');
const request = { model: 'gpt-5.4-mini', input: [{ role: 'user', content: 'Inspect source' }], tools: [] };
const completed = changes => ({ status: 'completed', model: 'gpt-5.4-mini-2026-03-17', service_tier: 'default',
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 }, output_tokens: 100 }, ...changes });

test('confirmed usage charges cached inputs and total outputs; invalid/incomplete evidence keeps the reservation', () => {
  assert.equal(usageCost(completed(), 1000), 660);
  for (const response of [completed({ status: 'incomplete' }), completed({ service_tier: 'priority' }),
    completed({ model: 'other' }), completed({ usage: null }),
    ...[{ input_tokens: 1001 }, { output_tokens: 8193 }, { output_tokens: -1 }, { input_tokens: 0 },
      { input_tokens_details: { cached_tokens: 1001 } }].map(change => completed({ usage: { ...completed().usage, ...change } }))]) {
    assert.equal(usageCost(response, 1000), null);
  }
});

test('fragmented SSE confirms exactly one completed response; missing, duplicated and failed terminal events do not refund', () => {
  const event = response => `event: response.completed\r\ndata: ${JSON.stringify({ type: 'response.completed', response })}\r\n\r\n`;
  const text = event(completed());
  const collector = usageCollector(true);
  for (let i = 0; i < text.length; i += 7) collector.write(Buffer.from(text.slice(i, i + 7)));
  assert.deepEqual(collector.finish(), completed());
  for (const text of ['', 'data: invalid\n\n', event(completed()) + event(completed()),
    event(completed()) + 'data: {"type":"response.failed"}\n\n']) {
    const missing = usageCollector(true); missing.write(Buffer.from(text)); assert.equal(missing.finish(), null);
  }
  const plain = usageCollector(false); plain.write(Buffer.from(JSON.stringify(completed())));
  assert.deepEqual(plain.finish(), completed());
});

test('reconciliation only releases verified unused reservation from its matching budget periods', () => {
  const held = reserve({}, 1000, new Date('2026-11-13'));
  const cost = held.run;
  assert.equal(settle(held, held, cost, 660).daily, 660);
  assert.equal(settle(held, held, cost, null), null);
  assert.equal(settle(held, held, cost, cost + 1), null);
  const later = { ...held, day: '2026-11-14', daily: 10, month: '2026-12', monthly: 10 };
  const result = settle(later, held, cost, 660);
  assert.equal(result.daily, 10); assert.equal(result.monthly, 10); assert.equal(result.run, 660);
});

test('fast follow-up requests wait for durable reconciliation and can use the returned reservation', async t => {
  const ledger = {}, snapshots = [];
  let inference = 0, release;
  let notifyStart, notifyFinish;
  const saving = new Promise(resolve => { notifyStart = resolve; });
  const finished = new Promise(resolve => { notifyFinish = resolve; });
  const proxy = createProxy({ apiKey: 'test-secret', ledger, persist: async next => {
    snapshots.push({ ...next });
    if (snapshots.length === 2) { notifyStart(); await new Promise(resolve => { release = resolve; }); }
    if (snapshots.length === 4) notifyFinish();
  }, fetcher: async url => {
    if (url.endsWith('input_tokens')) return Response.json({ input_tokens: 1000 });
    inference++;
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: completed() })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const url = `http://127.0.0.1:${proxy.address().port}/v1/responses`;
  const first = await fetch(url, { method: 'POST', body: JSON.stringify(request) }); await first.text(); await saving;
  const second = fetch(url, { method: 'POST', body: JSON.stringify(request) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inference, 1);
  release();
  const response = await second; assert.equal(response.status, 200); await response.text(); await finished;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ledger.daily, 1320);
  assert.equal(ledger.run, 1320);
  assert.equal(snapshots.length, 4);
  assert.ok(snapshots[0].daily > snapshots[1].daily);
});

test('failed usage write-back retains the full reservation for the next request', async t => {
  const ledger = {}; let saves = 0, done;
  const attempted = new Promise(resolve => { done = resolve; });
  const proxy = createProxy({ apiKey: 'test-secret', ledger, persist: () => {
    if (++saves === 2) { done(); throw new Error('Reconciliation storage unavailable'); }
  }, fetcher: async url => url.endsWith('input_tokens') ? Response.json({ input_tokens: 1000 }) : Response.json(completed()) });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const response = await fetch(`http://127.0.0.1:${proxy.address().port}/v1/responses`, { method: 'POST', body: JSON.stringify(request) });
  await response.text(); await attempted;
  assert.equal(ledger.run, reserve({}, 1000).run);
});

test('API requests cannot change model/tier/cost cap, use hidden conversation or call hosted tools', () => {
  assert.equal(normalizeRequest({ ...request, service_tier: 'priority', max_output_tokens: 100000 }).service_tier, 'default');
  assert.equal(normalizeRequest(request).max_output_tokens, 8192);
  assert.deepEqual(normalizeRequest({ ...request, tools: [{ type: 'tool_search' }, { type: 'function', name: 'shell' }] }).tools, [{ type: 'function', name: 'shell' }]);
  assert.doesNotThrow(() => normalizeRequest({ ...request, tools: [{ type: 'namespace', tools: [{ type: 'function', name: 'shell' }] }] }));
  for (const extra of [{ model: 'expensive' }, { previous_response_id: 'hidden' }, { conversation: 'hidden' },
    { tools: [{ type: 'web_search' }] }, { tools: [{ type: 'code_interpreter' }] }, { tools: [{ type: 'namespace', tools: [{ type: 'web_search' }] }] }]) {
    assert.throws(() => normalizeRequest({ ...request, ...extra }));
  }
});

test('worst-case reservations survive restarts and enforce run/day/month caps before inference', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const empty = { day: '2026-11-13', month: '2026-11', daily: 0, monthly: 0, run: 0 };
  const charged = reserve(empty, 100000, now);
  assert.equal(charged.daily, 111864);
  assert.equal(charged.monthly, charged.daily);
  for (const invalid of [NaN, -1, 0, 200001]) assert.throws(() => reserve(empty, invalid, now));
  for (const changes of [{ run: 999999 }, { daily: 1999999 }, { monthly: 9999999 }, { daily: NaN }]) {
    assert.throws(() => reserve({ ...empty, ...changes }, 100000, now));
  }
  const nextDay = reserve({ ...empty, daily: 1999999, monthly: 300000 }, 100000, new Date('2026-11-14'));
  assert.equal(nextDay.monthly, 411864);
  assert.equal(nextDay.daily, 111864);
});

test('proxy persists reservation before forwarding and never passes real API credentials to its caller', async t => {
  const calls = [];
  const proxy = createProxy({ apiKey: 'test-secret', ledger: {}, persist: next => { calls.push('saved'); assert.ok(next.daily > 0); },
    fetcher: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-secret');
      calls.push(url.endsWith('input_tokens') ? 'count' : 'inference');
      if (url.endsWith('input_tokens')) return Response.json({ input_tokens: 100 });
      assert.equal(calls.at(-2), 'saved');
      return new Response('data: done\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    } });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const url = `http://127.0.0.1:${proxy.address().port}/v1/responses`;
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(request) });
  assert.equal(response.status, 200); assert.equal(await response.text(), 'data: done\n\n');
  assert.deepEqual(calls, ['count', 'saved', 'inference']);
  const refused = await fetch(url + '/compact', { method: 'POST', body: '{}' });
  assert.equal(refused.status, 403); assert.equal(calls.length, 3);
});

test('failed durable save and exhausted ledger never reach billable inference', async t => {
  for (const saveFails of [false, true]) {
    let inference = false;
    const proxy = createProxy({ apiKey: 'test-secret', ledger: saveFails ? {} : { month: new Date().toISOString().slice(0, 7), monthly: 10000000 },
      persist: () => { throw new Error('State unavailable'); }, fetcher: async url => {
        if (!url.endsWith('input_tokens')) inference = true;
        return Response.json({ input_tokens: 100 });
      } });
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    t.after(() => { proxy.closeAllConnections(); proxy.close(); });
    const result = await fetch(`http://127.0.0.1:${proxy.address().port}/v1/responses`, { method: 'POST', body: JSON.stringify(request) });
    assert.equal(result.status, 403); assert.equal(inference, false);
    assert.ok(!(await result.text()).includes('test-secret'));
  }
});

test('cloud provider is loopback-only and contains no API or GitHub credentials', t => {
  const previous = process.env.OFP_QUEUE_PROXY;
  t.after(() => { if (previous === undefined) delete process.env.OFP_QUEUE_PROXY; else process.env.OFP_QUEUE_PROXY = previous; });
  process.env.OFP_QUEUE_PROXY = 'http://127.0.0.1:12345/v1';
  assert.ok(providerArgs().includes('model="gpt-5.4-mini"'));
  for (const url of ['https://api.openai.com/v1', 'http://localhost/v1', 'http://127.0.0.1/v1?key=secret']) {
    process.env.OFP_QUEUE_PROXY = url; assert.throws(providerArgs);
  }
});

test('workflow has no PR trigger or PR checkout and serializes all runs', () => {
  const source = fs.readFileSync('.github/workflows/cloud-work-queue.yml', 'utf8');
  assert.ok(source.includes('group: cloud-work-queue'));
  assert.ok(source.includes('persist-credentials: false'));
  assert.ok(source.includes("vars.CLOUD_WORK_QUEUE_ENABLED == 'true'"));
  assert.ok(!source.includes('pull_request:'));
  assert.ok(!source.includes('pull_request_target:'));
  assert.ok(!source.includes('actions/cache'));
});


test('JSON-mode CLI errors remain actionable when stderr is empty, without logging keys or workflow commands', () => {
  const transcript = [{ type: 'thread.started' }, { type: 'error', message: 'Retrying' },
    { type: 'turn.failed', error: { message: 'insufficient_quota key-secret\n::warning::untrusted' } }]
    .map(row => JSON.stringify(row)).join('\n');
  const detail = executionFailure(transcript, '', 'key-secret');
  assert.ok(detail.includes('insufficient_quota'));
  assert.ok(!detail.includes('key-secret'));
  assert.ok(!detail.includes('\n'));
  assert.ok(executionFailure('', 'startup failure', 'key-secret').includes('startup failure'));
});


test('fixture inspection failures expose command exit/output and final result without secrets or raw event injection', () => {
  const events = [
    { type: 'item.completed', item: { type: 'command_execution', status: 'completed', exit_code: 1,
      command: 'cat source.txt', aggregated_output: 'sandbox unavailable key-secret\n::warning::untrusted' } },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"ok":false}' } },
  ].map(row => JSON.stringify(row)).join('\n');
  const detail = inspectionDiagnostics(events, 'key-secret');
  assert.ok(detail.includes('sandbox unavailable'));
  assert.ok(detail.includes('"exit_code":1'));
  assert.ok(detail.includes('ok'));
  assert.ok(!detail.includes('key-secret'));
  assert.ok(!detail.includes('\n'));
});
