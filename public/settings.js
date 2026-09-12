'use strict';

const tr = (key, vars) => window.AgneeI18n.t(key, vars);

const ui = {
  sidebarDot: document.querySelector('#sidebarDot'),
  sidebarName: document.querySelector('#sidebarName'),
  sidebarRole: document.querySelector('#sidebarRole'),
  planBadge: document.querySelector('#planBadge'),
  planUsageBar: document.querySelector('#planUsageBar'),
  usageText: document.querySelector('#usageText'),
  usagePct: document.querySelector('#usagePct'),
  usageFill: document.querySelector('#usageFill'),
  knowledgeClientLabel: document.querySelector('#knowledgeClientLabel'),
  aiLimitInput: document.querySelector('#aiLimitInput'),
  paymentMethodSelect: document.querySelector('#paymentMethodSelect'),
  paymentLinkFields: document.querySelector('#paymentLinkFields'),
  bankTransferFields: document.querySelector('#bankTransferFields'),
  paymentLinkInput: document.querySelector('#paymentLinkInput'),
  bankNameInput: document.querySelector('#bankNameInput'),
  bankAccountInput: document.querySelector('#bankAccountInput'),
  bankHolderInput: document.querySelector('#bankHolderInput'),
  paymentNotesInput: document.querySelector('#paymentNotesInput'),
  savePaymentConfig: document.querySelector('#savePaymentConfig'),
  paymentSaved: document.querySelector('#paymentSaved'),
  followUpEnabled: document.querySelector('#followUpEnabled'),
  followUpEnabledLabel: document.querySelector('#followUpEnabledLabel'),
  followUpDayCaps: document.querySelector('#followUpDayCaps'),
  followUpMinGap: document.querySelector('#followUpMinGap'),
  followUpFromHour: document.querySelector('#followUpFromHour'),
  followUpToHour: document.querySelector('#followUpToHour'),
  followUpStats: document.querySelector('#followUpStats'),
  saveFollowUp: document.querySelector('#saveFollowUp'),
  followUpSaved: document.querySelector('#followUpSaved'),
  teamMembers: document.querySelector('#teamMembers'),
  teamForm: document.querySelector('#teamForm'),
  teamStatus: document.querySelector('#teamStatus'),
  myAccountInfo: document.querySelector('#myAccountInfo'),
  coachSection: document.querySelector('#coachSection'),
  coachCoverageBadge: document.querySelector('#coachCoverageBadge'),
  coachTabs: [...document.querySelectorAll('[data-coach-tab]')],
  coachPanes: {
    truth: document.querySelector('#coachPaneTruth'),
    scenarios: document.querySelector('#coachPaneScenarios'),
    simulate: document.querySelector('#coachPaneSimulate'),
    review: document.querySelector('#coachPaneReview'),
  },
  coachAskBtn: document.querySelector('#coachAskBtn'),
  coachFocus: document.querySelector('#coachFocus'),
  coachTruthStatus: document.querySelector('#coachTruthStatus'),
  coachOpenList: document.querySelector('#coachOpenList'),
  coachAnsweredList: document.querySelector('#coachAnsweredList'),
  coachAnsweredCount: document.querySelector('#coachAnsweredCount'),
  coachFactForm: document.querySelector('#coachFactForm'),
  coachScenarioList: document.querySelector('#coachScenarioList'),
  coachScenarioForm: document.querySelector('#coachScenarioForm'),
  coachScenarioStatus: document.querySelector('#coachScenarioStatus'),
  coachSimScenario: document.querySelector('#coachSimScenario'),
  coachResetBtn: document.querySelector('#coachResetBtn'),
  coachTranscript: document.querySelector('#coachTranscript'),
  coachCustomerMsg: document.querySelector('#coachCustomerMsg'),
  coachHumanWrap: document.querySelector('#coachHumanWrap'),
  coachHumanReply: document.querySelector('#coachHumanReply'),
  coachCompare: document.querySelector('#coachCompare'),
  coachRunBtn: document.querySelector('#coachRunBtn'),
  coachRunStatus: document.querySelector('#coachRunStatus'),
  coachResult: document.querySelector('#coachResult'),
  coachReviewAuthor: document.querySelector('#coachReviewAuthor'),
  coachReviewIncludeDone: document.querySelector('#coachReviewIncludeDone'),
  coachReviewRefresh: document.querySelector('#coachReviewRefresh'),
  coachAgentSummary: document.querySelector('#coachAgentSummary'),
  coachReviewStatus: document.querySelector('#coachReviewStatus'),
  coachReviewList: document.querySelector('#coachReviewList'),
};

const CATEGORY_LABELS = {
  profile: 'Profil', product: 'Produk', pricing: 'Harga',
  faq: 'FAQ', funnel: 'Funnel', objection: 'Keberatan', closing: 'Closing',
};

// The running simulated conversation, so the AI sees real multi-turn context.
let coachTranscript = [];

let currentUser = null;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Permintaan gagal (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadCompanyConfig() {
  try {
    const data = await api('/v1/admin/company');
    const plan = data.plan || 'personal';
    const planLabel = plan === 'company' ? 'Company' : 'Personal';
    ui.planBadge.textContent = `${planLabel} · ${data.planStatus || 'beta'}`;
    ui.planBadge.className = `plan-badge-pill plan-${plan}`;

    const limit = data.aiMessageLimit ?? data.limits?.aiMessages ?? 500;
    const count = data.aiMessageCount ?? data.counts?.aiMessages ?? 0;
    if (limit > 0) {
      const pct = Math.min(100, Math.round((count / limit) * 100));
      ui.usageText.textContent = `${count.toLocaleString()} / ${limit.toLocaleString()} pesan AI bulan ini`;
      ui.usagePct.textContent = `${pct}%`;
      ui.usageFill.style.width = `${pct}%`;
      ui.usageFill.className = `usage-fill${pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : ''}`;
      ui.planUsageBar.hidden = false;
    }

    ui.knowledgeClientLabel.value = data.knowledgeClient || '—';
    ui.aiLimitInput.value = limit;

    // Payment settings
    const method = data.paymentMethod || 'none';
    ui.paymentMethodSelect.value = method;
    updatePaymentFields(method);
    ui.paymentLinkInput.value = data.paymentLink || '';
    ui.bankNameInput.value = data.bankName || '';
    ui.bankAccountInput.value = data.bankAccount || '';
    ui.bankHolderInput.value = data.bankHolder || '';
    ui.paymentNotesInput.value = data.paymentNotes || '';
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/';
    }
  }
}

function updatePaymentFields(method) {
  // 'both' menampilkan kedua kelompok field sekaligus — sebuah company boleh
  // menerima link checkout dan transfer bank bersamaan.
  ui.paymentLinkFields.hidden = !(method === 'link' || method === 'both');
  ui.bankTransferFields.hidden = !(method === 'bank_transfer' || method === 'both');
}

// ── Tindak lanjut otomatis ──────────────────────────────────────────────────

/** "1,1,1" -> [1,1,1]. Menolak yang di luar batas yang diterima server. */
function parseDayCaps(raw) {
  const caps = String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (!caps.length || caps.length > 7) return null;
  if (caps.some((n) => !Number.isInteger(n) || n < 0 || n > 10)) return null;
  return caps;
}

function renderFollowUpEnabled(enabled) {
  ui.followUpEnabledLabel.textContent = enabled ? tr('fu.on') : tr('fu.off');
}

async function loadFollowUpSettings() {
  try {
    const data = await api('/v1/follow-up/settings');
    ui.followUpEnabled.checked = Boolean(data.enabled);
    renderFollowUpEnabled(data.enabled);
    ui.followUpDayCaps.value = (data.dayCaps || []).join(',');
    ui.followUpMinGap.value = data.minGapMinutes ?? 120;
    ui.followUpFromHour.value = data.sendFromHour ?? 8;
    ui.followUpToHour.value = data.sendToHour ?? 21;
    const s = data.stats || {};
    ui.followUpStats.textContent = [
      tr('fu.statsSent', { count: s.sent ?? 0 }),
      tr('fu.statsReplied', { count: s.replied ?? 0 }),
      tr('fu.statsActive', { count: s.active ?? 0 }),
    ].join(' · ');
  } catch {
    // Bukan bagian kritis halaman — biarkan section-nya diam kalau gagal.
  }
}

async function saveFollowUpSettings() {
  const dayCaps = parseDayCaps(ui.followUpDayCaps.value);
  if (!dayCaps) {
    await AgneeDialog.alert({ title: tr('fu.capsInvalidTitle'), message: tr('fu.capsInvalidCopy') });
    return;
  }
  ui.saveFollowUp.disabled = true;
  try {
    const saved = await api('/v1/follow-up/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: ui.followUpEnabled.checked,
        dayCaps,
        minGapMinutes: Number(ui.followUpMinGap.value) || 120,
        sendFromHour: Number(ui.followUpFromHour.value),
        sendToHour: Number(ui.followUpToHour.value),
      }),
    });
    renderFollowUpEnabled(saved.enabled);
    ui.followUpSaved.hidden = false;
    setTimeout(() => { ui.followUpSaved.hidden = true; }, 2500);
  } catch (err) {
    await AgneeDialog.error(err);
  } finally {
    ui.saveFollowUp.disabled = false;
  }
}

async function savePaymentConfig() {
  ui.savePaymentConfig.disabled = true;
  try {
    const method = ui.paymentMethodSelect.value;
    // 'both' harus mengirim kedua kelompok field. Kalau dicek dengan
    // perbandingan persis ke 'link'/'bank_transfer', memilih "keduanya" justru
    // menyimpan dua-duanya kosong.
    const usesLink = method === 'link' || method === 'both';
    const usesBank = method === 'bank_transfer' || method === 'both';
    await api('/v1/admin/company', {
      method: 'PATCH',
      body: JSON.stringify({
        paymentMethod: method,
        paymentLink: usesLink ? ui.paymentLinkInput.value.trim() : '',
        bankName: usesBank ? ui.bankNameInput.value.trim() : '',
        bankAccount: usesBank ? ui.bankAccountInput.value.trim() : '',
        bankHolder: usesBank ? ui.bankHolderInput.value.trim() : '',
        paymentNotes: ui.paymentNotesInput.value.trim(),
      }),
    });
    ui.paymentSaved.hidden = false;
    setTimeout(() => { ui.paymentSaved.hidden = true; }, 2500);
  } catch (err) {
    await AgneeDialog.error(err);
  } finally {
    ui.savePaymentConfig.disabled = false;
  }
}


function renderTeam(members, user) {
  ui.teamMembers.replaceChildren();
  const canManage = user && ['owner', 'admin', 'supervisor'].includes(user.role);

  for (const member of members) {
    const row = document.createElement('div');
    row.className = 'team-member';
    const name = member.displayName || member.email;
    const isOwner = member.role === 'owner';
    const isSelf = user && member.id === user.id;

    const avatarEl = document.createElement('span');
    avatarEl.className = 'member-avatar';
    avatarEl.textContent = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

    const infoEl = document.createElement('span');
    infoEl.innerHTML = '<strong></strong><small></small>';
    infoEl.querySelector('strong').textContent = name + (isSelf ? ' (kamu)' : '');
    infoEl.querySelector('small').textContent = member.email;

    const roleEl = document.createElement('b');
    roleEl.className = 'member-role';
    roleEl.textContent = ['owner', 'admin', 'supervisor'].includes(member.role) ? 'Supervisor' : 'Agent';

    row.append(avatarEl, infoEl, roleEl);

    if (canManage && !isOwner && !isSelf) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'member-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.type = 'button';
      editBtn.textContent = 'Ubah';
      editBtn.addEventListener('click', () => {
        row.replaceWith(buildMemberEditor(member));
      });

      const roleSelect = document.createElement('select');
      roleSelect.className = 'member-role-select';
      [{ value: 'agent', label: 'Agent' }, { value: 'supervisor', label: 'Supervisor' }].forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        opt.selected = member.role === value;
        roleSelect.append(opt);
      });
      roleSelect.addEventListener('change', async () => {
        try {
          await api(`/v1/team/members/${member.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: roleSelect.value }) });
          await loadTeam();
        } catch (err) {
          await AgneeDialog.error(err);
          roleSelect.value = member.role;
        }
      });

      const deactivateBtn = document.createElement('button');
      deactivateBtn.className = 'deactivate-btn';
      deactivateBtn.type = 'button';
      deactivateBtn.textContent = 'Nonaktifkan';
      deactivateBtn.addEventListener('click', async () => {
        const okDeactivate = await AgneeDialog.confirm({
          title: tr('dialog.deactivateTitle'),
          message: tr('dialog.deactivateCopy', { name }),
          confirmLabel: tr('dialog.deactivateConfirm'),
          danger: true,
        });
        if (!okDeactivate) return;
        try {
          await api(`/v1/team/members/${member.id}`, { method: 'DELETE' });
          await loadTeam();
        } catch (err) {
          await AgneeDialog.error(err);
        }
      });

      actionsEl.append(editBtn, roleSelect, deactivateBtn);
      row.append(actionsEl);
    }

    ui.teamMembers.append(row);
  }
}

function buildMemberEditor(member) {
  const form = document.createElement('form');
  form.className = 'team-member member-editor';

  const nameInput = document.createElement('input');
  nameInput.name = 'displayName';
  nameInput.required = true;
  nameInput.minLength = 2;
  nameInput.placeholder = 'Nama';
  nameInput.value = member.displayName || '';

  const emailInput = document.createElement('input');
  emailInput.name = 'email';
  emailInput.type = 'email';
  emailInput.required = true;
  emailInput.placeholder = 'Email';
  emailInput.value = member.email || '';

  const passwordInput = document.createElement('input');
  passwordInput.name = 'password';
  passwordInput.type = 'password';
  passwordInput.minLength = 8;
  passwordInput.placeholder = 'Kata sandi baru (opsional)';
  passwordInput.autocomplete = 'new-password';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'member-save-btn';
  saveBtn.textContent = 'Simpan';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'member-cancel-btn';
  cancelBtn.textContent = 'Batal';
  cancelBtn.addEventListener('click', () => { void loadTeam(); });

  const actionsEl = document.createElement('div');
  actionsEl.className = 'member-actions';
  actionsEl.append(saveBtn, cancelBtn);

  form.append(nameInput, emailInput, passwordInput, actionsEl);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {};
    if (nameInput.value.trim() !== (member.displayName || '')) payload.displayName = nameInput.value.trim();
    if (emailInput.value.trim().toLowerCase() !== (member.email || '')) payload.email = emailInput.value.trim().toLowerCase();
    if (passwordInput.value) payload.password = passwordInput.value;
    if (!Object.keys(payload).length) return loadTeam();

    saveBtn.disabled = true;
    ui.teamStatus.textContent = 'Menyimpan…';
    try {
      await api(`/v1/team/members/${member.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      ui.teamStatus.textContent = 'Anggota diperbarui.';
      await loadTeam();
    } catch (error) {
      ui.teamStatus.textContent = error.message;
      saveBtn.disabled = false;
    }
  });

  return form;
}

function renderMyAccount(user) {
  ui.myAccountInfo.replaceChildren();
  const row = document.createElement('div');
  row.className = 'team-member';

  const avatarEl = document.createElement('span');
  avatarEl.className = 'member-avatar';
  const name = user.displayName || user.email;
  avatarEl.textContent = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  const infoEl = document.createElement('span');
  infoEl.innerHTML = '<strong></strong><small></small>';
  infoEl.querySelector('strong').textContent = name;
  infoEl.querySelector('small').textContent = user.email;

  const roleEl = document.createElement('b');
  roleEl.className = 'member-role';
  roleEl.textContent = ['owner', 'admin', 'supervisor'].includes(user.role) ? 'Supervisor' : 'Agent';

  row.append(avatarEl, infoEl, roleEl);
  ui.myAccountInfo.append(row);
}

async function loadTeam() {
  try {
    const data = await api('/v1/team/members');
    renderTeam(data.members || [], currentUser);
  } catch (error) {
    ui.teamStatus.textContent = error.message;
  }
}

async function addMember(event) {
  event.preventDefault();
  const form = new FormData(ui.teamForm);
  const button = ui.teamForm.querySelector('button');
  button.disabled = true;
  ui.teamStatus.textContent = 'Memuat…';
  try {
    await api('/v1/team/members', {
      method: 'POST',
      body: JSON.stringify({
        displayName: form.get('displayName'),
        email: form.get('email'),
        password: form.get('password'),
        role: form.get('role'),
      }),
    });
    ui.teamForm.reset();
    ui.teamStatus.textContent = 'Anggota berhasil ditambahkan.';
    await loadTeam();
  } catch (error) {
    ui.teamStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function init() {
  try {
    const session = await api('/v1/auth/session');
    currentUser = session.user;

    ui.sidebarName.textContent = currentUser.displayName || currentUser.email;
    ui.sidebarRole.textContent = ['owner', 'admin', 'supervisor'].includes(currentUser.role) ? 'Supervisor' : 'Agent';
    ui.sidebarDot.className = 'status-dot ready';

    const isAgent = currentUser.role === 'agent';
    ui.teamForm.hidden = isAgent;

    // Latihan & penilaian is supervisor-only — the source of truth, the
    // scenario library, practice and review all belong to the supervisor. The
    // server enforces this too; hiding the section just avoids showing an area
    // where every call would come back 403.
    ui.coachSection.hidden = isAgent;

    renderMyAccount(currentUser);
    // Cloud API section only for supervisors
    if (isAgent) { document.querySelector('#waCloudSection').hidden = true; }
    await Promise.all([
      loadCompanyConfig(),
      loadTeam(),
      isAgent ? Promise.resolve() : loadCoachFacts(),
      isAgent ? Promise.resolve() : loadCoachScenarios(),
      isAgent ? Promise.resolve() : loadCloudApiStatus(),
      isAgent ? Promise.resolve() : loadFollowUpSettings(),
      isAgent ? Promise.resolve() : loadWaNumbers(),
      isAgent ? Promise.resolve() : loadExport(),
    ]);
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/';
    }
  }
}

ui.paymentMethodSelect.addEventListener('change', () => updatePaymentFields(ui.paymentMethodSelect.value));
ui.savePaymentConfig.addEventListener('click', savePaymentConfig);
ui.saveFollowUp.addEventListener('click', saveFollowUpSettings);
waNumbers.add.addEventListener('click', addWaNumber);

xport.download.addEventListener('click', () => {
  // Unduhan memakai cookie sesi yang sama seperti request lain di halaman ini.
  window.location.href = '/v1/export/contacts.csv';
});

xport.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  xport.status.textContent = 'Memeriksa ke Microsoft…';
  const btn = document.querySelector('#exportConnect');
  btn.disabled = true;
  try {
    await api('/v1/export/onedrive', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: xport.tenantId.value.trim(),
        clientId: xport.clientId.value.trim(),
        clientSecret: xport.secret.value.trim(),
        fileUrl: xport.fileUrl.value.trim(),
        ...(xport.worksheet.value.trim() ? { worksheetName: xport.worksheet.value.trim() } : {}),
      }),
    });
    xport.status.textContent = '';
    xport.form.reset();
    await loadExport();
  } catch (err) {
    xport.status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

xport.syncNow.addEventListener('click', async () => {
  xport.syncNow.disabled = true;
  const label = xport.syncNow.textContent;
  xport.syncNow.textContent = 'Menyinkronkan…';
  try {
    const out = await api('/v1/export/onedrive/sync', { method: 'POST' });
    await loadExport();
    await AgneeDialog.alert({
      title: 'Selesai',
      message: `${out.rowCount} baris ditulis ke Excel${out.blanked ? `, ${out.blanked} baris lama dikosongkan` : ''}.`,
    });
  } catch (err) {
    await loadExport();
    await AgneeDialog.error(err);
  } finally {
    xport.syncNow.textContent = label;
    xport.syncNow.disabled = false;
  }
});

xport.toggle.addEventListener('click', async () => {
  xport.toggle.disabled = true;
  try {
    await api('/v1/export/onedrive', { method: 'PATCH', body: JSON.stringify({ enabled: !exportEnabled }) });
    await loadExport();
  } catch (err) { await AgneeDialog.error(err); } finally { xport.toggle.disabled = false; }
});

xport.disconnect.addEventListener('click', async () => {
  const ok = await AgneeDialog.confirm({
    title: 'Putuskan file Excel?',
    message: 'Kredensial Microsoft dihapus dan sinkronisasi berhenti. Isi file yang sudah tertulis tetap ada di OneDrive.',
    confirmLabel: 'Putuskan',
    danger: true,
  });
  if (!ok) return;
  try {
    await api('/v1/export/onedrive', { method: 'DELETE' });
    await loadExport();
  } catch (err) { await AgneeDialog.error(err); }
});
ui.followUpEnabled.addEventListener('change', () => renderFollowUpEnabled(ui.followUpEnabled.checked));
ui.teamForm.addEventListener('submit', addMember);


// ── Reply coach ───────────────────────────────────────────────────────────────

function coachSelectTab(name) {
  ui.coachTabs.forEach((tab) => {
    const active = tab.dataset.coachTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  Object.entries(ui.coachPanes).forEach(([key, pane]) => {
    if (pane) pane.hidden = key !== name;
  });
}

function factRow(fact, { editable }) {
  const item = document.createElement('div');
  item.className = 'coach-item';

  const head = document.createElement('div');
  head.className = 'coach-item-head';
  const cat = document.createElement('span');
  cat.className = `coach-cat${fact.priority === 1 ? ' coach-prio-1' : ''}`;
  cat.textContent = CATEGORY_LABELS[fact.category] || fact.category;
  const q = document.createElement('span');
  q.className = 'coach-q';
  q.textContent = fact.question;
  head.append(cat, q);
  item.append(head);

  const hasAnswer = Boolean(fact.answer && fact.answer.trim());

  if (hasAnswer && !editable) {
    const a = document.createElement('p');
    a.className = 'coach-a';
    a.textContent = fact.answer;
    item.append(a);
  }

  if (editable) {
    const input = document.createElement('textarea');
    input.rows = 2;
    input.maxLength = 4000;
    input.value = fact.answer || '';
    input.placeholder = 'Tulis jawabannya…';
    item.append(input);

    const actions = document.createElement('div');
    actions.className = 'coach-item-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'save-settings-btn';
    save.textContent = 'Simpan';
    save.addEventListener('click', async () => {
      const answer = input.value.trim();
      if (!answer) { ui.coachTruthStatus.textContent = 'Jawaban masih kosong.'; return; }
      save.disabled = true;
      try {
        await api('/v1/coach/facts', {
          method: 'POST',
          body: JSON.stringify({ category: fact.category, question: fact.question, answer, priority: fact.priority }),
        });
        ui.coachTruthStatus.textContent = 'Tersimpan ✓';
        await loadCoachFacts();
      } catch (err) {
        ui.coachTruthStatus.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'deactivate-btn';
    remove.textContent = 'Hapus';
    remove.addEventListener('click', async () => {
      const okDeleteFact = await AgneeDialog.confirm({
        title: tr('dialog.deleteFactTitle'),
        message: tr('dialog.deleteFactCopy'),
        confirmLabel: tr('dialog.deleteConfirm'),
        danger: true,
      });
      if (!okDeleteFact) return;
      try {
        await api(`/v1/coach/facts/${fact.id}`, { method: 'DELETE' });
        await loadCoachFacts();
      } catch (err) {
        ui.coachTruthStatus.textContent = err.message;
      }
    });

    actions.append(save, remove);
    item.append(actions);
  }

  return item;
}

async function loadCoachFacts() {
  try {
    const data = await api('/v1/coach/facts');
    const facts = data.facts || [];
    const open = facts.filter((f) => !f.answer || !f.answer.trim());
    const answered = facts.filter((f) => f.answer && f.answer.trim());

    ui.coachCoverageBadge.textContent = facts.length
      ? `${answered.length}/${facts.length} terjawab`
      : 'belum disiapkan';

    ui.coachOpenList.replaceChildren();
    if (!open.length) {
      const empty = document.createElement('p');
      empty.className = 'team-copy';
      empty.textContent = facts.length
        ? 'Semua pertanyaan sudah dijawab. Minta AI bertanya lagi untuk memperdalam.'
        : 'Belum ada apa-apa. Klik tombol di atas supaya AI mulai bertanya tentang bisnis kamu.';
      ui.coachOpenList.append(empty);
    } else {
      open.forEach((fact) => ui.coachOpenList.append(factRow(fact, { editable: true })));
    }

    ui.coachAnsweredCount.textContent = String(answered.length);
    ui.coachAnsweredList.replaceChildren();
    answered.forEach((fact) => ui.coachAnsweredList.append(factRow(fact, { editable: false })));
  } catch (error) {
    if (error.status === 401) { window.location.href = '/'; return; }
    ui.coachTruthStatus.textContent = error.message;
  }
}

async function coachAskQuestions() {
  ui.coachAskBtn.disabled = true;
  ui.coachTruthStatus.textContent = 'AI sedang menyusun pertanyaan…';
  try {
    const body = ui.coachFocus.value ? { focus: ui.coachFocus.value } : {};
    const data = await api('/v1/coach/interview', { method: 'POST', body: JSON.stringify(body) });
    const n = (data.questions || []).length;
    ui.coachTruthStatus.textContent = n
      ? `${n} pertanyaan baru ditambahkan. Isi jawabannya di bawah.`
      : 'Tidak ada pertanyaan baru — AI merasa sudah cukup paham untuk sekarang.';
    await loadCoachFacts();
  } catch (error) {
    ui.coachTruthStatus.textContent = error.message;
  } finally {
    ui.coachAskBtn.disabled = false;
  }
}

async function saveManualFact(event) {
  event.preventDefault();
  const form = new FormData(ui.coachFactForm);
  try {
    await api('/v1/coach/facts', {
      method: 'POST',
      body: JSON.stringify({
        category: form.get('category'),
        question: String(form.get('question')).trim(),
        answer: String(form.get('answer') || '').trim() || null,
      }),
    });
    ui.coachFactForm.reset();
    ui.coachTruthStatus.textContent = 'Fakta tersimpan ✓';
    await loadCoachFacts();
  } catch (error) {
    ui.coachTruthStatus.textContent = error.message;
  }
}

async function loadCoachScenarios() {
  try {
    const data = await api('/v1/coach/scenarios');
    const scenarios = data.scenarios || [];

    ui.coachScenarioList.replaceChildren();
    if (!scenarios.length) {
      const empty = document.createElement('p');
      empty.className = 'team-copy';
      empty.textContent = 'Belum ada skenario. Buat satu supaya agent bisa latihan dengan situasi yang sama berulang kali.';
      ui.coachScenarioList.append(empty);
    }

    ui.coachSimScenario.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Tanpa skenario';
    ui.coachSimScenario.append(none);

    for (const scenario of scenarios) {
      const item = document.createElement('div');
      item.className = 'coach-item';
      const head = document.createElement('div');
      head.className = 'coach-item-head';
      const name = document.createElement('span');
      name.className = 'coach-q';
      name.textContent = scenario.name;
      head.append(name);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'deactivate-btn';
      del.textContent = 'Hapus';
      del.addEventListener('click', async () => {
        const okDeleteScenario = await AgneeDialog.confirm({
          title: tr('dialog.deleteScenarioTitle'),
          message: tr('dialog.deleteScenarioCopy', { name: scenario.name }),
          confirmLabel: tr('dialog.deleteConfirm'),
          danger: true,
        });
        if (!okDeleteScenario) return;
        try {
          await api(`/v1/coach/scenarios/${scenario.id}`, { method: 'DELETE' });
          await loadCoachScenarios();
        } catch (err) {
          ui.coachScenarioStatus.textContent = err.message;
        }
      });
      head.append(del);
      item.append(head);

      const detail = document.createElement('p');
      detail.className = 'coach-a';
      detail.textContent = [
        scenario.persona && `Karakter: ${scenario.persona}`,
        `Pembuka: "${scenario.openingMessage}"`,
        scenario.goal && `Target: ${scenario.goal}`,
      ].filter(Boolean).join(' · ');
      item.append(detail);
      ui.coachScenarioList.append(item);

      const opt = document.createElement('option');
      opt.value = scenario.id;
      opt.textContent = scenario.name;
      opt.dataset.opening = scenario.openingMessage;
      ui.coachSimScenario.append(opt);
    }
  } catch (error) {
    if (error.status === 401) { window.location.href = '/'; return; }
    ui.coachScenarioStatus.textContent = error.message;
  }
}

async function saveScenario(event) {
  event.preventDefault();
  const form = new FormData(ui.coachScenarioForm);
  try {
    await api('/v1/coach/scenarios', {
      method: 'POST',
      body: JSON.stringify({
        name: String(form.get('name')).trim(),
        persona: String(form.get('persona') || '').trim(),
        openingMessage: String(form.get('openingMessage')).trim(),
        goal: String(form.get('goal') || '').trim(),
      }),
    });
    ui.coachScenarioForm.reset();
    ui.coachScenarioStatus.textContent = 'Skenario tersimpan ✓';
    await loadCoachScenarios();
  } catch (error) {
    ui.coachScenarioStatus.textContent = error.message;
  }
}

function renderTranscript() {
  ui.coachTranscript.replaceChildren();
  for (const turn of coachTranscript) {
    const bubble = document.createElement('div');
    bubble.className = `coach-bubble coach-bubble-${turn.role}`;
    const who = document.createElement('small');
    who.textContent = turn.role === 'customer' ? 'Customer' : 'CS';
    const text = document.createElement('div');
    text.textContent = turn.text;
    bubble.append(who, text);
    ui.coachTranscript.append(bubble);
  }
  ui.coachTranscript.scrollTop = ui.coachTranscript.scrollHeight;
}

function scoreTile(label, value) {
  const tile = document.createElement('div');
  const band = value === null ? '' : value <= 2 ? ' low' : value <= 3 ? ' mid' : '';
  tile.className = `coach-score${band}`;
  const b = document.createElement('b');
  b.textContent = value === null ? '–' : String(value);
  const span = document.createElement('span');
  span.textContent = label;
  tile.append(b, span);
  return tile;
}

function renderCoachResult(data) {
  ui.coachResult.hidden = false;
  renderJudgeInto(ui.coachResult, data);

  // Only simulate mode has a second reply to compare against.
  if (!data.aiReply) return;
  const compare = document.createElement('div');
  compare.className = 'coach-compare';
  for (const [title, body] of [['Balasan AI', data.aiReply], ['Balasan kamu', data.reply]]) {
    const card = document.createElement('div');
    card.className = 'coach-compare-card';
    const h5 = document.createElement('h5');
    h5.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    card.append(h5, p);
    compare.append(card);
  }
  ui.coachResult.append(compare);
}

function coachMode() {
  return document.querySelector('input[name="coachMode"]:checked')?.value || 'ai';
}

async function runCoachSimulation() {
  const customerMessage = ui.coachCustomerMsg.value.trim();
  if (!customerMessage) { ui.coachRunStatus.textContent = 'Tulis dulu pesan customer.'; return; }
  const mode = coachMode();
  const humanReply = ui.coachHumanReply.value.trim();
  if (mode === 'human' && !humanReply) { ui.coachRunStatus.textContent = 'Tulis dulu balasan kamu.'; return; }

  ui.coachRunBtn.disabled = true;
  ui.coachRunStatus.textContent = 'Menilai…';
  try {
    const data = await api('/v1/coach/simulate', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        customerMessage,
        humanReply: mode === 'human' ? humanReply : undefined,
        transcript: coachTranscript,
        scenarioId: ui.coachSimScenario.value || null,
        compareWithAi: mode === 'human' && ui.coachCompare.checked,
      }),
    });

    coachTranscript.push({ role: 'customer', text: customerMessage });
    coachTranscript.push({ role: 'agent', text: data.reply });
    renderTranscript();
    renderCoachResult(data);

    ui.coachCustomerMsg.value = '';
    ui.coachHumanReply.value = '';
    ui.coachRunStatus.textContent = '';
    if (data.newGaps?.length) await loadCoachFacts();
  } catch (error) {
    ui.coachRunStatus.textContent = error.message;
  } finally {
    ui.coachRunBtn.disabled = false;
  }
}

function coachReset() {
  coachTranscript = [];
  renderTranscript();
  ui.coachResult.hidden = true;
  ui.coachResult.replaceChildren();
  ui.coachCustomerMsg.value = '';
  ui.coachHumanReply.value = '';
  ui.coachRunStatus.textContent = '';
  const opt = ui.coachSimScenario.selectedOptions[0];
  if (opt?.dataset.opening) ui.coachCustomerMsg.value = opt.dataset.opening;
}

function renderJudgeInto(container, data) {
  container.replaceChildren();
  const judge = data.judge;

  if (judge) {
    const verdict = document.createElement('span');
    verdict.className = `coach-verdict coach-verdict-${judge.verdict}`;
    verdict.textContent = judge.verdict === 'pass'
      ? `Lolos · rata-rata ${judge.overall}`
      : `Perlu diperbaiki · rata-rata ${judge.overall}`;
    container.append(verdict);

    const scores = document.createElement('div');
    scores.className = 'coach-scores';
    scores.append(
      scoreTile('Akurasi', judge.scores.accuracy),
      scoreTile('Membantu', judge.scores.helpfulness),
      scoreTile('Funnel', judge.scores.funnel),
      scoreTile('Nada', judge.scores.tone),
    );
    container.append(scores);
  }

  const feedback = document.createElement('div');
  feedback.className = 'coach-feedback';
  const addList = (title, items) => {
    if (!items || !items.length) return;
    const h = document.createElement('h4');
    h.textContent = title;
    const ul = document.createElement('ul');
    items.forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = entry;
      ul.append(li);
    });
    feedback.append(h, ul);
  };
  if (data.rules && !data.rules.passed) addList('Masalah gaya', data.rules.warnings);
  if (judge) {
    addList('Sudah bagus', judge.strengths);
    addList('Perlu diperbaiki', judge.issues);
  }
  if (data.newGaps?.length) {
    addList('Info yang AI belum tahu (ditambahkan ke Sumber Kebenaran)', data.newGaps.map((g) => g.question));
  }
  if (feedback.children.length) container.append(feedback);

  if (judge?.suggestedReply) {
    const card = document.createElement('div');
    card.className = 'coach-compare-card';
    card.style.marginTop = '12px';
    const h5 = document.createElement('h5');
    h5.textContent = 'Seharusnya dibalas seperti ini';
    const p = document.createElement('p');
    p.textContent = judge.suggestedReply;
    card.append(h5, p);
    container.append(card);
  }
}

function reviewRow(entry) {
  const item = document.createElement('div');
  item.className = 'coach-item';

  const head = document.createElement('div');
  head.className = 'coach-item-head';
  const who = document.createElement('span');
  who.className = 'coach-cat';
  who.textContent = entry.authorName || (entry.author === 'ai' ? 'AI' : 'Agent');
  const when = document.createElement('span');
  when.className = 'coach-q';
  when.textContent = new Date(entry.createdAt).toLocaleString('id-ID');
  head.append(who, when);
  if (entry.reviewedAt) {
    const done = document.createElement('span');
    done.className = 'coach-verdict coach-verdict-pass';
    done.textContent = 'sudah dinilai';
    head.append(done);
  }
  item.append(head);

  if (entry.inReplyTo) {
    const ctx = document.createElement('p');
    ctx.className = 'coach-a';
    ctx.textContent = `Customer: "${entry.inReplyTo}"`;
    item.append(ctx);
  }

  const body = document.createElement('p');
  body.className = 'coach-a';
  body.style.color = '#14241f';
  body.textContent = `Balasan: ${entry.body}`;
  item.append(body);

  // Older replies predate attribution, so the customer message may be missing.
  let manual = null;
  if (!entry.inReplyTo) {
    manual = document.createElement('input');
    manual.type = 'text';
    manual.maxLength = 4000;
    manual.placeholder = 'Pesan customer tidak tercatat — isi manual supaya bisa dinilai';
    item.append(manual);
  }

  const actions = document.createElement('div');
  actions.className = 'coach-item-actions';
  const grade = document.createElement('button');
  grade.type = 'button';
  grade.className = 'save-settings-btn';
  grade.textContent = entry.reviewedAt ? 'Nilai ulang' : 'Nilai';
  const result = document.createElement('div');
  result.className = 'coach-result';

  grade.addEventListener('click', async () => {
    const payload = {};
    if (manual && manual.value.trim()) payload.customerMessage = manual.value.trim();
    grade.disabled = true;
    grade.textContent = 'Menilai…';
    try {
      const data = await api(`/v1/coach/review/${entry.id}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      result.hidden = false;
      renderJudgeInto(result, data);
      grade.textContent = 'Nilai ulang';
      if (data.newGaps?.length) await loadCoachFacts();
    } catch (error) {
      ui.coachReviewStatus.textContent = error.message;
      grade.textContent = 'Nilai';
    } finally {
      grade.disabled = false;
    }
  });

  actions.append(grade);
  item.append(actions, result);
  return item;
}

async function loadCoachReviewQueue() {
  ui.coachReviewStatus.textContent = 'Memuat…';
  try {
    const params = new URLSearchParams({
      author: ui.coachReviewAuthor.value,
      includeReviewed: String(ui.coachReviewIncludeDone.checked),
    });
    const data = await api(`/v1/coach/review-queue?${params}`);

    ui.coachAgentSummary.replaceChildren();
    for (const row of data.summary || []) {
      const card = document.createElement('div');
      card.className = 'coach-item';
      const head = document.createElement('div');
      head.className = 'coach-item-head';
      const name = document.createElement('span');
      name.className = 'coach-q';
      name.textContent = `${row.name} · ${row.mode}`;
      head.append(name);
      const scores = document.createElement('div');
      scores.className = 'coach-scores';
      scores.style.margin = '0';
      scores.append(
        scoreTile('Rata-rata', row.avgOverall === null ? null : Math.round(Number(row.avgOverall))),
        scoreTile('Akurasi', row.avgAccuracy === null ? null : Math.round(Number(row.avgAccuracy))),
        scoreTile('Dinilai', row.graded),
      );
      card.append(head, scores);
      ui.coachAgentSummary.append(card);
    }

    ui.coachReviewList.replaceChildren();
    const replies = data.replies || [];
    if (!replies.length) {
      const empty = document.createElement('p');
      empty.className = 'team-copy';
      empty.textContent = ui.coachReviewIncludeDone.checked
        ? 'Belum ada balasan yang tercatat.'
        : 'Tidak ada balasan yang menunggu dinilai. Balasan baru akan muncul di sini setelah agent membalas customer.';
      ui.coachReviewList.append(empty);
    } else {
      replies.forEach((entry) => ui.coachReviewList.append(reviewRow(entry)));
    }
    ui.coachReviewStatus.textContent = '';
  } catch (error) {
    if (error.status === 401) { window.location.href = '/'; return; }
    ui.coachReviewStatus.textContent = error.message;
  }
}

ui.coachReviewRefresh.addEventListener('click', loadCoachReviewQueue);
ui.coachReviewAuthor.addEventListener('change', loadCoachReviewQueue);
ui.coachReviewIncludeDone.addEventListener('change', loadCoachReviewQueue);

ui.coachTabs.forEach((tab) => tab.addEventListener('click', () => {
  coachSelectTab(tab.dataset.coachTab);
  if (tab.dataset.coachTab === 'review') void loadCoachReviewQueue();
}));
ui.coachAskBtn.addEventListener('click', coachAskQuestions);
ui.coachFactForm.addEventListener('submit', saveManualFact);
ui.coachScenarioForm.addEventListener('submit', saveScenario);
ui.coachResetBtn.addEventListener('click', coachReset);
ui.coachRunBtn.addEventListener('click', runCoachSimulation);
ui.coachSimScenario.addEventListener('change', coachReset);
document.querySelectorAll('input[name="coachMode"]').forEach((radio) => {
  radio.addEventListener('change', () => { ui.coachHumanWrap.hidden = coachMode() !== 'human'; });
});

// ── WhatsApp Cloud API section ─────────────────────────────────────────────

const xport = {
  badge:      document.querySelector('#exportBadge'),
  connected:  document.querySelector('#exportConnected'),
  fileName:   document.querySelector('#exportFileName'),
  meta:       document.querySelector('#exportMeta'),
  error:      document.querySelector('#exportError'),
  form:       document.querySelector('#exportForm'),
  status:     document.querySelector('#exportStatus'),
  syncNow:    document.querySelector('#exportSyncNow'),
  toggle:     document.querySelector('#exportToggle'),
  disconnect: document.querySelector('#exportDisconnect'),
  download:   document.querySelector('#downloadCsv'),
  tenantId:   document.querySelector('#odTenantId'),
  clientId:   document.querySelector('#odClientId'),
  secret:     document.querySelector('#odClientSecret'),
  fileUrl:    document.querySelector('#odFileUrl'),
  worksheet:  document.querySelector('#odWorksheet'),
};

let exportEnabled = false;

function renderExport(data) {
  const connected = Boolean(data?.connected);
  exportEnabled = Boolean(data?.enabled);
  xport.connected.hidden = !connected;
  xport.form.hidden = connected;
  xport.badge.hidden = false;
  xport.badge.textContent = connected
    ? (exportEnabled ? 'Aktif' : 'Dimatikan')
    : 'Belum terhubung';
  xport.badge.className = `plan-badge-pill ${connected && exportEnabled ? 'plan-company' : 'plan-personal'}`;
  if (!connected) return;

  xport.fileName.textContent = data.fileName || 'File Excel';
  xport.meta.textContent = [
    `worksheet ${data.worksheetName}`,
    data.lastSyncedAt
      ? `terakhir ${new Date(data.lastSyncedAt).toLocaleString('id-ID')} (${data.lastRowCount} baris)`
      : 'belum pernah tersinkron',
  ].join(' · ');
  xport.toggle.textContent = exportEnabled ? 'Matikan' : 'Nyalakan';
  // Kegagalan terakhir ditampilkan apa adanya. Sinkronisasi berjalan di latar,
  // jadi tanpa ini kegagalannya tidak akan pernah terlihat siapa pun.
  xport.error.hidden = !data.lastError;
  xport.error.textContent = data.lastError || '';
}

async function loadExport() {
  try {
    renderExport(await api('/v1/export/onedrive'));
  } catch {
    renderExport({ connected: false });
  }
}

const waNumbers = {
  section: document.querySelector('#waNumbersSection'),
  badge:   document.querySelector('#waNumbersBadge'),
  list:    document.querySelector('#waNumbersList'),
  label:   document.querySelector('#waNumberLabel'),
  add:     document.querySelector('#addWaNumber'),
  status:  document.querySelector('#waNumberStatus'),
};

/**
 * Nomor WhatsApp Web (jalur QR). Pemasangan QR-nya sendiri terjadi di inbox,
 * karena di sanalah dialog pairing hidup — tombol di sini hanya membawa
 * supervisor ke dialog itu untuk nomor yang dipilih.
 */
function renderWaNumbers(numbers) {
  waNumbers.badge.textContent = `${numbers.filter((n) => n.phase === 'ready').length}/${numbers.length} tersambung`;
  waNumbers.badge.className = 'plan-badge-pill plan-company';
  waNumbers.badge.hidden = false;
  waNumbers.list.replaceChildren();

  for (const number of numbers) {
    const row = document.createElement('div');
    row.className = 'wa-number-row';

    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = number.label || number.connectionKey;
    const meta = document.createElement('span');
    meta.className = 'wa-number-meta';
    meta.textContent = [
      number.phoneNumber ? number.phoneNumber.replace('@c.us', '') : 'belum terhubung',
      number.phase === 'ready' ? 'siap' : number.phase,
      number.isActive ? 'dalam rotasi' : 'tidak menerima percakapan baru',
    ].filter(Boolean).join(' · ');
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'wa-number-actions';

    const scan = document.createElement('button');
    scan.type = 'button';
    scan.className = 'edit-btn';
    scan.textContent = number.phase === 'ready' ? 'Ganti nomor' : 'Scan QR';
    scan.addEventListener('click', () => {
      window.location.href = `/?connect=${encodeURIComponent(number.id)}`;
    });
    actions.append(scan);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'edit-btn';
    toggle.textContent = number.isActive ? 'Keluarkan dari rotasi' : 'Masukkan ke rotasi';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await api(`/v1/whatsapp/numbers/${number.id}`, {
          method: 'PATCH', body: JSON.stringify({ isActive: !number.isActive }),
        });
        await loadWaNumbers();
      } catch (err) { await AgneeDialog.error(err); toggle.disabled = false; }
    });
    actions.append(toggle);

    // Nomor utama adalah identitas WhatsApp company; server menolak menghapusnya.
    if (number.connectionKey !== 'whatsapp-main') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'deactivate-btn';
      remove.textContent = 'Hapus';
      remove.addEventListener('click', async () => {
        const ok = await AgneeDialog.confirm({
          title: 'Hapus nomor ini?',
          message: 'Sesi WhatsApp nomor ini diputus dan percakapan yang menempel padanya akan dibalas dari nomor lain. Untuk sekadar menghentikan percakapan baru, pakai "Keluarkan dari rotasi".',
          confirmLabel: 'Hapus nomor',
          danger: true,
        });
        if (!ok) return;
        remove.disabled = true;
        try {
          await api(`/v1/whatsapp/numbers/${number.id}`, { method: 'DELETE' });
          await loadWaNumbers();
        } catch (err) { await AgneeDialog.error(err); remove.disabled = false; }
      });
      actions.append(remove);
    }

    row.append(info, actions);
    waNumbers.list.append(row);
  }
}

async function loadWaNumbers() {
  try {
    const data = await api('/v1/whatsapp/numbers');
    renderWaNumbers(data.numbers || []);
  } catch {
    waNumbers.section.hidden = true;
  }
}

async function addWaNumber() {
  waNumbers.add.disabled = true;
  waNumbers.status.textContent = '';
  try {
    await api('/v1/whatsapp/numbers', {
      method: 'POST',
      body: JSON.stringify(waNumbers.label.value.trim() ? { label: waNumbers.label.value.trim() } : {}),
    });
    waNumbers.label.value = '';
    waNumbers.status.textContent = 'Nomor ditambahkan. Klik "Scan QR" untuk menghubungkannya.';
    await loadWaNumbers();
  } catch (err) {
    waNumbers.status.textContent = err.message;
  } finally {
    waNumbers.add.disabled = false;
  }
}

const waCloud = {
  badge:       document.querySelector('#waCloudBadge'),
  numbers:     document.querySelector('#waCloudNumbers'),
  label:       document.querySelector('#waLabel'),
  connected:   document.querySelector('#waCloudConnected'),
  webhookUrl:  document.querySelector('#waCloudWebhookUrl'),
  form:        document.querySelector('#waCloudForm'),
  disconnect:  document.querySelector('#waCloudDisconnect'),
  phoneId:     document.querySelector('#waPhoneNumberId'),
  wabaInput:   document.querySelector('#waWabaId'),
  token:       document.querySelector('#waAccessToken'),
  secret:      document.querySelector('#waAppSecret'),
  status:      document.querySelector('#waCloudStatus'),
};

/**
 * Rotator: formulir tambah nomor selalu terlihat, karena menambah nomor kedua
 * dan seterusnya adalah alur normal — bukan perbaikan koneksi yang rusak.
 */
function renderCloudNumbers(numbers) {
  const hasAny = numbers.length > 0;
  waCloud.badge.textContent = hasAny
    ? `${numbers.filter((n) => n.isActive).length} nomor aktif`
    : 'Belum terhubung';
  waCloud.badge.className = `plan-badge-pill ${hasAny ? 'plan-company' : 'plan-personal'}`;
  waCloud.badge.hidden = false;
  waCloud.connected.hidden = !hasAny;
  waCloud.webhookUrl.textContent = `${window.location.origin}/webhook/meta`;

  waCloud.numbers.replaceChildren();
  for (const number of numbers) {
    const row = document.createElement('div');
    row.className = 'wa-number-row';

    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = number.label || number.displayPhoneNumber || number.phoneNumberId;
    const meta = document.createElement('span');
    meta.className = 'wa-number-meta';
    meta.textContent = [
      number.displayPhoneNumber && number.label ? number.displayPhoneNumber : '',
      number.isActive ? 'dalam rotasi' : 'tidak menerima percakapan baru',
      number.status === 'connected' ? '' : `status: ${number.status}`,
    ].filter(Boolean).join(' · ');
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'wa-number-actions';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'edit-btn';
    toggle.textContent = number.isActive ? 'Keluarkan dari rotasi' : 'Masukkan ke rotasi';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await api(`/v1/whatsapp/cloud-api/numbers/${number.id}`, {
          method: 'PATCH', body: JSON.stringify({ isActive: !number.isActive }),
        });
        await loadCloudApiStatus();
      } catch (err) { await AgneeDialog.error(err); toggle.disabled = false; }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'deactivate-btn';
    remove.textContent = 'Hapus';
    remove.addEventListener('click', async () => {
      const ok = await AgneeDialog.confirm({
        title: 'Hapus nomor ini?',
        message: 'Percakapan yang menempel pada nomor ini ikut terhapus dari pemetaan, dan balasan berikutnya akan keluar dari nomor lain. Untuk sekadar menghentikan percakapan baru, pakai "Keluarkan dari rotasi".',
        confirmLabel: 'Hapus nomor',
        danger: true,
      });
      if (!ok) return;
      remove.disabled = true;
      try {
        await api(`/v1/whatsapp/cloud-api/numbers/${number.id}`, { method: 'DELETE' });
        await loadCloudApiStatus();
      } catch (err) { await AgneeDialog.error(err); remove.disabled = false; }
    });

    actions.append(toggle, remove);
    row.append(info, actions);
    waCloud.numbers.append(row);
  }
}

function showCloudDisconnected() {
  renderCloudNumbers([]);
}

async function loadCloudApiStatus() {
  try {
    const data = await api('/v1/whatsapp/cloud-api/numbers');
    renderCloudNumbers(data.numbers || []);
  } catch { showCloudDisconnected(); }
}

waCloud.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  waCloud.status.textContent = 'Menghubungkan…';
  const btn = waCloud.form.querySelector('#waCloudConnect');
  btn.disabled = true;
  try {
    await api('/v1/whatsapp/cloud-api/connect', {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: waCloud.phoneId.value.trim(),
        wabaId:        waCloud.wabaInput.value.trim(),
        accessToken:   waCloud.token.value.trim(),
        appSecret:     waCloud.secret.value.trim(),
        ...(waCloud.label.value.trim() ? { label: waCloud.label.value.trim() } : {}),
      }),
    });
    waCloud.status.textContent = '';
    // Kosongkan kredensial supaya nomor berikutnya tidak terkirim dengan token
    // nomor sebelumnya.
    waCloud.form.reset();
    await loadCloudApiStatus();
  } catch (err) {
    waCloud.status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
});

waCloud.disconnect.addEventListener('click', async () => {
  const okDisconnect = await AgneeDialog.confirm({
    title: tr('dialog.disconnectCloudTitle'),
    message: tr('dialog.disconnectCloudCopy'),
    confirmLabel: tr('dialog.disconnectCloudConfirm'),
    danger: true,
  });
  if (!okDisconnect) return;
  waCloud.disconnect.disabled = true;
  try {
    await api('/v1/whatsapp/cloud-api/connect', { method: 'DELETE' });
    showCloudDisconnected();
  } catch (err) {
    await AgneeDialog.error(err);
  } finally {
    waCloud.disconnect.disabled = false;
  }
});

init();
