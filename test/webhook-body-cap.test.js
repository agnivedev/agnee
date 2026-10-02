'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/** Body webhook yang melewati plafon ditolak 413 sebelum seluruhnya ditampung. */
test('webhook Insight menolak body di atas 2 MB', async (t) => {
  process.env.INSIGHT_WEBHOOK_SECRET = 'rahasia';
  process.env.INSIGHT_WEBHOOK_COMPANY = 'agnive';
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'cap-1' });
  delete process.env.INSIGHT_WEBHOOK_SECRET;
  delete process.env.INSIGHT_WEBHOOK_COMPANY;
  t.after(() => app.close());
  const res = await app.inject({
    method: 'POST', url: '/webhook/insight',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ pad: 'x'.repeat(3 * 1024 * 1024) }),
  });
  assert.equal(res.statusCode, 413);
});
