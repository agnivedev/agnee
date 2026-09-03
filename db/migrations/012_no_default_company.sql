-- No tenant is "default".
--
-- The bootstrap company that connect() used to auto-create (slug 'default',
-- name 'Default Company') was the implicit fallback every unscoped request
-- landed in. That fallback is gone from the code; this turns the leftover row
-- into an explicit tenant instead of leaving a company literally named
-- "default" in the table: Agnive, the company behind agnive.co.
--
-- Its WhatsApp identity also moves off the shared env clientId ('agnee-main')
-- onto the same per-company scheme every other tenant uses. Only done when the
-- connection is not live, so no paired session is ever disturbed.
UPDATE companies
SET slug = 'agnive', name = 'Agnive', updated_at = NOW()
WHERE LOWER(slug) = 'default'
  AND NOT EXISTS (SELECT 1 FROM companies c2 WHERE LOWER(c2.slug) = 'agnive');

UPDATE whatsapp_connections w
SET client_id = 'agnee-' || w.company_id, updated_at = NOW()
FROM companies c
WHERE c.id = w.company_id
  AND LOWER(c.slug) = 'agnive'
  AND w.client_id = 'agnee-main'
  AND w.status <> 'ready';
