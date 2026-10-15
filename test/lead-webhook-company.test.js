'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');

/*
 * Webhook lead universal per company: /webhook/company/:company/lead dan
 * /lead-verify, secret dan template milik company masing-masing, tanpa
 * jejak Bull Babe. Pengaturannya lewat /v1/integrations/lead-webhook.
 */

const owner = { id: 'owner-1', companyId: 'c-acme', email: 'own@acme.test', displayName: 'Owner', role: 'owner' };
const sign = (body, secret, timestamp = Date.now()) => {
  const raw = JSON.stringify(body);
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': signature } };
};
const leadBody = (over = {}, source = 'acme-crm') => ({
  version: 1, source,
  lead: { submissionId: 'a1', name: 'Dewi Anggraini', whatsapp: '08123456789', email: 'dewi@x.test', brokerEmail: 'Dewi.T@broker.test', broker: 'Valetax', language: 'id', ...over },
});

async function app(t) {
  const hooks = {
    'c-acme': { companyId: 'c-acme', companyName: 'Acme Trading', slug: 'acme', leadSecret: 'secret-lead-acme', verifySecret: 'secret-verify-acme', enabled: true, welcomeId: '', welcomeEn: '', confirmId: 'Hai {first_name}! Akun {broker} aktif di {company}.', confirmEn: '' },
    'c-beta': { companyId: 'c-beta', companyName: 'Beta', slug: 'beta', leadSecret: 'secret-lead-beta', verifySecret: null, enabled: true, welcomeId: '', welcomeEn: '', confirmId: '', confirmEn: '' },
  };
  const leads = [];
  const profiles = [];
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return { acme: 'c-acme', 'c-acme': 'c-acme', beta: 'c-beta' }[ref] || null; },
    async getLeadWebhook(id) { return hooks[id] || null; },
    async setLeadWebhookSecret(id, kind, secret) { hooks[id][kind === 'verify' ? 'verifySecret' : 'leadSecret'] = secret; return true; },
    async saveLeadWebhookSettings(id, s) { if (s.enabled !== undefined) hooks[id].enabled = s.enabled; if (s.confirmId !== undefined) hooks[id].confirmId = s.confirmId; return true; },
    async deleteLeadWebhook(id) { const had = Boolean(hooks[id]); delete hooks[id]; return had; },
    async authenticateUser(email, password) { return password === 'pass-12345' && email === owner.email ? owner : null; },
    async getActiveSessionUser(userId) { return userId === owner.id ? owner : null; },
    async setPresence() {},
    async getCompanyConfig() { return null; },
    async recordAuditLog() { return { id: 1 }; },
    async recordWebsiteLead() { return {}; },
    async saveWebsiteLeadProfile(lead, companyId) { profiles.push({ ...lead, companyId }); leads.push({ id: `l${leads.length}`, companyId, chatId: lead.chatId, name: lead.name, email: lead.email, brokerEmail: lead.brokerEmail, broker: lead.broker, language: lead.language, submissionId: lead.submissionId, status: 'new', confirmationSentAt: null }); return { id: 'x' }; },
    async listBroadcastOptOuts() { return []; },
    async findWebsiteLeadsForVerification(companyId, { emails, submissionIds = [] }) {
      return leads.filter((l) => l.companyId === companyId && (l.status === 'new' || !l.confirmationSentAt)
        && (emails.includes(l.email) || emails.includes(l.brokerEmail) || submissionIds.includes(l.submissionId)));
    },
    async claimWebsiteLeadVerification(id) { const l = leads.find((x) => x.id === id); if (!l || l.status !== 'new') return null; l.status = 'verified'; return { id }; },
    async markWebsiteLeadConfirmed(id) { const l = leads.find((x) => x.id === id); l.confirmationSentAt = 'now'; return true; },
    async setPipelineStage() { return {}; },
  };
  const instance = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'lwc-session' });
  t.after(() => instance.close());
  const cookie = (await instance.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const sentTo = async (chatId) => (await instance.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent(chatId)}/messages`, headers: { cookie } })).json().messages.filter((m) => m.fromMe);
  return { server: instance, hooks, profiles, leads, cookie, sentTo };
}

const lead = (server, slug, body, secret) => server.inject({ method: 'POST', url: `/webhook/company/${slug}/lead`, ...sign(body, secret) });
const verify = (server, slug, body, secret) => server.inject({ method: 'POST', url: `/webhook/company/${slug}/lead-verify`, ...sign(body, secret) });

test('lead per company: source bebas, brokerEmail tersimpan, sambutan umum memakai nama company', async (t) => {
  const { server, profiles, sentTo } = await app(t);
  const res = await lead(server, 'acme', leadBody(), 'secret-lead-acme');
  assert.deepEqual(res.json(), { ok: true, welcomed: true });
  assert.equal(profiles[0].companyId, 'c-acme');
  assert.equal(profiles[0].brokerEmail, 'dewi.t@broker.test');
  const sent = await sentTo('628123456789@c.us');
  assert.equal(sent[0].body, 'Halo Dewi, terima kasih sudah mendaftar di Acme Trading. Tim kami akan menghubungi kamu lewat chat ini.');
  assert.doesNotMatch(sent[0].body, /Bull Babe|MT4|rebate/i);
});

test('secret company lain, secret verify, atau tanpa tanda tangan tidak berlaku', async (t) => {
  const { server } = await app(t);
  assert.equal((await lead(server, 'acme', leadBody(), 'secret-lead-beta')).statusCode, 401);
  assert.equal((await lead(server, 'acme', leadBody(), 'secret-verify-acme')).statusCode, 401);
  assert.equal((await server.inject({ method: 'POST', url: '/webhook/company/acme/lead', payload: leadBody() })).statusCode, 401);
});

test('company tidak ada, dimatikan, atau belum punya secret verify: 404', async (t) => {
  const { server, hooks } = await app(t);
  assert.equal((await lead(server, 'tidak-ada', leadBody(), 'x')).statusCode, 404);
  assert.equal((await verify(server, 'beta', { version: 1, source: 'x', broker: 'B', registrations: [{ email: 'a@b.c' }] }, 'x')).statusCode, 404);
  hooks['c-acme'].enabled = false;
  assert.equal((await lead(server, 'acme', leadBody(), 'secret-lead-acme')).statusCode, 404);
});

test('verifikasi per company: brokerEmail cocok, template company dipakai, company lain tidak tersentuh', async (t) => {
  const { server, leads, sentTo } = await app(t);
  await lead(server, 'acme', leadBody(), 'secret-lead-acme');
  const res = await verify(server, 'acme', { version: 1, source: 'acme-robot', broker: 'valetax', registrations: [{ email: 'DEWI.T@broker.test' }] }, 'secret-verify-acme');
  assert.deepEqual(res.json(), { ok: true, received: 1, matched: 1, confirmed: 1, alreadyConfirmed: 0, failed: 0 });
  assert.equal(leads[0].status, 'verified');
  assert.equal((await sentTo('628123456789@c.us')).at(-1).body, 'Hai Dewi! Akun Valetax aktif di Acme Trading.');
  const again = await verify(server, 'acme', { version: 1, source: 'acme-robot', broker: 'Valetax', registrations: [{ submissionId: 'a1' }] }, 'secret-verify-acme');
  assert.equal(again.json().confirmed, 0);
});

test('confirmText dari pengirim menggantikan template, penanda diisi', async (t) => {
  const { server, sentTo } = await app(t);
  await lead(server, 'acme', leadBody(), 'secret-lead-acme');
  await verify(server, 'acme', { version: 1, source: 'acme-robot', broker: 'Valetax', confirmText: 'Selamat {first_name}, {broker} siap.', registrations: [{ submissionId: 'a1' }] }, 'secret-verify-acme');
  assert.equal((await sentTo('628123456789@c.us')).at(-1).body, 'Selamat Dewi, Valetax siap.');
});

test('source dengan karakter aneh ditolak di rute per company', async (t) => {
  const { server } = await app(t);
  assert.equal((await lead(server, 'acme', leadBody({}, 'a b<script>'), 'secret-lead-acme')).statusCode, 400);
});

test('pengaturan: hanya supervisor, secret tampil sekali dan tidak pernah di GET', async (t) => {
  const { server, cookie, hooks } = await app(t);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/integrations/lead-webhook' })).statusCode, 401);
  const made = await server.inject({ method: 'POST', url: '/v1/integrations/lead-webhook/secret', headers: { cookie }, payload: { kind: 'verify' } });
  assert.equal(made.statusCode, 201);
  assert.match(made.json().secret, /^[0-9a-f]{64}$/);
  assert.equal(hooks['c-acme'].verifySecret, made.json().secret);
  const got = await server.inject({ method: 'GET', url: '/v1/integrations/lead-webhook', headers: { cookie } });
  const view = got.json();
  assert.equal(view.leadPath, '/webhook/company/acme/lead');
  assert.equal(view.hasVerifySecret, true);
  assert.doesNotMatch(got.payload, new RegExp(made.json().secret));
  const put = await server.inject({ method: 'PUT', url: '/v1/integrations/lead-webhook', headers: { cookie }, payload: { templates: { confirmId: 'Baru {first_name}' } } });
  assert.equal(put.statusCode, 200);
  assert.equal(hooks['c-acme'].confirmId, 'Baru {first_name}');
  assert.equal((await server.inject({ method: 'DELETE', url: '/v1/integrations/lead-webhook', headers: { cookie } })).json().removed, true);
});
