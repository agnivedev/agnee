'use strict';

/**
 * Template potret konfigurasi per company: simpan, simpan sebagai baru, pasang.
 *
 * Yang dipotret hanya isi yang bisa dipakai ulang. Nomor WhatsApp, anggota
 * departemen, data customer, kredensial, dan model AI sengaja tidak ikut.
 * Memasang menambah dan menimpa isi, tidak pernah menghapus apa pun.
 */

const SECTIONS = ['playbook', 'facts', 'brief', 'departments', 'identity'];
const MAX_TEMPLATES = 20;

async function capture({ database, companyId, kinds, sections }) {
  const out = {};
  if (sections.includes('playbook')) {
    const docs = await database.listPlaybookDocs(companyId, null);
    const rows = {};
    for (const doc of docs) {
      if (!kinds.includes(doc.kind) || !(doc.contentLength > 0)) continue;
      const full = await database.getPlaybookDoc(doc.kind, companyId, null);
      if (full?.contentMd?.trim()) rows[doc.kind] = full.contentMd;
    }
    out.playbook = rows;
  }
  if (sections.includes('facts')) {
    const facts = await database.listPlaybookFacts(companyId, { onlyAnswered: true });
    out.facts = facts.map((f) => ({ category: f.category, question: f.question, answer: f.answer, priority: f.priority }));
  }
  if (sections.includes('brief')) out.brief = (await database.getPlaybook(companyId)).brief || '';
  if (sections.includes('departments')) {
    out.departments = (await database.listDepartments(companyId)).map((d) => ({ name: d.name, description: d.description || '' }));
  }
  if (sections.includes('identity')) out.identity = (await database.getAiSettings(companyId)).identity;
  return out;
}

/** Ringkasan isi untuk daftar dan pratinjau: jumlah, bukan teksnya. */
function summarize(snapshot) {
  const s = snapshot || {};
  return {
    playbook: s.playbook ? Object.keys(s.playbook).length : undefined,
    facts: s.facts ? s.facts.length : undefined,
    brief: typeof s.brief === 'string' ? s.brief.length : undefined,
    departments: s.departments ? s.departments.length : undefined,
    identity: s.identity,
  };
}

/** Apa yang akan berubah bila template dipasang sekarang. */
async function diff({ database, companyId, kinds, template }) {
  const current = await capture({ database, companyId, kinds, sections: Object.keys(template.sections) });
  const t = template.sections;
  const out = {};
  if (t.playbook) {
    const names = Object.keys(t.playbook);
    out.playbook = {
      changed: names.filter((k) => (current.playbook?.[k] || '').trim() !== t.playbook[k].trim()).length,
      total: names.length,
    };
  }
  if (t.facts) {
    const have = new Map((current.facts || []).map((f) => [f.question.trim().toLowerCase(), f.answer]));
    out.facts = {
      added: t.facts.filter((f) => !have.has(f.question.trim().toLowerCase())).length,
      changed: t.facts.filter((f) => have.has(f.question.trim().toLowerCase()) && have.get(f.question.trim().toLowerCase()) !== f.answer).length,
      total: t.facts.length,
    };
  }
  if (typeof t.brief === 'string') out.brief = { changed: (current.brief || '').trim() !== t.brief.trim() };
  if (t.departments) {
    const have = new Set((current.departments || []).map((d) => d.name.toLowerCase()));
    out.departments = { added: t.departments.filter((d) => !have.has(d.name.toLowerCase())).length, total: t.departments.length };
  }
  if (t.identity) out.identity = { changed: current.identity !== t.identity, to: t.identity };
  return out;
}

/**
 * Memasang dengan catatan pembatalan: tiap tulisan mencatat cara
 * mengembalikannya. Bila satu langkah gagal, yang sudah tertulis dikembalikan
 * (urutan terbalik) lalu error dilempar, jadi pemasangan semua-atau-tidak-sama-sekali.
 */
async function install({ database, companyId, userId, template, sections }) {
  const t = template.sections;
  const done = {};
  const undo = [];
  try {
    if (sections.includes('playbook') && t.playbook) {
      for (const [kind, contentMd] of Object.entries(t.playbook)) {
        const before = await database.getPlaybookDoc(kind, companyId, null);
        await database.savePlaybookDoc({ kind, contentMd }, userId, companyId);
        undo.push(() => (before
          ? database.savePlaybookDoc({ kind, contentMd: before.contentMd }, userId, companyId)
          : database.deletePlaybookDoc(kind, companyId, null)));
      }
      done.playbook = Object.keys(t.playbook).length;
    }
    if (sections.includes('facts') && t.facts) {
      const existing = new Map((await database.listPlaybookFacts(companyId)).map((f) => [f.question.trim().toLowerCase(), f]));
      for (const f of t.facts) {
        const found = existing.get(f.question.trim().toLowerCase());
        const before = found ? { ...found } : null;
        const row = await database.upsertPlaybookFact({ ...f, source: 'manual' }, userId, companyId);
        undo.push(() => (before
          ? database.upsertPlaybookFact({ category: before.category, question: before.question, answer: before.answer, priority: before.priority, source: before.source }, userId, companyId)
          : database.deletePlaybookFact(row.id, companyId)));
      }
      done.facts = t.facts.length;
    }
    if (sections.includes('brief') && typeof t.brief === 'string' && t.brief.trim()) {
      const before = (await database.getPlaybook(companyId)).brief || '';
      await database.savePlaybookBrief(t.brief, userId, companyId);
      undo.push(() => database.savePlaybookBrief(before, userId, companyId));
      done.brief = true;
    }
    if (sections.includes('departments') && t.departments) {
      const have = new Map((await database.listDepartments(companyId)).map((d) => [d.name.toLowerCase(), d]));
      for (const d of t.departments) {
        const existing = have.get(d.name.toLowerCase());
        if (existing) {
          await database.updateDepartment(existing.id, { description: d.description }, companyId);
          undo.push(() => database.updateDepartment(existing.id, { description: existing.description || '' }, companyId));
        } else {
          const created = await database.createDepartment(d, companyId);
          undo.push(() => database.deleteDepartment(created.id, companyId));
        }
      }
      done.departments = t.departments.length;
    }
    if (sections.includes('identity') && t.identity) {
      const before = (await database.getAiSettings(companyId)).identity;
      await database.setAiSettings(companyId, { identity: t.identity });
      undo.push(() => database.setAiSettings(companyId, { identity: before }));
      done.identity = t.identity;
    }
    return done;
  } catch (error) {
    for (const revert of undo.reverse()) await Promise.resolve(revert()).catch(() => {});
    throw error;
  }
}

function registerCompanyTemplates(app, deps) {
  const { database, isSupervisor, requireCoachDb, catatAudit, kinds } = deps;
  const sectionList = { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: SECTIONS } };
  const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
  const view = (row) => ({ id: row.id, name: row.name, version: row.version, updatedAt: row.updatedAt, contents: summarize(row.sections) });

  async function guard(request, reply) {
    if (!isSupervisor(request.agneeSession)) { reply.code(403).send({ error: 'Hanya supervisor yang dapat mengelola template.' }); return null; }
    if (!requireCoachDb(reply)) return null;
    return request.agneeSession.companyId;
  }

  app.get('/v1/templates', async (request, reply) => {
    const companyId = await guard(request, reply);
    if (!companyId) return;
    return { sections: SECTIONS, templates: (await database.listCompanyTemplates(companyId)).map(view) };
  });

  app.post('/v1/templates', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'sections'], properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, sections: sectionList } } },
  }, async (request, reply) => {
    const companyId = await guard(request, reply);
    if (!companyId) return;
    if ((await database.listCompanyTemplates(companyId)).length >= MAX_TEMPLATES) {
      return reply.code(409).send({ error: `Maksimal ${MAX_TEMPLATES} template. Hapus yang tidak dipakai.` });
    }
    const sections = await capture({ database, companyId, kinds, sections: request.body.sections });
    try {
      const row = await database.createCompanyTemplate({ name: request.body.name, sections }, request.agneeSession.userId, companyId);
      await catatAudit(request, 'template.saved', { entityType: 'company_template', entityId: row.id, metadata: { mode: 'new', sections: request.body.sections } });
      return reply.code(201).send({ template: view(row) });
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Sudah ada template dengan nama itu.' });
      throw error;
    }
  });

  app.put('/v1/templates/:id', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['sections'], properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, sections: sectionList } } },
  }, async (request, reply) => {
    const companyId = await guard(request, reply);
    if (!companyId) return;
    if (!(await database.getCompanyTemplate(request.params.id, companyId))) return reply.code(404).send({ error: 'Template tidak ditemukan.' });
    const sections = await capture({ database, companyId, kinds, sections: request.body.sections });
    try {
      const row = await database.overwriteCompanyTemplate(request.params.id, { name: request.body.name, sections }, companyId);
      await catatAudit(request, 'template.saved', { entityType: 'company_template', entityId: row.id, metadata: { mode: 'overwrite', sections: request.body.sections } });
      return { template: view(row) };
    } catch (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Sudah ada template dengan nama itu.' });
      throw error;
    }
  });

  app.delete('/v1/templates/:id', { schema: { params: idParams } }, async (request, reply) => {
    const companyId = await guard(request, reply);
    if (!companyId) return;
    if (!(await database.deleteCompanyTemplate(request.params.id, companyId))) return reply.code(404).send({ error: 'Template tidak ditemukan.' });
    await catatAudit(request, 'template.deleted', { entityType: 'company_template', entityId: request.params.id });
    return { ok: true };
  });

  app.get('/v1/templates/:id/preview', { schema: { params: idParams } }, async (request, reply) => {
    const companyId = await guard(request, reply);
    if (!companyId) return;
    const template = await database.getCompanyTemplate(request.params.id, companyId);
    if (!template) return reply.code(404).send({ error: 'Template tidak ditemukan.' });
    return { template: view(template), changes: await diff({ database, companyId, kinds, template }) };
  });

  app.post('/v1/templates/:id/apply', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['sections'], properties: { sections: sectionList } } },
  }, async (request, reply) => {
    const companyId = await guard(request, reply);
    if (!companyId) return;
    const template = await database.getCompanyTemplate(request.params.id, companyId);
    if (!template) return reply.code(404).send({ error: 'Template tidak ditemukan.' });
    const done = await install({ database, companyId, userId: request.agneeSession.userId, template, sections: request.body.sections });
    await catatAudit(request, 'template.applied', { entityType: 'company_template', entityId: template.id, metadata: { sections: Object.keys(done) } });
    return { ok: true, applied: done };
  });
}

module.exports = { registerCompanyTemplates, SECTIONS, capture, install };
