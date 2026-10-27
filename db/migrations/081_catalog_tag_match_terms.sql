-- Ribbon yang mengikuti kata kunci: item aktif yang nama atau mereknya memuat salah
-- satu kata (mis. "jotun", "triplek") otomatis mendapat ribbon, dipasang ulang tiap
-- sinkron dan tiap tombol Kategorikan otomatis. Berlaku untuk item manual maupun POS.
ALTER TABLE catalog_tags ADD COLUMN IF NOT EXISTS match_terms TEXT[] NOT NULL DEFAULT '{}';
