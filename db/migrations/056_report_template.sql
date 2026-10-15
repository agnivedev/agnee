-- Template pesan laporan supervisor, per company. NULL = template bawaan
-- (src/supervisor-report.js DEFAULT_TEMPLATE). Isinya teks dengan penanda
-- seperti {name} dan {company}; hanya penanda yang dikenal yang diterima.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS report_template TEXT;
