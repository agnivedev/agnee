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
  ui.paymentLinkFields.hidden = method !== 'link';
  ui.bankTransferFields.hidden = method !== 'bank_transfer';
}

async function savePaymentConfig() {
  ui.savePaymentConfig.disabled = true;
  try {
    const method = ui.paymentMethodSelect.value;
    await api('/v1/admin/company', {
      method: 'PATCH',
      body: JSON.stringify({
        paymentMethod: method,
        paymentLink: method === 'link' ? ui.paymentLinkInput.value.trim() : '',
        bankName: method === 'bank_transfer' ? ui.bankNameInput.value.trim() : '',
        bankAccount: method === 'bank_transfer' ? ui.bankAccountInput.value.trim() : '',
        bankHolder: method === 'bank_transfer' ? ui.bankHolderInput.value.trim() : '',
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
    ]);
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/';
    }
  }
}

ui.paymentMethodSelect.addEventListener('change', () => updatePaymentFields(ui.paymentMethodSelect.value));
ui.savePaymentConfig.addEventListener('click', savePaymentConfig);
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

const waCloud = {
  badge:       document.querySelector('#waCloudBadge'),
  connected:   document.querySelector('#waCloudConnected'),
  phone:       document.querySelector('#waCloudPhone'),
  wabaId:      document.querySelector('#waCloudWabaId'),
  webhookUrl:  document.querySelector('#waCloudWebhookUrl'),
  form:        document.querySelector('#waCloudForm'),
  disconnect:  document.querySelector('#waCloudDisconnect'),
  phoneId:     document.querySelector('#waPhoneNumberId'),
  wabaInput:   document.querySelector('#waWabaId'),
  token:       document.querySelector('#waAccessToken'),
  secret:      document.querySelector('#waAppSecret'),
  status:      document.querySelector('#waCloudStatus'),
};

function showCloudConnected(conn) {
  waCloud.phone.textContent = conn.displayPhoneNumber || conn.phoneNumberId;
  waCloud.wabaId.textContent = `WABA ID: ${conn.wabaId}`;
  waCloud.webhookUrl.textContent = `${window.location.origin}/webhook/meta`;
  waCloud.badge.textContent = 'Terhubung ✓';
  waCloud.badge.className = 'plan-badge-pill plan-company';
  waCloud.badge.hidden = false;
  waCloud.connected.hidden = false;
  waCloud.form.hidden = true;
}

function showCloudDisconnected() {
  waCloud.badge.textContent = 'Belum terhubung';
  waCloud.badge.className = 'plan-badge-pill plan-personal';
  waCloud.badge.hidden = false;
  waCloud.connected.hidden = true;
  waCloud.form.hidden = false;
}

async function loadCloudApiStatus() {
  try {
    const data = await api('/v1/whatsapp/status');
    if (data.provider === 'cloud_api' && data.phase === 'ready') {
      showCloudConnected({ displayPhoneNumber: data.account, phoneNumberId: '', wabaId: '' });
    } else {
      showCloudDisconnected();
    }
  } catch { showCloudDisconnected(); }
}

waCloud.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  waCloud.status.textContent = 'Menghubungkan…';
  const btn = waCloud.form.querySelector('#waCloudConnect');
  btn.disabled = true;
  try {
    const conn = await api('/v1/whatsapp/cloud-api/connect', {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: waCloud.phoneId.value.trim(),
        wabaId:        waCloud.wabaInput.value.trim(),
        accessToken:   waCloud.token.value.trim(),
        appSecret:     waCloud.secret.value.trim(),
      }),
    });
    waCloud.status.textContent = '';
    showCloudConnected(conn);
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
