# Webhook lead untuk pihak ketiga

Website, WordPress, robot, atau CRM bisa mengirim lead ke sebuah company Agnee, lalu
melaporkan bahwa account lead itu sudah terhubung. Agnee mencatat lead di pipeline,
mengirim satu WhatsApp sambutan, dan saat terhubung memindahkan lead ke `closing`
serta mengirim satu WhatsApp konfirmasi.

## Menyiapkan (supervisor company)

- `POST /v1/integrations/lead-webhook/secret` `{"kind":"lead"|"verify"|"pull"}`: membuat
  secret (64 hex), **tampil sekali**, yang lama langsung tidak berlaku. Tiga secret terpisah:
  `lead` untuk pengirim lead, `verify` untuk pengirim verifikasi, `pull` untuk penarik data.
- `GET /v1/integrations/lead-webhook`: status, path rute, template (tanpa secret).
- `PUT /v1/integrations/lead-webhook` `{"enabled":true,"templates":{"welcomeId","welcomeEn","confirmId","confirmEn"}}`:
  template kosong = teks bawaan umum. Penanda: `{name}` `{first_name}` `{broker}` `{company}`.
- `DELETE /v1/integrations/lead-webhook`: mencabut semuanya (rute jadi 404).

Belum ada layar web; saat ini lewat API.

## Menandatangani

Header `x-agnive-timestamp` (milidetik) dan `x-agnive-signature: sha256=<hex>`, dengan
`hex = HMAC_SHA256(secret, "<timestamp>.<bodyMentah>")`. Selisih waktu maksimal 5 menit.
Company tidak ada, dimatikan, atau belum punya secret: `404`. Tanda tangan salah: `401`.

## 1. Kirim lead — `POST /webhook/company/<slug>/lead`

```json
{
  "version": 1,
  "source": "acme-crm",
  "lead": {
    "submissionId": "member-12",
    "name": "Dewi Anggraini",
    "whatsapp": "08123456789",
    "email": "dewi@member.test",
    "brokerEmail": "dewi.trade@broker.test",
    "broker": "Valetax",
    "accountNumber": "",
    "language": "id",
    "welcomeText": ""
  }
}
```

`source`: huruf/angka/`.`/`_`/`-`, maks 40. `submissionId` unik per lead (kiriman ulang
tidak mengirim sambutan lagi). `brokerEmail` = email yang dipakai mendaftar di broker/layanan
(boleh beda dari `email`). `accountNumber` hanya 5–12 digit. `welcomeText` (maks 1000)
menggantikan template. Respons: `{"ok":true,"welcomed":true|false,"reason"?}`.

## 2. Lapor terhubung — `POST /webhook/company/<slug>/lead-verify`

```json
{
  "version": 1,
  "source": "acme-robot",
  "broker": "Valetax",
  "confirmText": "",
  "registrations": [
    { "submissionId": "member-12", "email": "dewi.trade@broker.test", "accountNumber": "55512345" }
  ]
}
```

Tiap baris cukup salah satu dari `submissionId` (pasti), `email` (dicocokkan ke `email` dan
`brokerEmail` lead), atau `accountNumber`. Broker harus sama dengan broker lead
(`Blueberry` = `Blueberry Markets`). Maks 500 baris. `confirmText` (maks 1000) menggantikan
template. Respons hanya angka: `{ok, received, matched, confirmed, alreadyConfirmed, failed}`.
Aman diulang: satu lead dikonfirmasi satu kali; `failed` = WhatsApp gagal, kirim ulang nanti.

## 3. Tarik lead (sinkron Agnee → pihak ketiga) — `GET /webhook/company/<slug>/leads`

Tanda tangan memakai secret `pull`, dengan **query string mentah** (tanpa `?`, kosong bila
tidak ada) di tempat body: `hex = HMAC_SHA256(secret, "<timestamp>.<query>")`.

Query: `cursor` (dari `nextCursor` sebelumnya), `limit` (1–500, bawaan 200), `status`
(`new` | `verified`).

```json
{
  "ok": true,
  "total": 3,
  "hasMore": false,
  "nextCursor": "MjAyNi0xMC0xNVQxMDow...",
  "leads": [
    {
      "submissionId": "member-12", "name": "Dewi Anggraini", "whatsapp": "628123456789",
      "email": "dewi@member.test", "brokerEmail": "dewi.trade@broker.test", "broker": "Valetax",
      "accountStatus": "new", "accountNumber": "", "language": "id",
      "status": "verified", "verifiedAt": "2026-10-15T09:00:00.000Z",
      "confirmationSentAt": "2026-10-15T09:00:02.000Z", "pipelineStage": "closing",
      "createdAt": "2026-10-14T03:00:00.000Z", "updatedAt": "2026-10-15T09:00:02.000Z"
    }
  ]
}
```

## Menjaga data tetap sama di kedua sisi

- **Pihak ketiga → Agnee:** kirim ulang `POST .../lead` dengan `submissionId` yang sama dan
  data terbaru. Nama, email, `brokerEmail`, broker, nomor account, dan bahasa diperbarui
  (field kosong tidak menghapus nilai lama; status verifikasi tidak pernah tersentuh). Kiriman
  ulang yang sama persis tidak mengubah apa pun dan tidak mengirim sambutan lagi.
  Nomor WhatsApp tidak berubah lewat kiriman ulang.
- **Agnee → pihak ketiga:** panggil `GET .../leads` berkala (mis. tiap menit). Simpan
  `nextCursor` dan kirim kembali di panggilan berikutnya; ulangi sampai `hasMore` false.
  Satu lead muncul lagi setiap kali profilnya, status verifikasinya, atau tahap pipeline-nya
  berubah, jadi cukup menimpa (upsert) berdasarkan `submissionId`. Panggilan pertama tanpa
  `cursor` mengambil semuanya.
- **Pemeriksaan:** `total` dibandingkan dengan jumlah lead di sisi Anda; selisih berarti ada
  yang belum tertarik. Tarik ulang tanpa `cursor` untuk rekonsiliasi penuh.

Rute lama `/webhook/lead` dan `/webhook/lead-verify` (berbasis env, Bull Babe) tetap jalan.
