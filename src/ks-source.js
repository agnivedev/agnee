'use strict';

/**
 * Sumber paket KS. Sekarang hanya folder bawaan `knowledge/ks/`; sumber Expertz
 * menyusul dengan bentuk yang sama (`list()` dan `get(code)`), jadi rute dan
 * pemasangnya tidak perlu tahu dari mana paketnya datang.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadPackage } = require('./ks-package');

const BUILTIN_DIR = path.join(__dirname, '..', 'knowledge', 'ks');

function builtinSource(dir = BUILTIN_DIR) {
  function folders() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'ks.json')))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  }
  return {
    id: 'builtin',
    list() {
      const packages = [];
      for (const folder of folders()) {
        try {
          const { manifest } = loadPackage(folder);
          packages.push({
            code: manifest.code, name: manifest.name, version: manifest.version,
            kind: manifest.kind, summary: manifest.summary || '', language: manifest.language || 'id',
          });
        } catch {
          // Paket rusak tidak masuk katalog; pemuatnya sudah menolaknya dengan alasan.
        }
      }
      return packages;
    },
    get(code) {
      for (const folder of folders()) {
        try {
          const pkg = loadPackage(folder);
          if (pkg.manifest.code === code) return pkg;
        } catch {
          // lihat list()
        }
      }
      return null;
    },
  };
}

module.exports = { builtinSource };
