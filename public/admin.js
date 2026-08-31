'use strict';

const AVAILABLE_MODELS = [
  { value: '', label: '— Tidak dipakai —' },
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
};

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request gagal (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setLoading(loading) {
  ui.generateButton.disabled = loading;
  ui.generateButton.querySelector('span').textContent = loading ? 'Generating…' : 'Generate preview';
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
    empty.textContent = 'Tidak ada FAQ yang cocok';
    ui.matchedFaqs.append(empty);
  } else {
    for (const faq of data.matchedFaqs) {
      const chip = document.createElement('span');
      chip.textContent = faq.id;
      chip.title = `${faq.source} · score ${faq.score}`;
      ui.matchedFaqs.append(chip);
    }
  }
  ui.inputTokens.textContent = data.usage.inputTokens.toLocaleString('id-ID');
  ui.outputTokens.textContent = data.usage.outputTokens.toLocaleString('id-ID');
  ui.totalTokens.textContent = data.usage.totalTokens.toLocaleString('id-ID');
  ui.costUsd.textContent = formatUsd(data.usage.costUsd);
  ui.resultModel.textContent = data.model;
  ui.elapsedMs.textContent = `${(data.elapsedMs / 1000).toFixed(1)} detik`;
  ui.styleResult.className = `style-result${data.style.passed ? '' : ' warn'}`;
  ui.styleResult.textContent = data.style.passed
    ? `Style check passed · ringkas dan tidak terdeteksi AI-ish${data.persistence?.saved ? ' · tersimpan di PostgreSQL' : ''}`
    : `Style warning · ${data.style.warnings.join('; ')}`;
}

async function loadHistory() {
  try {
    const data = await api('/v1/admin/playground/runs?limit=20');
    ui.historyBody.replaceChildren();
    ui.historyEmpty.hidden = data.runs.length > 0;
    ui.historyTable.hidden = data.runs.length === 0;
    if (data.runs.length === 0 && data.database.driver !== 'postgresql') {
      ui.historyEmpty.textContent = 'PostgreSQL belum dikonfigurasi; run belum disimpan permanen.';
    } else {
      ui.historyEmpty.textContent = 'Belum ada run yang tersimpan.';
    }
    for (const run of data.runs) {
      const row = document.createElement('tr');
      const values = [
        new Date(run.createdAt).toLocaleString('id-ID'),
        run.clientId,
        run.message,
        Number(run.totalTokens).toLocaleString('id-ID'),
        formatUsd(run.costUsd),
        run.stylePassed ? 'PASS' : 'WARN',
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
    ui.modelName.textContent = config.model;
    ui.sidebarModel.textContent = config.model;
    ui.llmStatus.textContent = config.llmEnabled ? 'Aktif' : 'Belum aktif';
    ui.llmStatus.className = config.llmEnabled ? 'ready' : 'error';
    ui.sidebarStatus.textContent = config.llmEnabled ? 'OpenRouter aktif' : 'OpenRouter belum aktif';
    ui.statusDot.className = `status-dot ${config.llmEnabled ? 'ready' : 'error'}`;
    ui.generateButton.disabled = !config.llmEnabled;
    ui.databaseStatus.textContent = config.database.connected ? 'PostgreSQL aktif' : 'Memory fallback';
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
    ui.generateButton.querySelector('span').textContent = 'Generate preview';
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
  ui.copyReply.textContent = 'Copied';
  setTimeout(() => { ui.copyReply.textContent = 'Copy'; }, 1200);
});

ui.refreshHistory.addEventListener('click', loadHistory);

function buildModelSlots(currentChain = []) {
  ui.modelSlots.replaceChildren();
  const SLOT_LABELS = ['Utama', 'Fallback 1', 'Fallback 2', 'Fallback 3', 'Fallback 4'];
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
      opt.textContent = m.label;
      // match exact or by suffix after slash (e.g. "qwen-2.5-72b-instruct" vs "qwen/qwen-2.5-72b-instruct")
      const isMatch = m.value === currentVal || (currentVal && m.value.endsWith('/' + currentVal));
      if (isMatch) { opt.selected = true; matched = true; }
      select.append(opt);
    }
    // If no match, add the raw value as a custom option
    if (currentVal && !matched) {
      const opt = document.createElement('option');
      opt.value = currentVal;
      opt.textContent = `${currentVal}  ·  (kustom)`;
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
    ui.toggleLabel.textContent = data.enabled ? 'AI aktif' : 'AI nonaktif';

    // If chain is empty, pre-fill slot 0 with the default model
    const chain = data.modelChain.length ? data.modelChain : [data.defaultModel];
    buildModelSlots(chain);
  } catch {
    ui.toggleLabel.textContent = 'Gagal memuat';
  }
}

ui.aiEnabledToggle.addEventListener('change', () => {
  ui.toggleLabel.textContent = ui.aiEnabledToggle.checked ? 'AI aktif' : 'AI nonaktif';
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
    alert(`Gagal menyimpan: ${err.message}`);
  } finally {
    ui.saveAiSettings.disabled = false;
  }
});

loadConfig();
loadAiSettings();
