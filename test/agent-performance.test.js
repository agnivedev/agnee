'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ap = require('../src/agent-performance');
const report = require('../src/supervisor-report');

test('formatDuration: detik, menit, jam, hari, dan tidak ada data', () => {
  assert.equal(ap.formatDuration(45), '45 dtk');
  assert.equal(ap.formatDuration(130), '2 mnt');
  assert.equal(ap.formatDuration(5400), '1 jam 30 mnt');
  assert.equal(ap.formatDuration(7200), '2 jam');
  assert.equal(ap.formatDuration(200000), '2 hari 7 jam');
  assert.equal(ap.formatDuration(null), '-');
});

const DEWI = { name: 'Dewi', humanReplies: 42, chatsReplied: 17, responseSamples: 15, medianResponseSeconds: 190, takeovers: 3 };
const RAKA = { name: 'Raka', humanReplies: 5, chatsReplied: 2, responseSamples: 0, medianResponseSeconds: null, takeovers: 0 };

test('bagian agent: kosong bila tak ada yang membalas, jujur soal yang tak terukur', () => {
  assert.equal(ap.formatAgentSection([]), '');
  assert.equal(ap.formatAgentSection([{ name: 'Nihil', humanReplies: 0, takeovers: 0 }]), '');
  const text = ap.formatAgentSection([DEWI, RAKA]);
  assert.match(text, /Dewi: 42 balasan, 17 chat, respons tengah 3 mnt \(15 pengukuran\), 3 diambil alih/);
  assert.match(text, /Raka: 5 balasan, 2 chat, waktu respons belum terukur/);
  assert.match(text, /tidak tercatat per agent/);
  assert.ok(!/Nihil/.test(text));
});

const STATS = { inboundMessages: 10, activeChats: 4, newChats: 1, aiReplies: 6, humanReplies: 4, handoffs: 1, hotLeads: 0 };
const OVERVIEW = [{ key: '7d', label: '7 hari terakhir', versus: '7 hari sebelumnya', stats: STATS, prev: STATS }];
const base = { companyName: 'Toko', frequency: 'daily', tz: 'Asia/Jakarta', now: new Date('2026-10-15T03:00:00Z'), overview: OVERVIEW };

test('laporan supervisor: template bawaan memuat kinerja agent; tanpa agent hasilnya sama seperti dulu', () => {
  const withAgents = report.buildReport({ ...base, agents: [DEWI] });
  assert.match(withAgents, /\*Kinerja agent \(7 hari terakhir\)\*/);
  const without = report.buildReport({ ...base, agents: [] });
  assert.ok(!/Kinerja agent/.test(without));
  assert.ok(!/\n\n\n/.test(without), 'penanda kosong tidak meninggalkan baris kosong berlipat');
  assert.equal(without, report.buildReport({ ...base }));
});

test('template kustom hanya menampilkan agent bila memakai {agents}; penanda dikenal validator', () => {
  assert.equal(report.validateTemplate('Halo {name}\n{agents}'), null);
  const custom = report.buildReport({ ...base, agents: [DEWI], template: 'Ringkas: {inbound}' });
  assert.ok(!/Dewi/.test(custom));
  assert.match(report.buildReport({ ...base, agents: [DEWI], template: '{agents}' }), /Dewi/);
});
