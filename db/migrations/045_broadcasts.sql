-- Broadcast: satu pesan yang sama ke banyak customer sekaligus.
--
-- Penerimanya dibekukan saat broadcast dibuat (broadcast_recipients), bukan
-- dihitung ulang tiap putaran. Supervisor menyetujui daftar yang ia lihat di
-- layar; customer yang baru masuk sejam kemudian tidak boleh ikut terkirim
-- tanpa pernah tampil di daftar itu.
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Isi apa adanya, termasuk {nama}. Diganti per penerima saat dikirim.
  body TEXT NOT NULL CHECK (btrim(body) <> ''),
  -- Kalimat cara berhenti ditempel di bawah isi. Disimpan sebagai pilihan,
  -- bukan digabung ke body, supaya halaman detail tetap menampilkan isi yang
  -- ditulis orangnya.
  opt_out_footer BOOLEAN NOT NULL DEFAULT TRUE,
  -- Saringan yang dipakai saat daftar penerima dibentuk. Hanya catatan: daftar
  -- yang berlaku adalah broadcast_recipients.
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('scheduled', 'sending', 'paused', 'done', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  -- Kenapa pengirim berhenti sendiri (nomor terputus, gagal beruntun). Kosong
  -- kalau supervisor yang menjeda.
  pause_reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (company_id, id)
);

CREATE INDEX IF NOT EXISTS broadcasts_company_idx
  ON broadcasts (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS broadcasts_active_idx
  ON broadcasts (status) WHERE status IN ('scheduled', 'sending');

-- status penerima:
--   pending  belum disentuh
--   sending  sudah diklaim pengirim; pesannya mungkin sedang di jalan
--   sent     WhatsApp menerimanya
--   failed   gagal sebelum sampai WhatsApp (nomor mati, aturan 24 jam Meta, …)
--   skipped  sengaja tidak dikirim (customer berhenti berlangganan di tengah jalan,
--            broadcast dibatalkan)
--   unknown  diklaim tapi prosesnya mati sebelum hasilnya tercatat. Tidak
--            pernah dikirim ulang: pesan yang hilang lebih murah daripada pesan
--            ganda ke customer sungguhan (lihat insiden follow-up 14 Sep).
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id UUID NOT NULL,
  company_id UUID NOT NULL,
  chat_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
  error TEXT,
  message_id TEXT,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  UNIQUE (broadcast_id, chat_id),
  FOREIGN KEY (company_id, broadcast_id)
    REFERENCES broadcasts (company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS broadcast_recipients_queue_idx
  ON broadcast_recipients (broadcast_id, id) WHERE status = 'pending';
-- Jarak antar pesan dan plafon harian dihitung dari waktu klaim, per company:
-- percobaan yang gagal pun sudah menyentuh WhatsApp dan ikut dihitung.
CREATE INDEX IF NOT EXISTS broadcast_recipients_claimed_idx
  ON broadcast_recipients (company_id, claimed_at DESC) WHERE claimed_at IS NOT NULL;

-- Customer yang membalas STOP. Berlaku untuk semua broadcast company itu,
-- sekarang dan nanti, sampai supervisor menghapusnya (customer minta lagi).
CREATE TABLE IF NOT EXISTS broadcast_opt_outs (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  -- Kata persis yang dikirim customer, sebagai bukti kenapa ia dikeluarkan.
  keyword TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);

-- Pesan broadcast tercatat di outbound_replies dengan penulisnya sendiri.
-- Dicatat sebagai 'human' ia akan membanjiri antrean nilai balasan di Coach
-- dengan ratusan pesan identik, dan terhitung "sudah dibalas" oleh SLA padahal
-- tidak menjawab apa pun.
ALTER TABLE outbound_replies DROP CONSTRAINT IF EXISTS outbound_replies_author_check;
ALTER TABLE outbound_replies ADD CONSTRAINT outbound_replies_author_check
  CHECK (author IN ('ai', 'human', 'broadcast'));
