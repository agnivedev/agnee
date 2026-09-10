-- Playbook dokumen (markdown) + mesin follow-up, keduanya per company.
--
-- KENAPA MARKDOWN DI DB, BUKAN DI knowledge/clients/*.md:
-- File di knowledge/clients/ ikut ter-bake ke image container dan sama untuk
-- semua tenant. Supervisor yang menyusun playbook lewat chatbox tidak bisa
-- menulis ke repo, dan tiap company butuh versinya sendiri. Jadi playbook
-- hasil wawancara chatbox disimpan di sini; file repo tetap jadi lapisan
-- knowledge dasar per knowledge-pack.
--
-- Namanya playbook_docs, bukan playbooks, karena tabel `playbooks` (migration
-- 007) sudah dipakai untuk satu kolom brief bebas per company.
CREATE TABLE IF NOT EXISTS playbook_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Satu playbook per jenis per company. Jenis dipilih dari daftar tetap
  -- supaya reply pipeline tahu urutan prioritas saat menyusun konteks.
  kind TEXT NOT NULL CHECK (kind IN
    ('qna', 'followup', 'compliance', 'objection', 'closing', 'discovery', 'handoff', 'persona')),
  content_md TEXT NOT NULL DEFAULT '',
  -- Transkrip wawancara chatbox yang menghasilkan content_md. Disimpan supaya
  -- supervisor bisa melanjutkan percakapan, bukan mulai dari nol tiap kali.
  interview JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS playbook_docs_company_kind_idx
  ON playbook_docs (company_id, kind);

-- Riwayat versi: playbook adalah aturan yang dipakai AI untuk bicara ke
-- customer, jadi perubahannya harus bisa dilacak dan dikembalikan.
CREATE TABLE IF NOT EXISTS playbook_doc_versions (
  id BIGSERIAL PRIMARY KEY,
  doc_id UUID NOT NULL REFERENCES playbook_docs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_md TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playbook_doc_versions_doc_idx
  ON playbook_doc_versions (doc_id, version DESC);

-- ── Follow-up ──────────────────────────────────────────────────────────────
--
-- Batas kirim, BUKAN kuota yang harus dihabiskan. Angka di bawah adalah
-- plafon: mesin hanya mengirim kalau ada alasan dan jarak minimum sudah
-- terlewat. Ini penting karena mengirim beberapa pesan tak diminta dalam
-- sehari ke nomor yang tidak membalas adalah pola yang dideteksi WhatsApp
-- sebagai spam — kalau nomornya kena, seluruh channel company itu mati,
-- bukan cuma satu lead yang hilang.
CREATE TABLE IF NOT EXISTS follow_up_settings (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Plafon per hari sejak lead terakhir membalas. Default 5/3/2 lalu berhenti.
  day_caps INTEGER[] NOT NULL DEFAULT ARRAY[5, 3, 2],
  -- Jarak minimum antar follow-up. Tanpa ini, plafon harian bisa terkirim
  -- berturut-turut dalam beberapa menit dan itulah yang memicu laporan spam.
  min_gap_minutes INTEGER NOT NULL DEFAULT 120 CHECK (min_gap_minutes >= 30),
  -- Jam kirim yang diizinkan (waktu lokal company). Jangan kirim tengah malam.
  send_from_hour SMALLINT NOT NULL DEFAULT 8 CHECK (send_from_hour BETWEEN 0 AND 23),
  send_to_hour SMALLINT NOT NULL DEFAULT 21 CHECK (send_to_hour BETWEEN 0 AND 23),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (array_length(day_caps, 1) BETWEEN 1 AND 7)
);

-- Satu baris per percakapan yang sedang dalam rangkaian follow-up.
-- Barisnya dihapus begitu customer membalas: rangkaian selesai, dan kalau
-- nanti dia diam lagi rangkaian baru dimulai dari hari 1.
CREATE TABLE IF NOT EXISTS follow_up_state (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  -- Awal jendela diam: waktu pesan terakhir yang kita kirim ke customer
  -- setelah dia berhenti membalas. "Hari 1" dihitung 24 jam dari sini,
  -- bukan dari tanggal kalender, supaya lead yang masuk jam 23.00 tidak
  -- kehilangan hari pertamanya dalam satu jam.
  sequence_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  sent_total INTEGER NOT NULL DEFAULT 0,
  -- Jumlah terkirim per hari ke-n, index 0 = hari 1.
  sent_per_day INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  stopped_at TIMESTAMPTZ,
  stop_reason TEXT CHECK (stop_reason IN
    ('replied', 'human_takeover', 'exhausted', 'opted_out', 'manual', 'undeliverable')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);

-- Scheduler memindai baris yang belum berhenti dan sudah lewat jarak minimum.
CREATE INDEX IF NOT EXISTS follow_up_state_due_idx
  ON follow_up_state (stopped_at, last_sent_at)
  WHERE stopped_at IS NULL;

-- Catatan tiap follow-up yang benar-benar terkirim, untuk audit dan untuk
-- melihat mana yang menghasilkan balasan.
CREATE TABLE IF NOT EXISTS follow_up_sends (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  day_index SMALLINT NOT NULL,
  attempt_in_day SMALLINT NOT NULL,
  body TEXT NOT NULL,
  -- Diisi kalau customer membalas setelah follow-up ini.
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS follow_up_sends_company_idx
  ON follow_up_sends (company_id, created_at DESC);
