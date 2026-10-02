-- Agnee's chatbot may look up Agnive Hub listings (public research ready to
-- fund) while it answers (9d). Off for every company by default — a customer's
-- bot must not start talking about another business's marketplace — and on
-- for Agnive itself. Platform staff switch it in the console.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS hub_tools_enabled BOOLEAN NOT NULL DEFAULT false;
UPDATE companies SET hub_tools_enabled = true WHERE slug = 'agnive';
