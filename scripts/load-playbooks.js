#!/usr/bin/env node
'use strict';

/**
 * Memuat folder playbook (produk.json + berkas Markdown) ke satu company.
 *   node scripts/load-playbooks.js playbooks/beweix-digital          simulasi
 *   node scripts/load-playbooks.js playbooks/beweix-digital --apply  menulis
 * Memakai pemecah bagian yang sama dengan impor di Train AI.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('../src/database.js');
const { splitSections, kindFromHeading, composeDocs, MAX_DOC_CHARS } = require('../src/playbook-import.js');

function parsePlaybookFile(file) {
  const { sections } = splitSections(fs.readFileSync(file, 'utf8'));
  const tagged = sections.map((section) => ({
    ...section,
    kind: section.heading ? kindFromHeading(section.heading) : null,
  }));
  const unknown = tagged.filter((section) => section.heading && !section.kind);
  if (unknown.length) {
    throw new Error(`${path.basename(file)}: judul tidak dikenali: ${unknown.map((s) => s.heading).join('; ')}`);
  }
  const docs = composeDocs(tagged);
  for (const [kind, text] of docs) {
    if (text.length > MAX_DOC_CHARS) throw new Error(`${path.basename(file)}: bagian ${kind} melebihi ${MAX_DOC_CHARS} karakter`);
  }
  return docs;
}

async function loadPlaybooks(db, folder, { apply = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'produk.json'), 'utf8'));
  const companyId = await db.resolveCompanyId(manifest.company);
  if (!companyId) throw new Error(`company "${manifest.company}" tidak ditemukan`);

  const report = [];
  const scopes = [{ label: '(umum)', file: manifest.umum, productId: null, general: true }];
  const existing = await db.listPlaybookProducts(companyId);

  for (const item of manifest.produk) {
    let product = existing.find((p) => p.name.trim().toLowerCase() === item.name.trim().toLowerCase());
    if (!product && apply) product = await db.createPlaybookProduct(item, null, companyId);
    if (product && apply && product.description !== item.description) {
      await db.updatePlaybookProduct(product.id, { description: item.description }, companyId);
    }
    report.push({ scope: item.name, kind: 'produk', status: product ? 'ada' : 'baru' });
    scopes.push({ label: item.name, file: item.file, productId: product?.id || null });
  }

  for (const scope of scopes) {
    const docs = parsePlaybookFile(path.join(folder, scope.file));
    for (const [kind, contentMd] of docs) {
      const current = scope.general || scope.productId ? await db.getPlaybookDoc(kind, companyId, scope.productId) : null;
      const status = !current ? 'baru' : current.contentMd === contentMd ? 'sama' : 'berubah';
      if (apply && status !== 'sama') await db.savePlaybookDoc({ kind, contentMd, productId: scope.productId }, null, companyId);
      report.push({ scope: scope.label, kind, status });
    }
  }
  return { companyId, report };
}

async function main() {
  const [folder, flag] = process.argv.slice(2);
  if (!folder) {
    console.error('Pemakaian: node scripts/load-playbooks.js <folder> [--apply]');
    process.exit(2);
  }
  const apply = flag === '--apply';
  const db = new Database({ logger: { info() {}, warn: console.warn } });
  await db.connect();
  try {
    const { report } = await loadPlaybooks(db, folder, { apply });
    console.table(report);
    const changed = report.filter((row) => row.status === 'baru' || row.status === 'berubah').length;
    console.log(apply ? `Selesai: ${changed} baris ditulis.` : `Simulasi: ${changed} baris akan ditulis. Tambahkan --apply untuk menulis.`);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { parsePlaybookFile, loadPlaybooks };
