'use strict';

/**
 * SLA tugas: kapan sebuah percakapan dianggap terlalu lama tidak dibalas.
 *
 * Yang dihitung adalah waktu sejak pesan terakhir customer yang BELUM dibalas
 * manusia — bukan sejak tugasnya ditugaskan. Bedanya penting: tugas yang sudah
 * dibalas dan tinggal menunggu jawaban customer tidak sedang menahan siapa pun,
 * jadi tidak pantas dihitung telat. Yang diukur adalah orang yang sedang
 * menunggu.
 *
 * Waktunya dihitung dalam JAM KERJA, bukan waktu dinding. Chat yang masuk jam
 * 22:00 tidak boleh sudah telat 11 jam saat tim datang jam 09:00 — itu membuat
 * seluruh papan merah setiap pagi, dan papan yang selalu merah berhenti dibaca.
 * Jam di luar jam kerja tidak dihitung sama sekali, bukan sekadar tidak
 * dinotifikasi.
 *
 * Semua fungsi di sini murni: tidak menyentuh database, tidak membaca jam
 * sistem sendiri (`sekarang` selalu dioper), jadi bisa diuji tanpa menunggu
 * waktu berjalan.
 */

/** Ambang per prioritas, dalam menit kerja. Dipilih Hanny 2026-09-21. */
const AMBANG_MENIT = {
  urgent: 15,
  high: 30,
  normal: 120,
  low: 480,
};

/** 0 = Minggu … 6 = Sabtu. Senin–Sabtu, 09:00–18:00 waktu company. */
const JAM_KERJA = { mulai: 9, selesai: 18, hari: [1, 2, 3, 4, 5, 6] };

/** Selisih zona waktu (ms) pada satu titik waktu tertentu. */
function offsetZona(instantMs, zona) {
  const bagian = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const p = {};
  for (const item of bagian) p[item.type] = item.value;
  const sebagaiUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return sebagaiUtc - instantMs;
}

/** Tanggal kalender di zona itu, sebagai {tahun, bulan, tanggal}. */
function tanggalLokal(instantMs, zona) {
  const offset = offsetZona(instantMs, zona);
  const lokal = new Date(instantMs + offset);
  return { tahun: lokal.getUTCFullYear(), bulan: lokal.getUTCMonth() + 1, tanggal: lokal.getUTCDate() };
}

/**
 * Titik waktu sungguhan untuk jam dinding lokal tertentu.
 *
 * Dua langkah, bukan satu: offset pada tebakan pertama bisa berbeda dari offset
 * pada hasilnya di zona yang punya DST. Asia/Jakarta tidak punya DST, tapi
 * `companies.timezone` bisa diisi zona lain dan halaman ini tidak boleh
 * menghitung salah di sana.
 */
function instanUntukLokal({ tahun, bulan, tanggal }, jam, menit, zona) {
  const tebakan = Date.UTC(tahun, bulan - 1, tanggal, jam, menit);
  const sekali = tebakan - offsetZona(tebakan, zona);
  return tebakan - offsetZona(sekali, zona);
}

/** Hari dalam pekan (0 = Minggu) untuk satu tanggal kalender. */
function hariPekan({ tahun, bulan, tanggal }) {
  return new Date(Date.UTC(tahun, bulan - 1, tanggal)).getUTCDay();
}

function besok({ tahun, bulan, tanggal }) {
  const d = new Date(Date.UTC(tahun, bulan - 1, tanggal + 1));
  return { tahun: d.getUTCFullYear(), bulan: d.getUTCMonth() + 1, tanggal: d.getUTCDate() };
}

/**
 * Berapa menit kerja yang lewat antara dua titik waktu.
 *
 * Dihitung per hari lalu dijumlahkan, bukan dengan melangkah per menit: satu
 * tugas yang menggantung dua minggu hanya butuh belasan putaran, bukan ribuan.
 */
function menitKerja(mulaiMs, selesaiMs, zona, jamKerja = JAM_KERJA) {
  if (!(selesaiMs > mulaiMs)) return 0;
  let total = 0;
  let hari = tanggalLokal(mulaiMs, zona);
  const hariAkhir = tanggalLokal(selesaiMs, zona);
  // Pagar kalau ada tanggal yang tidak masuk akal (jam sistem melompat, data
  // lama): tanpa ini loopnya bisa berjalan sangat lama.
  for (let putaran = 0; putaran < 400; putaran += 1) {
    if (jamKerja.hari.includes(hariPekan(hari))) {
      const awal = instanUntukLokal(hari, jamKerja.mulai, 0, zona);
      const akhir = instanUntukLokal(hari, jamKerja.selesai, 0, zona);
      const irisanAwal = Math.max(awal, mulaiMs);
      const irisanAkhir = Math.min(akhir, selesaiMs);
      if (irisanAkhir > irisanAwal) total += (irisanAkhir - irisanAwal) / 60_000;
    }
    if (hari.tahun === hariAkhir.tahun && hari.bulan === hariAkhir.bulan && hari.tanggal === hariAkhir.tanggal) break;
    hari = besok(hari);
  }
  return Math.floor(total);
}

/**
 * Apa yang harus dilakukan untuk satu tugas yang sedang menunggu dibalas.
 *
 * Eskalasi dan peringatan dinilai terpisah supaya tugas yang sudah lewat 2x
 * ambang saat penjadwalnya baru hidup lagi tidak kehilangan keduanya: yang
 * seperti itu memberi tahu agent DAN supervisor sekaligus.
 */
function statusSla({
  prioritas = 'normal',
  menungguSejakMs,
  sekarangMs,
  zona = 'Asia/Jakarta',
  sudahDiperingatkan = false,
  sudahDieskalasi = false,
  jamKerja = JAM_KERJA,
  ambangMenit = AMBANG_MENIT,
}) {
  const ambang = ambangMenit[prioritas] ?? ambangMenit.normal;
  const menit = menitKerja(menungguSejakMs, sekarangMs, zona, jamKerja);
  return {
    menitKerja: menit,
    ambang,
    peringatkanAgent: menit >= ambang && !sudahDiperingatkan,
    eskalasiKeSupervisor: menit >= ambang * 2 && !sudahDieskalasi,
  };
}

/** "2 jam 5 menit" — untuk isi notifikasi, bukan untuk log. */
function sebagaiDurasi(menit) {
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  if (jam && sisa) return `${jam} jam ${sisa} menit`;
  if (jam) return `${jam} jam`;
  return `${sisa} menit`;
}

/** Peran yang dianggap supervisor — sama dengan normalizeRole() di server. */
const PERAN_SUPERVISOR = ['owner', 'supervisor', 'admin'];

/**
 * Satu putaran pemeriksaan SLA untuk seluruh company.
 *
 * Dipisahkan dari penjadwalnya supaya bisa diuji tanpa menunggu timer dan tanpa
 * database sungguhan: `sekarangMs` dioper, dan `database` boleh berupa tiruan.
 *
 * Kegagalan pada satu tugas tidak boleh menghentikan sisanya — satu chat yang
 * datanya aneh jangan sampai membuat seluruh papan berhenti diperiksa.
 */
async function putaranSla({ database, sekarangMs = Date.now(), log = console, onNotifikasi }) {
  const baris = await database.listTasksAwaitingReply();
  const supervisorPerCompany = new Map();
  let diperingatkan = 0;
  let dieskalasi = 0;

  for (const tugas of baris) {
    try {
      const menungguSejakMs = new Date(tugas.menungguSejak).getTime();
      if (!Number.isFinite(menungguSejakMs)) continue;
      const stempel = (nilai) => (nilai ? new Date(nilai).getTime() : 0);

      const hasil = statusSla({
        prioritas: tugas.priority,
        menungguSejakMs,
        sekarangMs,
        zona: tugas.timezone || 'Asia/Jakarta',
        // Stempel dibandingkan dengan waktu pesan yang sedang ditunggu: kalau
        // customer mengirim pesan BARU setelah peringatan terakhir, penantian
        // ini belum pernah diberitahukan.
        sudahDiperingatkan: stempel(tugas.slaWarnedAt) >= menungguSejakMs,
        sudahDieskalasi: stempel(tugas.slaEscalatedAt) >= menungguSejakMs,
      });
      if (!hasil.peringatkanAgent && !hasil.eskalasiKeSupervisor) continue;

      const lama = sebagaiDurasi(hasil.menitKerja);
      const penerima = [];

      if (hasil.peringatkanAgent) {
        penerima.push({
          userId: tugas.assigneeUserId,
          body: `Customer sudah menunggu ${lama} (dihitung jam kerja) dan belum dibalas.`,
        });
        diperingatkan += 1;
      }

      if (hasil.eskalasiKeSupervisor) {
        if (!supervisorPerCompany.has(tugas.companyId)) {
          const anggota = await database.listTeamMembers(tugas.companyId).catch(() => []);
          supervisorPerCompany.set(
            tugas.companyId,
            anggota.filter((m) => m.status === 'active' && PERAN_SUPERVISOR.includes(m.role)),
          );
        }
        for (const supervisor of supervisorPerCompany.get(tugas.companyId)) {
          // Supervisor yang kebetulan memegang tugas itu sendiri sudah dapat
          // peringatannya di atas; jangan dikirimi dua kali untuk hal yang sama.
          if (supervisor.id === tugas.assigneeUserId) continue;
          penerima.push({
            userId: supervisor.id,
            body: `Belum dibalas ${lama} (dihitung jam kerja) — lewat dua kali batas dan belum ditangani pemegangnya.`,
          });
        }
        dieskalasi += 1;
      }

      for (const { userId, body } of penerima) {
        await database.createTaskNotification(
          { chatId: tugas.chatId, userId, actorUserId: null, body, kind: 'sla' },
          tugas.companyId,
        );
      }

      await database.markTaskSla({
        chatId: tugas.chatId,
        menungguSejak: tugas.menungguSejak,
        warned: hasil.peringatkanAgent,
        escalated: hasil.eskalasiKeSupervisor,
      }, tugas.companyId);

      if (onNotifikasi && penerima.length) {
        onNotifikasi({ companyId: tugas.companyId, userIds: penerima.map((p) => p.userId) });
      }
    } catch (error) {
      log.warn?.({ err: error, chatId: tugas.chatId }, 'SLA: satu tugas gagal diperiksa');
    }
  }

  return { diperiksa: baris.length, diperingatkan, dieskalasi };
}

module.exports = { AMBANG_MENIT, JAM_KERJA, menitKerja, statusSla, sebagaiDurasi, putaranSla };
