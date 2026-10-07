-- Cara AI memperkenalkan diri, per company.
-- team_member: bicara sebagai orang dari tim, tidak menyebut diri AI atau bot (perilaku lama).
-- chatbot: tidak mengaku manusia; kalau ditanya, mengaku chatbot dan menawarkan tim manusia.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_identity TEXT NOT NULL DEFAULT 'team_member'
  CHECK (ai_identity IN ('team_member', 'chatbot'));
