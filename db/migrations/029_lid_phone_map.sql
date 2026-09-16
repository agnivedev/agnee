-- Cache untuk nomor telepon asli di balik id @lid WhatsApp.
--
-- Chat @lid (fitur privasi nomor WhatsApp Business) mengirim id internal
-- buram, bukan nomor telepon — Lead List sebelumnya menampilkan id itu apa
-- adanya (misal "248627670863983"), yang bukan nomor HP sama sekali.
-- Resolusinya butuh koneksi WhatsApp yang hidup (API internal
-- WAWebApiContact.getPhoneNumber lewat pupPage.evaluate), jadi hasilnya
-- di-cache di sini alih-alih di-query ulang tiap kali tabel dibuka.
CREATE TABLE IF NOT EXISTS lid_phone_map (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lid TEXT NOT NULL,
  phone TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, lid)
);
