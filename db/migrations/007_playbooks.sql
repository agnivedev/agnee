-- Per-company AI playbook: a typed brief plus uploaded reference documents/media.
-- Replaces the developer-managed knowledge/clients/* folders as the source of truth
-- for any company that has its own brief or uploads — those static packs remain as
-- the base instruction set (reply policy, funnel) that a playbook brief extends.

CREATE TABLE IF NOT EXISTS playbooks (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  brief TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playbook_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'image', 'video', 'audio', 'other')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'ready' CHECK (extraction_status IN ('ready', 'unsupported', 'failed')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playbook_assets_company_idx
  ON playbook_assets (company_id, created_at DESC);
