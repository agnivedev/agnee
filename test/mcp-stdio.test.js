'use strict';

/**
 * Klien MCP sungguhan lewat stdio: identitas dari AGNEE_USER_ID/AGNEE_COMPANY
 * harus sampai ke setiap alat. Dulu identitas dipasang dengan enterWith() dan
 * hilang di callback stdin, sehingga semua alat menjawab "tidak ada akun".
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

async function withBackend(fn) {
  const seen = [];
  const backend = http.createServer((request, response) => {
    seen.push({ url: request.url, company: request.headers['x-agnee-company'], user: request.headers['x-agnee-user'], key: request.headers['x-api-key'] });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ days: 7, agents: [] }));
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${backend.address().port}`, seen); } finally { backend.close(); }
}

async function callTool(baseUrl, env, name, args) {
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'uji', version: '1' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'src', 'mcp-stdio.mjs')],
    env: { ...process.env, API_KEY: 'kunci-uji', MCP_API_BASE_URL: baseUrl, ...env },
    stderr: 'ignore',
  }));
  try { return await client.callTool({ name, arguments: args }); } finally { await client.close(); }
}

test('stdio: alat laporan bertindak sebagai anggota dari env, lewat klien MCP sungguhan', async () => {
  await withBackend(async (baseUrl, seen) => {
    const result = await callTool(baseUrl, { AGNEE_USER_ID: 'user-1', AGNEE_COMPANY: 'company-1' }, 'agent_performance', { days: 14 });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assert.deepEqual(seen.map(({ url, company, user, key }) => ({ url, company, user, key })),
      [{ url: '/v1/reports/agents?days=14', company: 'company-1', user: 'user-1', key: 'kunci-uji' }]);
  });
});

test('stdio: tanpa identitas, alat menolak dan tidak memanggil backend', async () => {
  await withBackend(async (baseUrl, seen) => {
    const result = await callTool(baseUrl, { AGNEE_USER_ID: '', AGNEE_COMPANY: '' }, 'report_summary', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No Agnee account/);
    assert.equal(seen.length, 0);
  });
});
