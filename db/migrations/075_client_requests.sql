-- Permintaan pemilik bisnis yang belum bisa dipenuhi asisten Latih AI (fitur,
-- integrasi, atau otomasi yang belum ada di Agnee). Dicatat apa adanya supaya
-- tim Agnee melihat apa yang paling sering diminta, bukan supaya asisten
-- berpura-pura bisa. Dibaca lintas company hanya lewat konsol /superhuman.
CREATE TABLE IF NOT EXISTS client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Kalimat pemilik, diringkas asisten.
  request TEXT NOT NULL,
  -- Kenapa belum bisa: alasan dari asisten, untuk triase tim.
  reason TEXT,
  -- Bagian aplikasi yang paling dekat (inbox, broadcast, integrasi, ...).
  area TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'declined')),
  -- Catatan tim Agnee; tidak pernah dikirim ke company.
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_requests_status_idx ON client_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS client_requests_company_idx ON client_requests (company_id, created_at DESC);
