'use strict';

/**
 * Aturan otomasi per company: pemicu -> aksi, disimpan sebagai data.
 *
 * Inti Agnee hanya menyediakan satu titik sambung (pesan customer masuk) dan
 * kumpulan aksi tertutup di bawah ini. Aturan baru tidak mengubah kode.
 *
 * Batas yang disengaja:
 *  - Tidak ada aksi yang mengirim pesan ke customer. Aksi hanya memindahkan
 *    tahap pipeline, memberi tahu tim, atau menyerahkan chat ke satu orang.
 *  - Tiap aturan punya jeda ulang per chat, jadi satu customer yang cerewet
 *    tidak memicu aksi yang sama berkali-kali.
 *  - Kegagalan satu aturan atau aksi tidak pernah menggagalkan pesan masuk.
 */

const MAX_RULES = 20;
const MAX_WORDS = 10;
const MAX_ACTIONS = 3;
const MAX_NAME = 80;
const MAX_MESSAGE = 200;
const COOLDOWN_MAX_HOURS = 720;
const DEFAULT_COOLDOWN_HOURS = 24;
const TRIGGER_TYPES = ['keyword', 'new_chat'];
const ACTION_TYPES = ['set_pipeline_stage', 'notify_team', 'assign_to_user'];
const PRIORITIES = ['low', 'normal', 'high'];
const STAGE_LABELS = { cold: 'Cold', warm: 'Warm', hot: 'Hot', closing: 'Closing', lost: 'Lost', on_hold: 'On hold' };

/** Pembanding kata: huruf kecil, spasi dirapikan. */
function fold(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Kata utuh, bukan potongan: "grosir" cocok dengan "harga grosir, kak" tetapi
 * tidak dengan "grosiran". Frasa dengan spasi cocok apa adanya.
 */
function containsWord(haystack, word) {
  if (!word) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
}

function matchesTrigger(trigger, { body, isNewChat }) {
  if (trigger?.type === 'new_chat') return isNewChat === true;
  if (trigger?.type === 'keyword') {
    const text = fold(body);
    return Boolean(text) && (trigger.words || []).some((word) => containsWord(text, fold(word)));
  }
  return false;
}

/**
 * Memeriksa dan merapikan satu aturan dari masukan mentah (model atau layar).
 * Melempar Error berbahasa Indonesia yang bisa dibaca model untuk memperbaiki.
 * `context` = { stages: [...], members: [{ id, displayName, status }] }.
 */
function normalizeRule(input, context) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Aturan harus berupa objek.');
  const name = String(input.name || '').trim();
  if (name.length < 3) throw new Error('Beri nama aturan (minimal 3 huruf).');
  if (name.length > MAX_NAME) throw new Error(`Nama aturan maksimal ${MAX_NAME} karakter.`);

  const rawTrigger = input.trigger;
  if (!rawTrigger || !TRIGGER_TYPES.includes(rawTrigger.type)) {
    throw new Error(`Pemicu harus salah satu dari: keyword (pesan memuat kata tertentu), new_chat (customer baru menulis pertama kali).`);
  }
  let trigger;
  if (rawTrigger.type === 'keyword') {
    const seen = new Set();
    const words = (Array.isArray(rawTrigger.words) ? rawTrigger.words : [])
      .map((word) => fold(word))
      .filter((word) => word && !seen.has(word) && seen.add(word));
    if (!words.length) throw new Error('Pemicu keyword butuh minimal satu kata di "words".');
    if (words.length > MAX_WORDS) throw new Error(`Maksimal ${MAX_WORDS} kata per aturan.`);
    const bad = words.find((word) => word.length < 3 || word.length > 60);
    if (bad) throw new Error(`Kata "${bad.slice(0, 30)}" harus 3 sampai 60 karakter; kata terlalu pendek memicu terlalu sering.`);
    trigger = { type: 'keyword', words };
  } else {
    trigger = { type: 'new_chat' };
  }

  const rawActions = Array.isArray(input.actions) ? input.actions : [];
  if (!rawActions.length) throw new Error('Aturan butuh minimal satu aksi.');
  if (rawActions.length > MAX_ACTIONS) throw new Error(`Maksimal ${MAX_ACTIONS} aksi per aturan.`);
  const active = new Map((context.members || []).filter((m) => m.status === 'active').map((m) => [String(m.id), m]));
  const seenTypes = new Set();
  const actions = rawActions.map((raw, index) => {
    const at = `Aksi ${index + 1}`;
    if (!raw || !ACTION_TYPES.includes(raw.type)) throw new Error(`${at}: jenis harus salah satu dari ${ACTION_TYPES.join(', ')}.`);
    if (seenTypes.has(raw.type)) throw new Error(`${at}: jenis ${raw.type} dipakai dua kali.`);
    seenTypes.add(raw.type);
    if (raw.type === 'set_pipeline_stage') {
      if (!(context.stages || []).includes(raw.stage)) throw new Error(`${at}: stage harus salah satu dari ${(context.stages || []).join(', ')}.`);
      return { type: raw.type, stage: raw.stage };
    }
    if (raw.type === 'notify_team') {
      const message = String(raw.message || '').trim();
      if (message.length < 3) throw new Error(`${at}: tulis isi pemberitahuan untuk tim.`);
      return { type: raw.type, message: message.slice(0, MAX_MESSAGE) };
    }
    const userId = String(raw.userId || '').trim();
    if (!active.has(userId)) {
      const options = [...active.values()].map((m) => `${m.id} (${m.displayName || m.email})`).join(', ') || 'belum ada anggota aktif';
      throw new Error(`${at}: userId tidak dikenal. Pilihan: ${options}.`);
    }
    const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'normal';
    return { type: raw.type, userId, priority };
  });

  let cooldownHours = DEFAULT_COOLDOWN_HOURS;
  if (input.cooldownHours !== undefined) {
    cooldownHours = Number(input.cooldownHours);
    if (!Number.isInteger(cooldownHours) || cooldownHours < 0 || cooldownHours > COOLDOWN_MAX_HOURS) {
      throw new Error(`cooldownHours harus bilangan bulat 0 sampai ${COOLDOWN_MAX_HOURS} (jam sebelum aturan boleh memicu chat yang sama lagi).`);
    }
  }
  return { name, trigger, actions, cooldownHours, enabled: input.enabled !== false };
}

/** Satu kalimat Indonesia yang menjelaskan aturan, untuk kartu usulan dan daftar. */
function describeRule(rule, members = []) {
  const who = (id) => members.find((m) => String(m.id) === String(id))?.displayName || 'anggota tim';
  const when = rule.trigger.type === 'new_chat'
    ? 'Customer baru menulis pertama kali'
    : `Pesan customer memuat ${rule.trigger.words.map((w) => `"${w}"`).join(' atau ')}`;
  const then = rule.actions.map((action) => {
    if (action.type === 'set_pipeline_stage') return `pindahkan ke tahap ${STAGE_LABELS[action.stage] || action.stage}`;
    if (action.type === 'notify_team') return `beri tahu tim ("${action.message}")`;
    return `serahkan chat ke ${who(action.userId)}${action.priority === 'high' ? ' (prioritas tinggi)' : ''}`;
  });
  const gap = rule.cooldownHours > 0 ? `, paling sering sekali per ${rule.cooldownHours} jam per chat` : '';
  return `${when} → ${then.join(', lalu ')}${gap}.`;
}

/** Aksi yang menghentikan AI di chat itu (pantas ditandai berisiko). */
function stopsAi(rule) {
  return rule.actions.some((action) => action.type === 'assign_to_user');
}

/**
 * Menjalankan semua aturan aktif yang cocok untuk satu pesan masuk. Tidak
 * pernah melempar. Dipanggil SEBELUM AI menyiapkan balasan, jadi chat yang
 * diserahkan ke seseorang tidak lagi dijawab AI pada pesan yang sama.
 *
 * deps: { database, getRouting, saveRouting, log }
 */
async function runForInbound({ companyId, chatId, body, isNewChat }, deps) {
  const { database, log } = deps;
  const ran = [];
  try {
    if (typeof database.listAutomationRules !== 'function') return ran;
    const rules = (await database.listAutomationRules(companyId)).filter((rule) => rule.enabled);
    for (const rule of rules) {
      if (!matchesTrigger(rule.trigger, { body, isNewChat })) continue;
      try {
        // Jeda ulang dan pencatatan dalam satu langkah: dua pesan beruntun
        // tidak bisa sama-sama lolos.
        const claim = await database.claimAutomationRun(rule.id, companyId, chatId, rule.cooldownHours);
        if (!claim) continue;
        const results = await runActions(rule, { companyId, chatId }, deps);
        await database.finishAutomationRun(claim.id, results).catch(() => {});
        ran.push({ ruleId: rule.id, name: rule.name, results });
      } catch (error) {
        log?.warn?.({ err: error, companyId, ruleId: rule.id }, 'Aturan otomasi gagal dijalankan');
      }
    }
  } catch (error) {
    log?.warn?.({ err: error, companyId }, 'Aturan otomasi tidak bisa dibaca');
  }
  return ran;
}

async function runActions(rule, { companyId, chatId }, deps) {
  const { database, getRouting, saveRouting } = deps;
  const results = [];
  for (const action of rule.actions) {
    try {
      if (action.type === 'set_pipeline_stage') {
        await database.setPipelineStage(chatId, action.stage, null, companyId);
        results.push({ type: action.type, ok: true });
      } else if (action.type === 'notify_team') {
        await database.notifySupervisorsAbout({ chatId, body: `${rule.name}: ${action.message}` }, companyId);
        results.push({ type: action.type, ok: true });
      } else if (action.type === 'assign_to_user') {
        // Chat yang sudah dipegang orang tidak dirampas.
        const routing = await getRouting(chatId, companyId);
        if (routing?.mode === 'human' && routing.assigneeUserId) {
          results.push({ type: action.type, ok: true, skipped: 'sudah dipegang' });
        } else {
          await saveRouting({
            chatId, mode: 'human', assigneeUserId: action.userId, status: 'open', priority: action.priority || 'normal',
            actorUserId: null, note: `Otomasi: ${rule.name}`, autoAssigned: false,
          }, companyId);
          results.push({ type: action.type, ok: true });
        }
      }
    } catch (error) {
      results.push({ type: action.type, ok: false, error: String(error.message).slice(0, 160) });
    }
  }
  return results;
}

/** Ringkasan uji untuk pratinjau: berapa chat 7 hari terakhir yang akan kena. */
async function previewTrigger(database, companyId, trigger, days = 7) {
  if (trigger.type === 'new_chat') {
    return { supported: false, note: 'Pemicu "customer baru" tidak bisa diuji pada chat lama.' };
  }
  const rows = await database.previewKeywordMatches(companyId, trigger.words, days);
  const hits = rows.filter((row) => matchesTrigger(trigger, { body: row.body, isNewChat: false }));
  const chats = new Set(hits.map((row) => row.chatId));
  return {
    supported: true,
    days,
    chats: chats.size,
    messages: hits.length,
    samples: hits.slice(0, 3).map((row) => String(row.body).replace(/\s+/g, ' ').slice(0, 100)),
  };
}

/**
 * Rute aturan otomasi. Hanya supervisor. deps: { database, isSupervisor,
 * catatAudit, stages, canCall }.
 */
function registerAutomationRoutes(app, deps) {
  const { database, isSupervisor, catatAudit, stages, canCall } = deps;
  const gate = (request, reply) => {
    if (!isSupervisor(request.agneeSession)) { reply.code(403).send({ error: 'Hanya supervisor yang dapat mengatur otomasi.' }); return false; }
    if (!canCall('listAutomationRules')) { reply.code(503).send({ error: 'Database tidak tersedia.' }); return false; }
    return true;
  };
  const contextFor = async (companyId) => ({ stages, members: await database.listTeamMembers(companyId) });
  const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
  const triggerSchema = {
    type: 'object', required: ['type'], additionalProperties: false,
    properties: { type: { type: 'string', enum: TRIGGER_TYPES }, words: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } } },
  };

  app.get('/v1/automation/rules', async (request, reply) => {
    if (!gate(request, reply)) return;
    const companyId = request.agneeSession.companyId;
    const [rules, context] = await Promise.all([database.listAutomationRules(companyId), contextFor(companyId)]);
    return {
      rules: rules.map((rule) => ({ ...rule, description: describeRule(rule, context.members), stopsAi: stopsAi(rule) })),
      limit: MAX_RULES,
    };
  });

  app.post('/v1/automation/rules', {
    schema: { body: { type: 'object', required: ['name', 'trigger', 'actions'], additionalProperties: false, properties: {
      name: { type: 'string', maxLength: 200 }, trigger: triggerSchema,
      actions: { type: 'array', maxItems: 10, items: { type: 'object' } },
      cooldownHours: { type: 'integer' }, enabled: { type: 'boolean' },
    } } },
  }, async (request, reply) => {
    if (!gate(request, reply)) return;
    const { companyId, userId } = request.agneeSession;
    let rule;
    try {
      rule = normalizeRule(request.body, await contextFor(companyId));
    } catch (error) {
      return reply.code(422).send({ error: error.message });
    }
    if ((await database.listAutomationRules(companyId)).length >= MAX_RULES) {
      return reply.code(409).send({ error: `Maksimal ${MAX_RULES} aturan per company. Hapus yang tidak dipakai dulu.` });
    }
    const saved = await database.createAutomationRule(companyId, rule, userId);
    await catatAudit(request, 'automation.created', { entityType: 'automation_rule', entityId: saved.id, metadata: { name: rule.name, trigger: rule.trigger.type, actions: rule.actions.map((a) => a.type) } });
    return reply.code(201).send(saved);
  });

  app.patch('/v1/automation/rules/:id', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { enabled: { type: 'boolean' } } } },
  }, async (request, reply) => {
    if (!gate(request, reply)) return;
    const saved = await database.updateAutomationRule(request.agneeSession.companyId, request.params.id, request.body);
    if (!saved) return reply.code(404).send({ error: 'Aturan tidak ditemukan.' });
    await catatAudit(request, 'automation.toggled', { entityType: 'automation_rule', entityId: saved.id, metadata: { name: saved.name, enabled: saved.enabled } });
    return saved;
  });

  app.delete('/v1/automation/rules/:id', { schema: { params: idParams } }, async (request, reply) => {
    if (!gate(request, reply)) return;
    const removed = await database.deleteAutomationRule(request.agneeSession.companyId, request.params.id);
    if (!removed) return reply.code(404).send({ error: 'Aturan tidak ditemukan.' });
    await catatAudit(request, 'automation.deleted', { entityType: 'automation_rule', entityId: request.params.id });
    return { ok: true };
  });

  app.post('/v1/automation/preview', {
    schema: { body: { type: 'object', required: ['trigger'], additionalProperties: false, properties: { trigger: triggerSchema } } },
  }, async (request, reply) => {
    if (!gate(request, reply)) return;
    let rule;
    try {
      rule = normalizeRule({ name: 'uji', trigger: request.body.trigger, actions: [{ type: 'notify_team', message: 'uji' }] }, { stages: [], members: [] });
    } catch (error) {
      return reply.code(422).send({ error: error.message });
    }
    return previewTrigger(database, request.agneeSession.companyId, rule.trigger);
  });
}

module.exports = {
  registerAutomationRoutes, previewTrigger,
  MAX_RULES, TRIGGER_TYPES, ACTION_TYPES, DEFAULT_COOLDOWN_HOURS,
  normalizeRule, describeRule, matchesTrigger, containsWord, stopsAi, runForInbound, runActions,
};
