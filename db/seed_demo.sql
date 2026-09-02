-- Demo seed: Bewei Digital (company) + Hannysog Personal
-- Generated: 2026-09-01

-- === COMPANY: Bewei Digital ===
INSERT INTO companies (
  slug, name, plan, plan_status,
  knowledge_client, ai_message_limit, ai_message_count,
  max_users, max_playbooks, max_whatsapp
) VALUES (
  'bewei-digital', 'Bewei Digital', 'company', 'beta',
  'agnee', 0, 0,
  5, 0, 0
) RETURNING id;

-- === PERSONAL: Hannysog ===
INSERT INTO companies (
  slug, name, plan, plan_status,
  knowledge_client, ai_message_limit, ai_message_count,
  max_users, max_playbooks, max_whatsapp
) VALUES (
  'hannysog-personal', 'Hannysog Personal', 'personal', 'beta',
  'agnee', 500, 0,
  1, 1, 1
) RETURNING id;

-- === USERS ===
-- hanny@beweidigital.com (owner Bewei Digital)
INSERT INTO users (email, display_name, password_hash)
VALUES (
  'hanny@beweidigital.com',
  'Hanny',
  'scrypt$64328ae959490e2d31acfbbc1f4433dc$27b9072cf4ae89bdb768d55b26f2007965a7c76289a230e161f3af6fe8bf3ad7f200fbf2c3aeebc0d94a5a1e5f9b9806469b9ad790533bd3bd975e43be15949c'
) RETURNING id;

-- ferawaty@beweidigital.com (agent Bewei Digital)
INSERT INTO users (email, display_name, password_hash)
VALUES (
  'ferawaty@beweidigital.com',
  'Ferawaty',
  'scrypt$75f8f136770a9295419a5f90782a3a90$c73b2d889a11bb1211338aae6ad06a5bd8478be82fa51348edc3eb3752f0d8d5af0df227d708c704a910025bf201af3f4a83e3240012f1ee4f7fa063de5c0c09'
) RETURNING id;

-- hannysog@gmail.com (owner Personal)
INSERT INTO users (email, display_name, password_hash)
VALUES (
  'hannysog@gmail.com',
  'Hannysog',
  'scrypt$5ce4f64e45f91532b9b0f3ec1564338c$8aab6f94f252a4d09e46cfcc1f4982d4878eee2918375b0b951c60a99c3e8f76f30729de00af1a7547a247c5dab7b9588755d719944f5937005670f915a090e8'
) RETURNING id;

-- === COMPANY MEMBERS ===
-- Bewei Digital members
INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM companies c, users u
WHERE c.slug = 'bewei-digital' AND u.email = 'hanny@beweidigital.com';

INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'agent'
FROM companies c, users u
WHERE c.slug = 'bewei-digital' AND u.email = 'ferawaty@beweidigital.com';

-- Personal member
INSERT INTO company_members (company_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM companies c, users u
WHERE c.slug = 'hannysog-personal' AND u.email = 'hannysog@gmail.com';

-- Verify
SELECT c.name, u.email, cm.role
FROM companies c
JOIN company_members cm ON c.id = cm.company_id
JOIN users u ON u.id = cm.user_id
ORDER BY c.name, cm.role;
