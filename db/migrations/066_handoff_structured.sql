-- Serah-terima terstruktur, kartu serah-terima, batasan untuk AI, dan
-- catatan yang dijadikan tugas.

-- ── Alasan serah-terima ───────────────────────────────────────────────────
-- Pilihan tetap, bukan teks bebas: bisa dihitung ("berapa serah-terima karena
-- keputusan harga bulan ini") dan tampil seragam di riwayat. Catatan teks
-- bebas (note) tetap ada dan tidak diganti. NULL = baris lama atau tidak
-- diisi.
ALTER TABLE conversation_handoffs
  ADD COLUMN IF NOT EXISTS reason TEXT,
  -- Kartu serah-terima buatan AI: {summary:[3 baris], promises:[], collected:{}, suggestedReply:''}.
  -- Hanya dibaca orang dalam; tidak pernah dikirim ke customer.
  ADD COLUMN IF NOT EXISTS card JSONB,
  -- Batasan dari manusia saat chat dikembalikan ke AI. Dibaca AI sebagai
  -- instruksi internal; dilarang disebut ke customer.
  ADD COLUMN IF NOT EXISTS ai_constraints TEXT;

ALTER TABLE conversation_handoffs DROP CONSTRAINT IF EXISTS conversation_handoffs_reason_check;
ALTER TABLE conversation_handoffs ADD CONSTRAINT conversation_handoffs_reason_check
  CHECK (reason IS NULL OR reason IN (
    'customer_requested_human', 'out_of_playbook', 'price_decision',
    'emotional_complaint', 'risk_compliance', 'low_confidence'
  ));

-- ── Catatan jadi tugas ────────────────────────────────────────────────────
-- Tugas di Agnee adalah baris conversation_routing yang dipegang manusia;
-- SLA-nya (migrasi 034) membaca baris itu. Jadi catatan-jadi-tugas memakai
-- baris yang sama dan hanya menambah tenggat serta asal catatannya.
ALTER TABLE conversation_routing
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_note_id BIGINT REFERENCES conversation_notes(id) ON DELETE SET NULL;
