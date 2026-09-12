-- Sebuah company bisa punya link checkout DAN rekening bank sekaligus — pola
-- yang lumrah di Indonesia. Sebelumnya payment_method eksklusif ('link' ATAU
-- 'bank_transfer'), jadi supervisor harus memilih salah satu dan yang satunya
-- tidak pernah sampai ke konteks AI.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_payment_method_check;
ALTER TABLE companies ADD CONSTRAINT companies_payment_method_check
  CHECK (payment_method IN ('none', 'link', 'bank_transfer', 'both'));
