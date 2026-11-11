-- NervAgent proaktif: apa yang sudah dikirim ke chat manajer (dedupe tahan restart,
-- batas per jam, briefing sekali sehari) dan jejak audit tindakan tulis NERVA.
-- Tidak menyimpan token atau isi pesan.
CREATE TABLE IF NOT EXISTS nerva_proactive_sent (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('alert', 'briefing')),
  dedupe_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat, kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_nerva_proactive_sent_recent ON nerva_proactive_sent (company_id, chat, kind, sent_at DESC);

CREATE TABLE IF NOT EXISTS nerva_audit (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  outcome TEXT NOT NULL,
  detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nerva_audit_company_at ON nerva_audit (company_id, at DESC);
