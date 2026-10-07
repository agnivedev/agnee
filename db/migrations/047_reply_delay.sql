-- Jeda sebelum balasan otomatis, per company.
--
-- Balasan yang keluar dalam hitungan detik, selalu dengan kecepatan yang sama,
-- terbaca sebagai mesin oleh customer dan pola yang seragam itu juga yang
-- paling mudah dikenali WhatsApp. Jeda acak yang condong cepat meniru orang
-- yang memang sedang memegang ponsel: sering langsung menjawab, sesekali
-- baru sempat membalas.
--
-- Default HIDUP dengan 5-60 detik, karena begitulah permintaannya: setiap
-- balasan otomatis harus berjeda. Company yang tidak mau jeda mematikannya
-- dari Settings.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS reply_delay_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reply_delay_min_seconds SMALLINT NOT NULL DEFAULT 5
    CHECK (reply_delay_min_seconds BETWEEN 0 AND 120),
  ADD COLUMN IF NOT EXISTS reply_delay_max_seconds SMALLINT NOT NULL DEFAULT 60
    CHECK (reply_delay_max_seconds BETWEEN 1 AND 300);

-- Batas bawah tidak boleh melewati batas atas. Dijaga di database juga, bukan
-- hanya di API, supaya SQL manual tidak bisa menyisakan rentang terbalik.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_reply_delay_order') THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_reply_delay_order
      CHECK (reply_delay_min_seconds <= reply_delay_max_seconds);
  END IF;
END
$$;
