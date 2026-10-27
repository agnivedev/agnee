-- Order kurir Lalamove yang dibuat agen dari percakapan. Satu baris per order;
-- status disegarkan dari Lalamove saat daftar dibuka (tanpa webhook).
CREATE TABLE IF NOT EXISTS lalamove_orders (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  lalamove_order_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  service_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ASSIGNING_DRIVER',
  share_link TEXT,
  total NUMERIC(14, 2),
  currency TEXT NOT NULL DEFAULT 'IDR',
  pickup_name TEXT,
  pickup_address TEXT,
  dropoff_address TEXT,
  recipient_name TEXT NOT NULL,
  -- Nomor penerima dikirim ke Lalamove supaya kurir bisa menghubunginya.
  recipient_phone TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, lalamove_order_id)
);
CREATE INDEX IF NOT EXISTS lalamove_orders_chat_idx ON lalamove_orders (company_id, chat_id, created_at DESC);
