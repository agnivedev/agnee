-- Tindak lanjut per tahap funnel closing (src/follow-up-stage.js).
--
-- Tahapnya dihitung dari data yang sudah ada (rincian terkirim, proforma dan
-- invoice di ai_sales_documents, payment_proofs, department_questions, pesan
-- masuk), jadi tidak ada tabel tahap. Yang ditambah hanya:

-- Saklar per tahap: {"inquiry": false, ...}. Kunci yang tidak ada = menyala.
ALTER TABLE follow_up_settings
  ADD COLUMN IF NOT EXISTS stage_toggles JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Bawaan baru untuk company yang belum pernah menyimpan setelan: paling
-- banyak satu per hari selama tiga hari. 5/3/2 berarti sampai sepuluh pesan
-- tak berbalas ke satu orang, pola yang dibaca WhatsApp sebagai spam. Baris
-- yang sudah ada tidak diubah: angka itu pilihan supervisor company tersebut.
ALTER TABLE follow_up_settings ALTER COLUMN day_caps SET DEFAULT ARRAY[1, 1, 1];

-- Chat yang belum waktunya (jadwal tahap) atau sedang ditahan tidak perlu
-- diperiksa ulang tiap tick. Dikosongkan setiap kali rangkaian dipasang ulang.
ALTER TABLE follow_up_state ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

-- Tahap saat pesan dikirim, untuk melihat tahap mana yang menghasilkan balasan.
ALTER TABLE follow_up_sends ADD COLUMN IF NOT EXISTS stage TEXT;

-- Alasan berhenti baru: customer sudah membayar/mengirim bukti, atau menolak.
ALTER TABLE follow_up_state
  DROP CONSTRAINT IF EXISTS follow_up_state_stop_reason_check;
ALTER TABLE follow_up_state
  ADD CONSTRAINT follow_up_state_stop_reason_check
  CHECK (stop_reason = ANY (ARRAY[
    'replied', 'human_takeover', 'exhausted', 'opted_out',
    'manual', 'undeliverable', 'feature_reenabled', 'restarted',
    'payment_sent', 'declined'
  ]));
