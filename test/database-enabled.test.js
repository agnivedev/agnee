const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database');

/**
 * Kondisi produksi: Compose mengoper PGHOST/PGUSER/PGPASSWORD dan MEMBIARKAN
 * DATABASE_URL kosong, jadi server mengoper connectionString: ''. Pernah
 * ditafsirkan "matikan DB" dan produksi melayani 16 jam tanpa database —
 * setiap login pengguna asli ditolak "Email atau password salah". Yang boleh
 * mematikan DB hanya `null`.
 */
function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('connectionString kosong + PGHOST ambient = DB menyala (jalur produksi Compose)', () => {
  withEnv({ DATABASE_URL: undefined, PGHOST: 'postgres' }, () => {
    const db = new Database({ connectionString: '' });
    assert.equal(db.enabled, true);
  });
});

test('connectionString null = DB mati, meski DATABASE_URL dan PGHOST terisi', () => {
  withEnv({ DATABASE_URL: 'postgres://ci/agnee', PGHOST: 'postgres' }, () => {
    const db = new Database({ connectionString: null });
    assert.equal(db.enabled, false);
    assert.equal(db.connectionString, '');
  });
});

test('tanpa argumen = pakai DATABASE_URL ambient', () => {
  withEnv({ DATABASE_URL: 'postgres://ambient/agnee', PGHOST: undefined }, () => {
    const db = new Database();
    assert.equal(db.enabled, true);
    assert.equal(db.connectionString, 'postgres://ambient/agnee');
  });
});

test('tanpa DATABASE_URL maupun PGHOST = DB mati', () => {
  withEnv({ DATABASE_URL: undefined, PGHOST: undefined }, () => {
    const db = new Database({ connectionString: '' });
    assert.equal(db.enabled, false);
  });
});
