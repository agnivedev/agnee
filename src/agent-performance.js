'use strict';

/**
 * Kinerja human agent: pemformatan dan aturan tampil. Angkanya dihitung di
 * database (getAgentPerformance) dari dua sumber yang memang mencatat siapa
 * pelakunya:
 *
 *   - outbound_replies (author = 'human', author_user_id): balasan lewat Agnee
 *   - conversation_handoffs (to_mode = 'human', to_user_id): chat diambil alih
 *
 * Yang SENGAJA tidak diukur, karena datanya tidak ada:
 *   - Balasan yang diketik langsung di aplikasi WhatsApp ponsel (tidak lewat
 *     Agnee) tidak tercatat siapa pengirimnya, jadi tidak ikut terhitung.
 *   - Kepuasan customer, hasil closing per agent, dan lama percakapan tidak
 *     dicatat per agent.
 *
 * Waktu respons = jarak dari pesan customer pertama yang menunggu (setelah
 * balasan terakhir apa pun di chat itu) sampai balasan human pertama sesudahnya.
 * Itu waktu jam dinding, bukan jam kerja: pesan malam yang dibalas pagi tampak
 * lambat. Balasan tanpa customer yang menunggu (agent yang memulai) tidak
 * punya waktu respons dan tidak dihitung.
 */

const nf = new Intl.NumberFormat('id-ID');
const num = (n) => nf.format(Number(n) || 0);

/** 45 -> "45 dtk", 130 -> "2 mnt", 5400 -> "1 jam 30 mnt", 200000 -> "2 hari 7 jam". null -> "-". */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '-';
  const total = Math.max(0, Math.round(Number(seconds)));
  if (total < 60) return `${total} dtk`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} jam ${restMinutes} mnt` : `${hours} jam`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} hari ${restHours} jam` : `${days} hari`;
}

/** Baris-baris laporan WhatsApp untuk satu agent. */
function agentLine(agent) {
  const parts = [`${num(agent.humanReplies)} balasan`, `${num(agent.chatsReplied)} chat`];
  if (agent.responseSamples) {
    parts.push(`respons tengah ${formatDuration(agent.medianResponseSeconds)} (${num(agent.responseSamples)} pengukuran)`);
  } else if (agent.humanReplies) {
    parts.push('waktu respons belum terukur');
  }
  if (agent.takeovers) parts.push(`${num(agent.takeovers)} diambil alih`);
  return `• ${agent.name}: ${parts.join(', ')}`;
}

/**
 * Bagian laporan supervisor. Kosong bila tidak ada agent yang membalas pada
 * periodenya: agent tanpa aktivitas tidak dipajang sebagai deretan nol.
 */
function formatAgentSection(agents, { max = 8 } = {}) {
  const active = (agents || []).filter((agent) => agent.humanReplies > 0 || agent.takeovers > 0);
  if (!active.length) return '';
  const shown = active.slice(0, max);
  const lines = ['*Kinerja agent (7 hari terakhir)*', ...shown.map(agentLine)];
  if (active.length > shown.length) lines.push(`… dan ${num(active.length - shown.length)} agent lain`);
  lines.push('_Hanya balasan yang dikirim lewat Agnee; balasan dari aplikasi WhatsApp di ponsel tidak tercatat per agent._');
  return lines.join('\n');
}

module.exports = { formatDuration, agentLine, formatAgentSection };
