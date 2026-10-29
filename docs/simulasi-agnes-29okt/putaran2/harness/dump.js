'use strict';
// Baca-saja: salin data ESBEJE yang dibaca AI ke JSON (dijalankan di container app produksi).
const Database = require('/app/src/database.js');
const C = 'fdf4441c-6a15-42d9-84ed-65c85debb660';
(async () => {
  const db = new Database({ logger: { info() {}, warn() {}, error() {} } });
  db.connected = true;
  const strip = (o) => { if (!o) return o; const c = { ...o }; for (const k of Object.keys(c)) if (/secret|key|token|password/i.test(k)) c[k] = c[k] ? '[x]' : c[k]; return c; };
  const out = {
    companyConfig: await db.getCompanyConfig(C),
    aiSettings: await db.getAiSettings(C),
    playbookProducts: await db.listPlaybookProducts(C, { onlyActive: true }).catch((e) => String(e)),
    playbook: await db.getPlaybookContext(C),
    catalog: await db.listCatalogForAi(C),
    dealpos: await db.listDealposProducts(C),
    dealposConn: strip(await db.getDealposConnection(C)),
    lalamove: strip(await db.getLalamoveConnection(C)),
    locations: await db.listCompanyLocations(C),
    accounts: await db.listPaymentAccounts(C),
    promos: await db.listPromoRules(C),
    departments: (await db.listDepartments(C)).map((d) => ({ ...d, members: d.members.map((m) => ({ ...m, whatsappNumber: m.whatsappNumber ? 'ada' : null })) })),
    thirdParties: await db.listThirdParties(C, { onlyActive: true }),
    handoffNumbers: (await db.getHandoffNotifyNumbers(C)).length,
  };
  process.stdout.write(JSON.stringify(out));
  await db.pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
