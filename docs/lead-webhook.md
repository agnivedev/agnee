# Webhook lead untuk pihak ketiga

Website, WordPress, robot, atau CRM bisa mengirim lead ke sebuah company Agnee, lalu
melaporkan bahwa account lead itu sudah terhubung. Agnee mencatat lead di pipeline,
mengirim satu WhatsApp sambutan, dan saat terhubung memindahkan lead ke `closing`
serta mengirim satu WhatsApp konfirmasi.

## Menyiapkan (supervisor company)

- `POST /v1/integrations/lead-webhook/secret` `{"kind":"lead"|"verify"}`: membuat secret
  (64 hex), **tampil sekali**, yang lama langsung tidak berlaku. Dua secret terpisah:
  `lead` untuk pengirim lead, `verify` untuk pengirim verifikasi.
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

Rute lama `/webhook/lead` dan `/webhook/lead-verify` (berbasis env, Bull Babe) tetap jalan.
