'use strict';

const ui = {
  search: document.querySelector('#leadSearch'),
  stage: document.querySelector('#leadStage'),
  handling: document.querySelector('#leadHandling'),
  count: document.querySelector('#leadCount'),
  status: document.querySelector('#leadStatus'),
  head: document.querySelector('#leadHead'),
  body: document.querySelector('#leadBody'),
  refresh: document.querySelector('#leadRefresh'),
  xlsx: document.querySelector('#exportXlsx'),
  csv: document.querySelector('#exportCsv'),
  sidebarName: document.querySelector('#sidebarName'),
  sidebarRole: document.querySelector('#sidebarRole'),
  sidebarDot: document.querySelector('#sidebarDot'),
};

const state = {
  columns: [],
  rows: [],
  sortKey: null,
  sortDir: 'asc',
};

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

/**
 * Kolom yang ditampilkan berasal dari metadata API, bukan daftar terpisah di
 * sini. Kalau kolom ekspor berubah, tabel ikut berubah — tidak ada dua daftar
 * yang bisa saling menyimpang.
 */
function renderHead() {
  ui.head.replaceChildren();
  for (const column of state.columns) {
    const th = document.createElement('th');
    th.textContent = column.label;
    th.tabIndex = 0;
    th.setAttribute('role', 'button');
    if (state.sortKey === column.key) {
      th.classList.add('sorted');
      th.dataset.dir = state.sortDir;
    }
    const sort = () => {
      if (state.sortKey === column.key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = column.key;
        state.sortDir = 'asc';
      }
      render();
    };
    th.addEventListener('click', sort);
    th.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sort(); }
    });
    ui.head.append(th);
  }
}

/** Angka diurutkan sebagai angka; sisanya sebagai teks Indonesia. */
function compareValues(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  const bothNumeric = a !== '' && b !== '' && Number.isFinite(numA) && Number.isFinite(numB);
  if (bothNumeric) return numA - numB;
  // Baris kosong selalu di bawah, apa pun arah urutannya: baris tanpa nilai
  // bukan "paling kecil", ia hanya belum terisi.
  if (a === '' && b !== '') return 1;
  if (b === '' && a !== '') return -1;
  return String(a).localeCompare(String(b), 'id-ID');
}

function visibleRows() {
  const query = ui.search.value.trim().toLocaleLowerCase('id-ID');
  const stage = ui.stage.value;
  const handling = ui.handling.value;

  let rows = state.rows.filter((row) => {
    if (stage && row.leadStage !== stage) return false;
    if (handling && row.handlingMode !== handling) return false;
    if (!query) return true;
    return Object.values(row).some((value) => String(value).toLocaleLowerCase('id-ID').includes(query));
  });

  if (state.sortKey) {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => compareValues(a[state.sortKey], b[state.sortKey]) * dir);
  }
  return rows;
}

function render() {
  renderHead();
  const rows = visibleRows();
  ui.body.replaceChildren();

  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of state.columns) {
      const td = document.createElement('td');
      const value = row[column.key] ?? '';
      td.textContent = value;
      // Isi pesan dan ringkasan bisa panjang; dipotong di tabel, utuh di
      // tooltip dan di file ekspor.
      if (String(value).length > 60) td.title = value;
      td.dataset.key = column.key;
      tr.append(td);
    }
    ui.body.append(tr);
  }

  ui.count.textContent = rows.length === state.rows.length
    ? `${state.rows.length} percakapan`
    : `${rows.length} dari ${state.rows.length} percakapan`;
  ui.status.textContent = state.rows.length ? '' : 'Belum ada percakapan yang tercatat.';
}

function fillStageOptions() {
  const stages = [...new Set(state.rows.map((row) => row.leadStage).filter(Boolean))].sort();
  const current = ui.stage.value;
  ui.stage.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Semua tahap';
  ui.stage.append(all);
  for (const stage of stages) {
    const option = document.createElement('option');
    option.value = stage;
    option.textContent = stage;
    ui.stage.append(option);
  }
  ui.stage.value = stages.includes(current) ? current : '';
}

async function load() {
  ui.status.textContent = 'Memuat…';
  try {
    const data = await api('/v1/export/contacts');
    state.columns = data.columns || [];
    state.rows = data.rows || [];
    fillStageOptions();
    render();
  } catch (error) {
    if (error.status === 401) { window.location.href = '/'; return; }
    if (error.status === 403) {
      ui.status.textContent = 'Halaman ini hanya untuk supervisor.';
      return;
    }
    ui.status.textContent = error.message;
  }
}

async function loadSession() {
  try {
    const session = await api('/v1/auth/session');
    const user = session.user || {};
    ui.sidebarName.textContent = user.displayName || user.email || 'Pengguna';
    ui.sidebarRole.textContent = ['owner', 'admin', 'supervisor'].includes(user.role) ? 'Supervisor' : 'Agent';
    ui.sidebarDot.classList.add('online');
  } catch {
    window.location.href = '/';
  }
}

// Unduhan memakai cookie sesi yang sama seperti request lain di halaman ini.
ui.xlsx.addEventListener('click', () => { window.location.href = '/v1/export/contacts.xlsx'; });
ui.csv.addEventListener('click', () => { window.location.href = '/v1/export/contacts.csv'; });
ui.refresh.addEventListener('click', load);
ui.search.addEventListener('input', render);
ui.stage.addEventListener('change', render);
ui.handling.addEventListener('change', render);

loadSession().then(load);
