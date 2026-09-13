-- Sinkronisasi kontak ke Google Sheets, sejajar dengan onedrive_connections.
--
-- Sebuah company boleh memakai salah satu atau keduanya: keduanya menulis
-- baris yang sama, dan sebagian tim memang memakai dua ekosistem sekaligus.
CREATE TABLE IF NOT EXISTS gsheets_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Service account, bukan OAuth pengguna: sinkronisasi berjalan di server
  -- tanpa ada orang yang login. Berbeda dari Microsoft, Google tidak menuntut
  -- persetujuan admin — pemilik sheet cukup membagikan sheet-nya ke alamat
  -- email service account ini sebagai Editor.
  client_email TEXT NOT NULL,
  private_key_enc BYTEA NOT NULL,

  spreadsheet_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL DEFAULT 'Kontak',
  spreadsheet_title TEXT,

  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Berapa baris data terakhir ditulis, supaya sisa baris lama bisa dihapus
  -- ketika jumlah kontak berkurang.
  last_row_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id)
);
