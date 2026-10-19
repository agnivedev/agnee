-- Biaya AI nyata per tujuan (30 hari), dalam USD dan perkiraan Rp pada kurs 16.500.
-- Dipakai untuk memeriksa angka usulan di docs/credit-system.md terhadap produksi.
SELECT purpose, model, COUNT(*) AS calls,
       ROUND(AVG(cost_usd)::numeric, 6) AS avg_usd,
       ROUND((AVG(cost_usd) * 16500)::numeric, 1) AS avg_idr,
       ROUND(AVG(input_tokens)) AS avg_in, ROUND(AVG(output_tokens)) AS avg_out
FROM ai_usage_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY purpose, model ORDER BY calls DESC;
