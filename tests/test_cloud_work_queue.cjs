const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const { once } = require('node:events');
const { normalizeRequest, reserve, createProxy } = require('../scripts/ci/cloud_work_queue.cjs');
const { providerArgs } = require('../scripts/ci/run_codex_review.cjs');
const request = { model: 'gpt-5.4-mini', input: [{ role: 'user', content: 'Inspect source' }], tools: [] };

test('API requests cannot change model/tier/cost cap, use hidden conversation or call hosted tools', () => {
  assert.equal(normalizeRequest({ ...request, service_tier: 'priority', max_output_tokens: 100000 }).service_tier, 'default');
  assert.equal(normalizeRequest(request).max_output_tokens, 8192);
  for (const extra of [{ model: 'expensive' }, { previous_response_id: 'hidden' }, { conversation: 'hidden' },
    { tools: [{ type: 'web_search' }] }, { tools: [{ type: 'code_interpreter' }] }]) {
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
