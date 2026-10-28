-- Jam buka terstruktur per lokasi: tiap hari buka (satu atau dua rentang),
-- buka 24 jam, atau tutup. `opening_hours` (teks) tetap dipakai semua
-- pembaca lama; server mengisinya dari jadwal ini ditambah catatan bebas.
-- Lokasi lama tanpa jadwal tetap memakai teks di `opening_hours` apa adanya.
ALTER TABLE company_locations
  ADD COLUMN IF NOT EXISTS opening_schedule JSONB,
  ADD COLUMN IF NOT EXISTS opening_note TEXT;
