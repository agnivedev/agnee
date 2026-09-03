-- Every company needs its OWN WhatsApp client identity.
--
-- Companies created before self-serve signup (which inserts this row) have no
-- whatsapp_connections row at all. getConnConfig() then silently falls back to
-- the shared global WA_CLIENT_ID ('agnee-main'), so two tenants end up pointing
-- at the same Chromium profile directory (<session_path>/session-agnee-main).
-- The second client deletes the first one's SingletonLock, both fight over the
-- profile, and neither ever emits a 'qr' event — the UI hangs on
-- "Waiting for a code from WhatsApp…" forever.
--
-- Backfill a per-company identity for anyone missing one. Companies that
-- already have a row (including 'default' on the live agnee-main session) are
-- left untouched, so no working session is disturbed.
INSERT INTO whatsapp_connections (company_id, connection_key, client_id, session_path)
SELECT
  c.id,
  'whatsapp-main',
  'agnee-' || c.id,
  COALESCE(
    (SELECT w.session_path FROM whatsapp_connections w ORDER BY w.created_at ASC LIMIT 1),
    './data/whatsapp'
  )
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_connections w
  WHERE w.company_id = c.id AND w.connection_key = 'whatsapp-main'
);
