'use strict';

/**
 * Rate limit login dikunci per IP lewat `request.ip`.
 *
 * Di produksi app berjalan di belakang Nginx, jadi tanpa `TRUST_PROXY`
 * `request.ip` adalah IP proxy untuk SETIAP permintaan — satu ember untuk
 * seluruh platform. Akibatnya 10 login gagal dari siapa pun (termasuk pemindai
 * otomatis yang tiap hari mengetuk server) mengunci login SEMUA tenant selama
 * 15 menit. Tidak ada tes yang mewakili jalur proxy sama sekali sebelum ini.
 *
 * Bentuk nilainya penting dan tidak bisa ditebak dari dokumentasi:
 * diukur pada Fastify 5.12.1, `trustProxy: 1` tetap menghasilkan IP proxy
 * (jadi tidak memperbaiki apa pun), dan `trustProxy: true` mempercayai seluruh
 * rantai sehingga header palsu dari penyerang yang menang — rate limit-nya
 * hilang sama sekali. Yang benar adalah allowlist alamat proxy: entri paling
 * kanan (yang ditambahkan Nginx sendiri) yang dipakai, dan apa pun yang
 * dikirim klien di sebelah kirinya diabaikan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

// Gateway bridge Docker: satu-satunya jalan masuk ke app, karena port 4100
// hanya dipetakan ke 127.0.0.1 di host. Sengaja TIDAK dioper sebagai setelan
// di bawah — tes ini harus menguji default yang dipakai produksi, bukan nilai
// yang disuapkan tesnya sendiri. Kalau defaultnya diubah jadi tidak mempercayai
// proxy lagi, ketiga tes ini yang jatuh.
const GATEWAY = '172.24.0.1';
const PENYERANG = '203.0.113.10';
const PELANGGAN = '198.51.100.7';

async function appDenganProxy(t) {
  const app = await buildApp({
    logger: false,
    startupEnabled: false,
    demoMode: true,
    // DB mati supaya login memakai fallback admin — tes ini soal rate limit,
    // bukan soal autentikasi.
    databaseUrl: null,
    adminEmail: 'owner@example.com',
    adminPassword: 'strong-pass',
    sessionSecret: 'rate-limit-secret',
  });
  t.after(() => app.close());
  return app;
}

function login(app, { ip, password, forwardedFor }) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress: GATEWAY,
    headers: { 'x-forwarded-for': forwardedFor || ip },
    payload: { email: 'owner@example.com', password },
  });
}

const loginGagal = (app, ip) => login(app, { ip, password: 'password-salah' });

test('login gagal berulang dari satu IP tidak mengunci IP lain', async (t) => {
  const app = await appDenganProxy(t);

  // LOGIN_MAX_ATTEMPTS = 10 dalam 15 menit.
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await loginGagal(app, PENYERANG)).statusCode, 401);
  }

  // IP itu sendiri sekarang terkunci — ember per IP memang harus menggigit.
  assert.equal((await loginGagal(app, PENYERANG)).statusCode, 429);

  // Dan ini intinya: pelanggan dari IP lain tetap bisa mencoba. Waktu
  // `request.ip` masih IP proxy, baris ini balas 429 dan seluruh platform
  // tidak bisa login.
  assert.equal((await loginGagal(app, PELANGGAN)).statusCode, 401);
});

test('login yang benar dari IP bersih tetap berhasil setelah IP lain terkunci', async (t) => {
  const app = await appDenganProxy(t);

  for (let i = 0; i < 11; i += 1) await loginGagal(app, PENYERANG);

  const masuk = await login(app, { ip: PELANGGAN, password: 'strong-pass' });
  assert.equal(masuk.statusCode, 200);
});

test('header X-Forwarded-For palsu tidak memberi ember baru', async (t) => {
  const app = await appDenganProxy(t);

  for (let i = 0; i < 11; i += 1) await loginGagal(app, PENYERANG);
  assert.equal((await loginGagal(app, PENYERANG)).statusCode, 429);

  // Penyerang mengirim header sendiri; Nginx meneruskannya lalu menempelkan IP
  // asli di paling kanan. Yang dipakai harus tetap yang paling kanan — kalau
  // yang kiri yang menang (itulah `trustProxy: true`), satu header palsu per
  // permintaan sudah cukup untuk melewati rate limit selamanya.
  const hasil = await login(app, {
    ip: PENYERANG, password: 'password-salah', forwardedFor: `1.2.3.4, ${PENYERANG}`,
  });
  assert.equal(hasil.statusCode, 429);
});
