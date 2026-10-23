-- Detail customer DealPOS (alamat, kota, telepon lain, gender, tgl lahir,
-- kelompok member) dan pembersihan nomor WhatsApp yang bukan nomor HP.
--
-- Daftar customer DealPOS (`/Customer`) tidak memuat alamat; itu hanya ada di
-- `/Customer/Detail`, satu panggilan per customer, jadi ditarik terpisah di
-- latar belakang. `detail_synced_at` NULL = belum ditarik.
ALTER TABLE dealpos_customers
  ADD COLUMN IF NOT EXISTS phone_extra TEXT,
  ADD COLUMN IF NOT EXISTS phone_alt TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS member_group TEXT,
  ADD COLUMN IF NOT EXISTS loyalty_points INTEGER,
  ADD COLUMN IF NOT EXISTS detail_synced_at TIMESTAMPTZ;

-- `phone` hanya berisi nomor HP Indonesia sungguhan (628 + 8-11 digit), sama
-- dengan aturan di dealpos-sync.js. Nomor lain (telepon rumah, nomor luar
-- negeri, sampah) dipindah ke `phone_extra`, supaya tidak ikut broadcast.
UPDATE dealpos_customers
SET phone_extra = phone, phone = NULL
WHERE phone IS NOT NULL AND phone !~ '^628[0-9]{8,11}$';

-- "Matikan & sembunyikan data": customer DealPOS tetap tersimpan, tapi tidak
-- tampil di Lead List dan tidak jadi audiens broadcast sampai dinyalakan lagi.
-- Data chat tidak tersentuh sama sekali.
ALTER TABLE dealpos_connections
  ADD COLUMN IF NOT EXISTS data_hidden BOOLEAN NOT NULL DEFAULT false;
