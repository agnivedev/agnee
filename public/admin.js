'use strict';

const tr = (key, vars) => window.AgneeI18n.t(key, vars);

const AVAILABLE_MODELS = [
  { value: '', labelKey: 'admin.notUsed' },
  { value: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B  ·  $0.02/1M' },
  { value: 'mistralai/mistral-7b-instruct', label: 'Mistral 7B  ·  $0.14/1M' },
  { value: 'google/gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash  ·  $0.075/1M' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini  ·  $0.15/1M' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku  ·  $0.80/1M' },
  { value: 'qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B  ·  $0.40/1M (default)' },
  { value: 'openai/gpt-4-turbo', label: 'GPT-4 Turbo  ·  $10/1M' },
  { value: 'anthropic/claude-opus-4-1', label: 'Claude Opus 4.1  ·  $15/1M' },
];

function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n\d+\. /g, '<br>');

  return html;
}

const ui = {
  aiEnabledToggle: document.querySelector('#aiEnabledToggle'),
  toggleLabel: document.querySelector('#toggleLabel'),
  modelSlots: document.querySelector('#modelSlots'),
  saveAiSettings: document.querySelector('#saveAiSettings'),
  aiSettingsSaved: document.querySelector('#aiSettingsSaved'),
  form: document.querySelector('#playgroundForm'),
  clientId: document.querySelector('#clientId'),
  message: document.querySelector('#message'),
  generateButton: document.querySelector('#generateButton'),
  formError: document.querySelector('#formError'),
  modelName: document.querySelector('#modelName'),
  llmStatus: document.querySelector('#llmStatus'),
  databaseStatus: document.querySelector('#databaseStatus'),
  sidebarStatus: document.querySelector('#sidebarStatus'),
  sidebarModel: document.querySelector('#sidebarModel'),
  statusDot: document.querySelector('.status-dot'),
  emptyResult: document.querySelector('#emptyResult'),
  loadingResult: document.querySelector('#loadingResult'),
  resultContent: document.querySelector('#resultContent'),
  matchedFaqs: document.querySelector('#matchedFaqs'),
  replyText: document.querySelector('#replyText'),
  styleResult: document.querySelector('#styleResult'),
  inputTokens: document.querySelector('#inputTokens'),
  outputTokens: document.querySelector('#outputTokens'),
  totalTokens: document.querySelector('#totalTokens'),
  costUsd: document.querySelector('#costUsd'),
  resultModel: document.querySelector('#resultModel'),
  elapsedMs: document.querySelector('#elapsedMs'),
  copyReply: document.querySelector('#copyReply'),
  refreshHistory: document.querySelector('#refreshHistory'),
  historyEmpty: document.querySelector('#historyEmpty'),
  historyTable: document.querySelector('#historyTable'),
  historyBody: document.querySelector('#historyBody'),
  teamSection: document.querySelector('#teamSection'),
  teamMembers: document.querySelector('#teamMembers'),
  teamForm: document.querySelector('#teamForm'),
  teamStatus: document.querySelector('#teamStatus'),
};

let currentUser = null;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || tr('error.request', { status: response.status }));
    error.status = response.status;
    throw error;
  }
  return data;
}

function setLoading(loading) {
  ui.generateButton.disabled = loading;
  ui.generateButton.querySelector('span').textContent = loading ? tr('admin.generating') : tr('admin.generate');
  ui.emptyResult.hidden = true;
  ui.loadingResult.hidden = !loading;
  if (loading) {
    ui.resultContent.hidden = true;
    ui.copyReply.hidden = true;
  }
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(8)}`;
}

function renderResult(data) {
  ui.loadingResult.hidden = true;
  ui.resultContent.hidden = false;
  ui.copyReply.hidden = false;
  ui.replyText.innerHTML = renderMarkdown(data.reply);
  ui.matchedFaqs.replaceChildren();
  if (data.matchedFaqs.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'empty';
    empty.textContent = tr('admin.noMatch');
    ui.matchedFaqs.append(empty);
  } else {
    for (const faq of data.matchedFaqs) {
      const chip = document.createElement('span');
      chip.textContent = faq.id;
      chip.title = `${faq.source} · score ${faq.score}`;
      ui.matchedFaqs.append(chip);
    }
  }
  const numberLocale = window.AgneeI18n.getLocale() === 'en' ? 'en-US' : 'id-ID';
  ui.inputTokens.textContent = data.usage.inputTokens.toLocaleString(numberLocale);
  ui.outputTokens.textContent = data.usage.outputTokens.toLocaleString(numberLocale);
  ui.totalTokens.textContent = data.usage.totalTokens.toLocaleString(numberLocale);
  ui.costUsd.textContent = formatUsd(data.usage.costUsd);
  ui.resultModel.textContent = data.model;
  ui.elapsedMs.textContent = tr('admin.seconds', { seconds: (data.elapsedMs / 1000).toFixed(1) });
  ui.styleResult.className = `style-result${data.style.passed ? '' : ' warn'}`;
  ui.styleResult.textContent = data.style.passed
    ? tr('admin.stylePassed', { saved: data.persistence?.saved ? tr('admin.styleSaved') : '' })
    : tr('admin.styleWarning', { warnings: data.style.warnings.join('; ') });
}

async function loadHistory() {
  try {
    const data = await api('/v1/admin/playground/runs?limit=20');
    ui.historyBody.replaceChildren();
    ui.historyEmpty.hidden = data.runs.length > 0;
    ui.historyTable.hidden = data.runs.length === 0;
    if (data.runs.length === 0 && data.database.driver !== 'postgresql') {
      ui.historyEmpty.textContent = tr('admin.historyTemporary');
    } else {
      ui.historyEmpty.textContent = tr('admin.noHistory');
    }
    for (const run of data.runs) {
      const row = document.createElement('tr');
      const values = [
        new Date(run.createdAt).toLocaleString(window.AgneeI18n.getLocale() === 'en' ? 'en-US' : 'id-ID'),
        run.clientId,
        run.message,
        Number(run.totalTokens).toLocaleString(window.AgneeI18n.getLocale() === 'en' ? 'en-US' : 'id-ID'),
        formatUsd(run.costUsd),
        run.stylePassed ? tr('admin.pass') : tr('admin.warn'),
      ];
      values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index === 5) cell.className = run.stylePassed ? 'history-pass' : 'history-warn';
        row.append(cell);
      });
      ui.historyBody.append(row);
    }
  } catch (error) {
    ui.historyEmpty.hidden = false;
    ui.historyTable.hidden = true;
    ui.historyEmpty.textContent = error.message;
  }
}

async function loadConfig() {
  try {
    const config = await api('/v1/admin/config');
    ui.clientId.replaceChildren();
    ui.modelName.textContent = config.model;
    ui.sidebarModel.textContent = config.model;
    ui.llmStatus.textContent = config.llmEnabled ? tr('admin.active') : tr('admin.inactive');
    ui.llmStatus.className = config.llmEnabled ? 'ready' : 'error';
    ui.sidebarStatus.textContent = config.llmEnabled ? tr('admin.aiActive') : tr('admin.aiInactive');
    ui.statusDot.className = `status-dot ${config.llmEnabled ? 'ready' : 'error'}`;
    ui.generateButton.disabled = !config.llmEnabled;
    ui.databaseStatus.textContent = config.database.connected ? tr('admin.storageActive') : tr('admin.storageTemporary');
    ui.databaseStatus.className = config.database.connected ? 'ready' : 'error';
    for (const client of config.knowledgeClients) {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = client.name;
      option.selected = client.id === config.defaultKnowledgeClient;
      ui.clientId.append(option);
    }
    await loadHistory();
  } catch (error) {
    if (error.status === 401) {
      window.location.href = '/';
      return;
    }
    ui.formError.textContent = error.message;
    ui.llmStatus.textContent = 'Tidak tersedia';
    ui.llmStatus.className = 'error';
    ui.statusDot.className = 'status-dot error';
  }
}

function renderTeam(members) {
  ui.teamMembers.replaceChildren();
  const isSupervisor = currentUser && ['owner', 'admin', 'supervisor'].includes(currentUser.role);
  for (const member of members) {
    const row = document.createElement('div');
    row.className = 'team-member';
    const name = member.displayName || member.email;
    const isOwner = member.role === 'owner';
    const isSelf = currentUser && member.id === currentUser.id;

    const avatarEl = document.createElement('span');
    avatarEl.className = 'member-avatar';
    avatarEl.textContent = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

    const infoEl = document.createElement('span');
    infoEl.innerHTML = '<strong></strong><small></small>';
    infoEl.querySelector('strong').textContent = name + (isSelf ? ' (kamu)' : '');
    infoEl.querySelector('small').textContent = member.email;

    const roleEl = document.createElement('b');
    roleEl.className = 'member-role';
    roleEl.textContent = ['owner', 'admin', 'supervisor'].includes(member.role) ? tr('team.supervisor') : tr('team.agent');

    row.append(avatarEl, infoEl, roleEl);

    if (isSupervisor && !isOwner && !isSelf) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'member-actions';

      const roleSelect = document.createElement('select');
      roleSelect.className = 'member-role-select';
      [{ value: 'agent', label: tr('team.agent') }, { value: 'supervisor', label: tr('team.supervisor') }].forEach(({ value, label }) => {
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


async function loadTeam() {
  try {
    const [session, data] = await Promise.all([api('/v1/auth/session'), api('/v1/team/members')]);
    currentUser = session.user;
    renderTeam(data.members || []);
    ui.teamForm.hidden = !['owner', 'admin', 'supervisor'].includes(currentUser?.role) && !currentUser?.apiClient;
  } catch (error) {
    ui.teamStatus.textContent = error.message;
  }
}

ui.teamForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(ui.teamForm);
  const button = ui.teamForm.querySelector('button');
  button.disabled = true;
  ui.teamStatus.textContent = tr('common.loading');
  try {
    await api('/v1/team/members', {
      method: 'POST',
      body: JSON.stringify({
        displayName: form.get('displayName'), email: form.get('email'),
        password: form.get('password'), role: form.get('role'),
      }),
    });
    ui.teamForm.reset();
    ui.teamStatus.textContent = tr('team.added');
    await loadTeam();
  } catch (error) {
    ui.teamStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

ui.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  ui.formError.textContent = '';
  setLoading(true);
  try {
    const data = await api('/v1/admin/playground/auto-reply', {
      method: 'POST',
      body: JSON.stringify({ message: ui.message.value.trim(), clientId: ui.clientId.value }),
    });
    renderResult(data);
    await loadHistory();
  } catch (error) {
    ui.loadingResult.hidden = true;
    ui.emptyResult.hidden = false;
    ui.formError.textContent = error.message;
    if (error.status === 401) window.location.href = '/';
  } finally {
    ui.generateButton.disabled = false;
    ui.generateButton.querySelector('span').textContent = tr('admin.generate');
  }
});

document.querySelectorAll('[data-message]').forEach((button) => {
  button.addEventListener('click', () => {
    ui.message.value = button.dataset.message;
    ui.message.focus();
  });
});

ui.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    ui.form.requestSubmit();
  }
});

ui.copyReply.addEventListener('click', async () => {
  await navigator.clipboard.writeText(ui.replyText.textContent);
  ui.copyReply.textContent = tr('common.copied');
  setTimeout(() => { ui.copyReply.textContent = tr('common.copy'); }, 1200);
});

ui.refreshHistory.addEventListener('click', loadHistory);

function buildModelSlots(currentChain = []) {
  ui.modelSlots.replaceChildren();
  const SLOT_LABELS = [tr('admin.primary'), ...Array.from({ length: 4 }, (_, index) => tr('admin.nextModel', { number: index + 1 }))];
  for (let i = 0; i < 5; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'model-slot';

    const badge = document.createElement('span');
    badge.className = `slot-badge${i === 0 ? ' slot-primary' : ''}`;
    badge.textContent = SLOT_LABELS[i];

    const select = document.createElement('select');
    select.id = `modelSlot${i}`;
    select.className = 'model-slot-select';
    select.setAttribute('aria-label', `Model slot ${SLOT_LABELS[i]}`);

    const currentVal = currentChain[i] || '';
    let matched = false;
    for (const m of AVAILABLE_MODELS) {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.labelKey ? tr(m.labelKey) : m.label;
      // match exact or by suffix after slash (e.g. "qwen-2.5-72b-instruct" vs "qwen/qwen-2.5-72b-instruct")
      const isMatch = m.value === currentVal || (currentVal && m.value.endsWith('/' + currentVal));
      if (isMatch) { opt.selected = true; matched = true; }
      select.append(opt);
    }
    // If no match, add the raw value as a custom option
    if (currentVal && !matched) {
      const opt = document.createElement('option');
      opt.value = currentVal;
      opt.textContent = `${currentVal}  ·  (${tr('admin.custom')})`;
      opt.selected = true;
      select.insertBefore(opt, select.children[1]);
    }

    wrap.append(badge, select);
    ui.modelSlots.append(wrap);
  }
}

async function loadAiSettings() {
  try {
    const data = await api('/v1/admin/ai-settings');
    ui.aiEnabledToggle.checked = data.enabled;
    ui.toggleLabel.textContent = data.enabled ? tr('admin.aiOn') : tr('admin.aiOff');

    // If chain is empty, pre-fill slot 0 with the default model
    const chain = data.modelChain.length ? data.modelChain : [data.defaultModel];
    buildModelSlots(chain);
  } catch {
    ui.toggleLabel.textContent = tr('admin.loadFailed');
  }
}

ui.aiEnabledToggle.addEventListener('change', () => {
  ui.toggleLabel.textContent = ui.aiEnabledToggle.checked ? tr('admin.aiOn') : tr('admin.aiOff');
});

ui.saveAiSettings.addEventListener('click', async () => {
  const modelChain = Array.from({ length: 5 }, (_, i) => {
    const sel = document.querySelector(`#modelSlot${i}`);
    return sel ? sel.value : '';
  }).filter(Boolean);

  ui.saveAiSettings.disabled = true;
  try {
    await api('/v1/admin/ai-settings', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: ui.aiEnabledToggle.checked, modelChain }),
    });
    ui.aiSettingsSaved.hidden = false;
    setTimeout(() => { ui.aiSettingsSaved.hidden = true; }, 2500);
  } catch (err) {
    alert(tr('admin.saveFailed', { message: err.message }));
  } finally {
    ui.saveAiSettings.disabled = false;
  }
});

const playbookUi = {
  brief: document.querySelector('#playbookBrief'),
  saveBrief: document.querySelector('#savePlaybookBrief'),
  briefSaved: document.querySelector('#playbookBriefSaved'),
  dropzone: document.querySelector('#playbookDropzone'),
  fileInput: document.querySelector('#playbookFileInput'),
  uploadStatus: document.querySelector('#playbookUploadStatus'),
  assets: document.querySelector('#playbookAssets'),
};

const PLAYBOOK_KIND_ICON = { document: '📄', image: '🖼', video: '🎬', audio: '🎵', other: '📎' };
const PLAYBOOK_STATUS_LABEL = { ready: 'Terbaca AI', unsupported: 'Belum diproses', failed: 'Gagal dibaca' };

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPlaybookAssets(assets) {
  playbookUi.assets.replaceChildren();
  if (!assets.length) {
    const empty = document.createElement('p');
    empty.className = 'playbook-assets-empty';
    empty.textContent = 'Belum ada dokumen yang diunggah.';
    playbookUi.assets.append(empty);
    return;
  }
  for (const asset of assets) {
    const row = document.createElement('div');
    row.className = 'playbook-asset';
    const icon = document.createElement('div');
    icon.className = 'playbook-asset-icon';
    icon.textContent = PLAYBOOK_KIND_ICON[asset.kind] || '📎';
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = asset.filename;
    const meta = document.createElement('small');
    meta.textContent = formatFileSize(asset.sizeBytes);
    info.append(name, meta);
    const status = document.createElement('span');
    status.className = `playbook-asset-status ${asset.extractionStatus}`;
    status.textContent = PLAYBOOK_STATUS_LABEL[asset.extractionStatus] || asset.extractionStatus;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'playbook-asset-delete';
    del.textContent = 'Hapus';
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        await api(`/v1/admin/playbook/assets/${asset.id}`, { method: 'DELETE' });
        row.remove();
        if (!playbookUi.assets.children.length) renderPlaybookAssets([]);
      } catch (error) {
        alert(`Gagal menghapus file: ${error.message}`);
        del.disabled = false;
      }
    });
    row.append(icon, info, status, del);
    playbookUi.assets.append(row);
  }
}

async function loadPlaybook() {
  try {
    const data = await api('/v1/admin/playbook');
    playbookUi.brief.value = data.brief || '';
    renderPlaybookAssets(data.assets || []);
  } catch (error) {
    playbookUi.uploadStatus.textContent = `Gagal memuat playbook: ${error.message}`;
    playbookUi.uploadStatus.classList.add('error');
  }
}

playbookUi.saveBrief.addEventListener('click', async () => {
  playbookUi.saveBrief.disabled = true;
  try {
    await api('/v1/admin/playbook', { method: 'PUT', body: JSON.stringify({ brief: playbookUi.brief.value }) });
    playbookUi.briefSaved.hidden = false;
    setTimeout(() => { playbookUi.briefSaved.hidden = true; }, 2500);
  } catch (error) {
    alert(`Gagal menyimpan brief: ${error.message}`);
  } finally {
    playbookUi.saveBrief.disabled = false;
  }
});

async function uploadPlaybookFile(file) {
  playbookUi.uploadStatus.classList.remove('error');
  playbookUi.uploadStatus.textContent = `Mengunggah ${file.name}…`;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await fetch('/v1/admin/playbook/assets', { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    playbookUi.uploadStatus.textContent = `${file.name} berhasil diunggah.`;
    await loadPlaybook();
  } catch (error) {
    playbookUi.uploadStatus.textContent = `Gagal mengunggah ${file.name}: ${error.message}`;
    playbookUi.uploadStatus.classList.add('error');
  }
}

playbookUi.fileInput.addEventListener('change', () => {
  if (playbookUi.fileInput.files[0]) uploadPlaybookFile(playbookUi.fileInput.files[0]);
  playbookUi.fileInput.value = '';
});

['dragover', 'dragenter'].forEach((evt) => {
  playbookUi.dropzone.addEventListener(evt, (event) => {
    event.preventDefault();
    playbookUi.dropzone.classList.add('dragover');
  });
});
['dragleave', 'dragend', 'drop'].forEach((evt) => {
  playbookUi.dropzone.addEventListener(evt, (event) => {
    event.preventDefault();
    playbookUi.dropzone.classList.remove('dragover');
  });
});
playbookUi.dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadPlaybookFile(file);
});

loadConfig();
loadAiSettings();
loadTeam();
loadPlaybook();

window.addEventListener('agnee:localechange', () => {
  loadConfig();
  loadAiSettings();
  loadTeam();
});
