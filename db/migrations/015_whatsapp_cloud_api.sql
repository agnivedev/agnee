-- Official WhatsApp Business Cloud API as a second, independent messaging
-- channel alongside the existing whatsapp-web.js (QR pairing) connection.
-- Each company holds its own credentials — this is never a shared/global
-- configuration, since different companies use entirely different WABAs.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT NOT NULL DEFAULT 'whatsapp_web'
  CHECK (whatsapp_provider IN ('whatsapp_web', 'cloud_api'));

CREATE TABLE IF NOT EXISTS whatsapp_cloud_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  display_phone_number TEXT,
  -- Encrypted at rest with pgcrypto (pgp_sym_encrypt/pgp_sym_decrypt); the
  -- symmetric key is a process-level secret (CREDENTIALS_ENCRYPTION_KEY env
  -- var), never stored in this database.
  access_token_enc BYTEA NOT NULL,
  app_secret_enc BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error')),
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id),
  UNIQUE (phone_number_id)
);

-- Cloud API is a stateless webhook receiver with no "list my chats" endpoint,
-- unlike whatsapp-web.js which reads live from its own in-memory/Puppeteer
-- store. This table is the persisted message log the cloud_api path serves
-- /v1/chats and /v1/chats/:chatId/messages from; the whatsapp-web.js path
-- does not use it.
CREATE TABLE IF NOT EXISTS cloud_messages (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  wa_message_id TEXT,
  from_me BOOLEAN NOT NULL,
  body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cloud_messages_chat_idx ON cloud_messages (company_id, chat_id, timestamp);
