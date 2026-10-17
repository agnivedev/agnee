-- Impor Lead List dari berkas Excel/CSV.
--
-- Kontak dari berkas masuk ke imported_contacts (tabel yang sama dengan impor
-- chat WhatsApp), jadi otomatis tampil di Lead List dan menjadi calon penerima
-- Broadcast tanpa jalur kode kedua. Berstatus relation = 'unproven': orang di
-- dalam spreadsheet belum terlihat menghubungi kita, jadi broadcast ke mereka
-- tetap menuntut pengakuan risiko dari pemilik (aturan yang sudah ada).
--
-- email dan note hanya terisi untuk baris yang datang dari berkas.
ALTER TABLE imported_contacts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (source IN ('whatsapp', 'file')),
  ADD COLUMN IF NOT EXISTS file_import_id UUID,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Satu baris per kali impor berkas: siapa, kapan, berkas apa, hasilnya berapa.
-- Isi berkasnya sendiri tidak disimpan.
CREATE TABLE IF NOT EXISTS lead_file_imports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  format      TEXT NOT NULL CHECK (format IN ('xlsx', 'csv')),
  total_rows  INTEGER NOT NULL,
  imported    INTEGER NOT NULL,
  skipped     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_file_imports_company_idx
  ON lead_file_imports (company_id, created_at DESC);
