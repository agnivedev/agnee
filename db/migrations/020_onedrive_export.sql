-- Sinkronisasi kontak ke workbook Excel di OneDrive/SharePoint lewat Microsoft
-- Graph.
--
-- Kredensial disimpan PER COMPANY, sama seperti whatsapp_cloud_connections:
-- tiap tenant Agnee memakai tenant Microsoft dan workbook yang berbeda, jadi
-- ini tidak pernah boleh jadi konfigurasi global di .env.
CREATE TABLE IF NOT EXISTS onedrive_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Alur client credentials (app-only). Dipilih daripada OAuth delegasi karena
  -- sinkronisasi berjalan di server tanpa ada orang yang login: token delegasi
  -- akan kedaluwarsa dan memerlukan seseorang untuk masuk kembali.
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_enc BYTEA NOT NULL,

  -- Workbook tujuan. Disimpan sebagai id, bukan tautan: tautan berbagi bisa
  -- dicabut atau berubah, sedangkan id tetap selama filenya ada.
  drive_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  worksheet_name TEXT NOT NULL DEFAULT 'Kontak',
  file_name TEXT,
  web_url TEXT,

  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Berapa baris data yang terakhir ditulis. Dipakai untuk mengosongkan sisa
  -- baris ketika jumlah kontak berkurang; tanpa ini, baris lama tertinggal di
  -- bawah data baru dan terlihat seperti kontak yang masih ada.
  last_row_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id)
);
