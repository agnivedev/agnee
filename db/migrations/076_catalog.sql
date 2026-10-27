-- Katalog produk & jasa per company, plus ribbon (Unggulan, Best Seller,
-- Promo, Baru, dan label buatan sendiri).
--
-- Berdiri sendiri: item diisi tangan (source 'manual'). Tersambung ke POS:
-- item ditarik dari DealPOS (source 'dealpos', external_id = ID varian).
-- Field milik POS (nama, kode, kategori, harga, diskon, gambar, tanggal
-- rilis) ditimpa setiap sinkron; yang ditambahkan tim di Agnee (deskripsi
-- untuk AI, ribbon manual, tampil/sembunyi) tidak pernah ditimpa.
--
-- Beda dengan playbook_products ("Topik" di UI): topik memilih playbook mana
-- yang dibaca AI per percakapan. Katalog adalah daftar barang/jasa yang dijual.

CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'dealpos')),
  -- ID di sistem asal; NULL untuk item manual.
  external_id TEXT,
  kind TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'service')),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT,
  category TEXT,
  unit TEXT,
  -- NULL = harga tidak disebut (jasa yang harganya tergantung kebutuhan).
  price NUMERIC(14, 2),
  -- Mis. "mulai dari", "per bulan". Ikut dibaca AI di samping harga.
  price_note TEXT,
  -- Persen diskon dari POS (DealPOS Variant.Discount); 0 = tanpa diskon.
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  -- false = disembunyikan dari AI dan dari daftar bawaan.
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Item POS yang tidak muncul lagi di tarikan terakhir (dihapus/discontinued
  -- di POS). Tidak dihapus supaya ribbon dan deskripsi buatan tim tidak hilang
  -- kalau barangnya diaktifkan lagi di POS.
  missing_from_source BOOLEAN NOT NULL DEFAULT FALSE,
  released_at TIMESTAMPTZ,
  -- Jumlah terjual dalam jendela best seller (dari laporan POS).
  sold_qty NUMERIC(14, 2),
  synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_source_ext_idx
  ON catalog_items (company_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_items_company_name_idx
  ON catalog_items (company_id, lower(name));

CREATE TABLE IF NOT EXISTS catalog_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Nama warna dari palet tetap di web (CSP melarang warna bebas lewat style).
  color TEXT NOT NULL DEFAULT 'slate',
  -- Diisi otomatis dari POS: 'best_seller' (terlaris di laporan penjualan),
  -- 'promo' (diskon > 0), 'new' (rilis dalam N hari). NULL = hanya manual.
  auto_rule TEXT CHECK (auto_rule IN ('best_seller', 'promo', 'new')),
  -- true = AI boleh menawarkan item ber-ribbon ini tanpa ditanya, dan
  -- daftarnya selalu ikut di prompt.
  highlight BOOLEAN NOT NULL DEFAULT FALSE,
  -- Kapan/bagaimana AI menyebut ribbon ini, mis. "sebut stok terbatas".
  ai_note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_tags_company_name_idx
  ON catalog_tags (company_id, lower(btrim(name)));
-- Satu ribbon per aturan otomatis.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_tags_company_rule_idx
  ON catalog_tags (company_id, auto_rule) WHERE auto_rule IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_item_tags (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  -- 'manual' dipasang tim, 'auto' dipasang sinkron POS. Sinkron hanya
  -- mengganti baris 'auto'; pasangan manual bertahan.
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
  PRIMARY KEY (item_id, tag_id, source),
  -- Foreign key komposit: database menolak item company A diberi tag company B.
  FOREIGN KEY (company_id, item_id) REFERENCES catalog_items (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, tag_id) REFERENCES catalog_tags (company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS catalog_item_tags_tag_idx ON catalog_item_tags (tag_id);

CREATE TABLE IF NOT EXISTS catalog_settings (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  -- AI membaca katalog saat membalas customer.
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  best_seller_count INT NOT NULL DEFAULT 10 CHECK (best_seller_count BETWEEN 1 AND 100),
  best_seller_days INT NOT NULL DEFAULT 30 CHECK (best_seller_days BETWEEN 7 AND 365),
  new_days INT NOT NULL DEFAULT 30 CHECK (new_days BETWEEN 1 AND 365),
  pos_synced_at TIMESTAMPTZ,
  pos_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
