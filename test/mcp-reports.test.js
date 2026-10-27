'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Alat MCP laporan memakai kunci layanan + identitas anggota yang sama dengan
 * alat lain: tanpa identitas tidak ada data, dan yang dipanggil hanya dua rute
 * laporan.
 */

async function setup() {
  process.env.API_KEY = 'mcp-reports-key';
  process.env.MCP_API_BASE_URL = 'http://backend.internal';
  const { buildMcpServer } = await import('../src/mcp-server.mjs');
  const { mcpContext } = await import('../src/mcp-context.mjs');
  return { buildMcpServer, mcpContext };
}

test('alat report_summary dan agent_performance terdaftar, hanya-baca, dan memanggil rute yang benar', async (t) => {
  const { buildMcpServer, mcpContext } = await setup();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return new Response(JSON.stringify({ ok: true, url: String(url) }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const server = buildMcpServer();
  const tools = server._registeredTools || server.registeredTools || {};
  const names = Object.keys(tools);
  assert.ok(names.includes('report_summary') && names.includes('agent_performance'), `alat: ${names}`);
  for (const name of ['report_summary', 'agent_performance']) {
    assert.equal(tools[name].annotations?.readOnlyHint, true, `${name} harus read-only`);
  }

  const identity = { userId: 'u-1', companyId: 'c-1', scopes: ['whatsapp:read'] };
  const run = (name, args) => mcpContext.run(identity, () => tools[name].handler(args, {}));
  const summary = await run('report_summary', {});
  assert.equal(calls[0].url, 'http://backend.internal/v1/reports/summary');
  assert.equal(calls[0].headers['x-agnee-user'], 'u-1');
  assert.equal(calls[0].headers['x-agnee-company'], 'c-1');
  assert.equal(summary.structuredContent.ok, true);

  await run('agent_performance', { days: 14 });
  assert.equal(calls[1].url, 'http://backend.internal/v1/reports/agents?days=14');

  // Tanpa identitas: tidak ada panggilan ke backend.
  await assert.rejects(() => tools.agent_performance.handler({ days: 7 }, {}), /No Agnee account/);
  assert.equal(calls.length, 2);
});

test('alat search_catalog dan list_locations: hanya-baca, rute benar, tanpa identitas tak memanggil backend', async (t) => {
  const { buildMcpServer, mcpContext } = await setup();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const tools = buildMcpServer()._registeredTools || {};
  for (const name of ['search_catalog', 'list_locations']) {
    assert.ok(tools[name], `${name} harus terdaftar`);
    assert.equal(tools[name].annotations?.readOnlyHint, true);
  }
  const identity = { userId: 'u-1', companyId: 'c-1', scopes: ['whatsapp:read'] };
  const run = (name, args) => mcpContext.run(identity, () => tools[name].handler(args, {}));
  await run('search_catalog', { query: 'semen jakarta', limit: 5 });
  assert.equal(calls[0].url, 'http://backend.internal/v1/catalog/items?limit=5&q=semen%20jakarta');
  await run('list_locations', {});
  assert.equal(calls[1].url, 'http://backend.internal/v1/locations');
  await assert.rejects(() => tools.list_locations.handler({}, {}), /No Agnee account/);
  assert.equal(calls.length, 2);
});
