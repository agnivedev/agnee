'use strict';

const ui = {
  sidebarDot: document.querySelector('#sidebarDot'),
  sidebarName: document.querySelector('#sidebarName'),
  sidebarRole: document.querySelector('#sidebarRole'),
  planBadge: document.querySelector('#planBadge'),
  planUsageBar: document.querySelector('#planUsageBar'),
  usageText: document.querySelector('#usageText'),
  usagePct: document.querySelector('#usagePct'),
  usageFill: document.querySelector('#usageFill'),
  knowledgeClientSelect: document.querySelector('#knowledgeClientSelect'),
  aiLimitInput: document.querySelector('#aiLimitInput'),
  savePlanConfig: document.querySelector('#savePlanConfig'),
  planSaved: document.querySelector('#planSaved'),
  teamMembers: document.querySelector('#teamMembers'),
  teamForm: document.querySelector('#teamForm'),
  teamStatus: document.querySelector('#teamStatus'),
  myAccountInfo: document.querySelector('#myAccountInfo'),
};

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

    ui.knowledgeClientSelect.value = data.knowledgeClient || 'agnee';
    ui.aiLimitInput.value = limit;
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/';
    }
  }
}

async function savePlanConfig() {
  ui.savePlanConfig.disabled = true;
  try {
    await api('/v1/admin/company', {
      method: 'PATCH',
      body: JSON.stringify({
        knowledgeClient: ui.knowledgeClientSelect.value,
        aiMessageLimit: parseInt(ui.aiLimitInput.value, 10) || 0,
      }),
    });
    ui.planSaved.hidden = false;
    setTimeout(() => { ui.planSaved.hidden = true; }, 2500);
    await loadCompanyConfig();
  } catch (err) {
    alert(err.message);
  } finally {
    ui.savePlanConfig.disabled = false;
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
          alert(err.message);
          roleSelect.value = member.role;
        }
      });

      const deactivateBtn = document.createElement('button');
      deactivateBtn.className = 'deactivate-btn';
      deactivateBtn.type = 'button';
      deactivateBtn.textContent = 'Nonaktifkan';
      deactivateBtn.addEventListener('click', async () => {
        if (!confirm(`Nonaktifkan ${name}?`)) return;
        try {
          await api(`/v1/team/members/${member.id}`, { method: 'DELETE' });
          await loadTeam();
        } catch (err) {
          alert(err.message);
        }
      });

      actionsEl.append(roleSelect, deactivateBtn);
      row.append(actionsEl);
    }

    ui.teamMembers.append(row);
  }
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

    renderMyAccount(currentUser);
    await Promise.all([loadCompanyConfig(), loadTeam()]);
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/';
    }
  }
}

ui.savePlanConfig.addEventListener('click', savePlanConfig);
ui.teamForm.addEventListener('submit', addMember);

init();
