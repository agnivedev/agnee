-- Seed: Trader's Mastermind + Beweix Digital companies & users
-- Generated: 2026-09-02

-- ============================================================
-- COMPANY: Trader's Mastermind
-- ============================================================
INSERT INTO companies (
  slug, name, plan, plan_status,
  knowledge_client, ai_message_limit, ai_message_count,
  max_users, max_playbooks, max_whatsapp
)
SELECT
  'tradersmastermind', 'Trader''s Mastermind', 'company', 'beta',
  'tradersmastermind', 2000, 0,
  5, 5, 2
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE lower(slug) = 'tradersmastermind');

-- ============================================================
-- COMPANY: Beweix Digital
-- ============================================================
INSERT INTO companies (
  slug, name, plan, plan_status,
  knowledge_client, ai_message_limit, ai_message_count,
  max_users, max_playbooks, max_whatsapp
)
SELECT
  'beweix-digital', 'Beweix Digital', 'company', 'beta',
  'agnee', 0, 0,
  5, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE lower(slug) = 'beweix-digital');

-- ============================================================
-- USERS — Trader's Mastermind
-- Temp password ferafx20@gmail.com : ferafx202026
-- Temp password hannyfx20@gmail.com: hannyfx202026
-- ============================================================
INSERT INTO users (email, display_name, password_hash)
SELECT
  'ferafx20@gmail.com', 'Ferawaty',
  'scrypt$968052eeaca848c242cb62586d1bbac0$b8c8080de0b188b92581d5725fe271d63f0d23d2de3416066c58371e76cba21a62fc71fe77e40c201ff4b67ac338662beeddafbec68d60636baf865e43f9d709'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'ferafx20@gmail.com');

INSERT INTO users (email, display_name, password_hash)
SELECT
  'hannyfx20@gmail.com', 'Hanny',
  'scrypt$4a1e995963afc2c3a7e94ac3f480b300$697102c16616c888938ca4a5787c7bda3c1fb1eb4d938f0555899cae8d992d45c6a2dfa0f599255ea72de019fced58c3be68f75dbe2d81e147a0d130a8fd2a01'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'hannyfx20@gmail.com');

-- ============================================================
-- USERS — Beweix Digital
-- Temp password: beweix2026
-- ============================================================
INSERT INTO users (email, display_name, password_hash)
SELECT
  'hanny@beweidigital.com', 'Hanny',
  'scrypt$ae5b5878ba11cb8f762442f4e285080c$059864edaf945259506e8095ed66481c4119ce0ef086b9eb22b860392b4c27d8d49ca47dccf9a7a78555331536dc2e445e032b55c2547f48a048431de48c4696'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'hanny@beweidigital.com');

INSERT INTO users (email, display_name, password_hash)
SELECT
  'ferawaty@beweidigital.com', 'Ferawaty',
  'scrypt$7681ba5e779f117dede4da74be44a354$19a9fd5834883cbc3eac3eb8c57a8598f694a1ad98a012fdcc43c5748bdd8c462ded7cffd023cd55f11530ef9707ce8358370d750dcaac75e7b00ca9ead03e1c'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'ferawaty@beweidigital.com');

-- ============================================================
-- COMPANY MEMBERS — Trader's Mastermind
-- ============================================================
INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM companies c, users u
WHERE c.slug = 'tradersmastermind' AND u.email = 'hannyfx20@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM company_members cm2
    WHERE cm2.company_id = c.id AND cm2.user_id = u.id
  );

INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'agent'
FROM companies c, users u
WHERE c.slug = 'tradersmastermind' AND u.email = 'ferafx20@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM company_members cm2
    WHERE cm2.company_id = c.id AND cm2.user_id = u.id
  );

-- ============================================================
-- COMPANY MEMBERS — Beweix Digital
-- ============================================================
INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM companies c, users u
WHERE c.slug = 'beweix-digital' AND u.email = 'hanny@beweidigital.com'
  AND NOT EXISTS (
    SELECT 1 FROM company_members cm2
    WHERE cm2.company_id = c.id AND cm2.user_id = u.id
  );

INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'agent'
FROM companies c, users u
WHERE c.slug = 'beweix-digital' AND u.email = 'ferawaty@beweidigital.com'
  AND NOT EXISTS (
    SELECT 1 FROM company_members cm2
    WHERE cm2.company_id = c.id AND cm2.user_id = u.id
  );

-- Verify
SELECT c.name, u.email, cm.role
FROM companies c
JOIN company_members cm ON c.id = cm.company_id
JOIN users u ON u.id = cm.user_id
WHERE c.slug IN ('tradersmastermind', 'beweix-digital')
ORDER BY c.name, cm.role;
