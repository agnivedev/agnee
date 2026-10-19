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

## 4. Event member (WhatsApp ke member) — `POST /webhook/company/<slug>/event`

Pengirim (mis. WordPress member) mengabarkan satu kejadian, Agnee mengirim satu WhatsApp ke
member itu. Secret sama dengan pengirim lead (`lead`). Rute lama `POST /webhook/event` memakai
`LEAD_WEBHOOK_SECRET` + `LEAD_WEBHOOK_COMPANY` dan hanya menerima source `bullbabe-member`
dan `bullbabe-wp`. Body maksimal 64 KB.

```json
{
  "version": 1,
  "source": "bullbabe-member",
  "event": {
    "id": "acct-42-linked",
    "type": "account_linked",
    "whatsapp": "628123456789",
    "name": "Budi",
    "language": "id",
    "text": ""
  }
}
```

- `id` wajib, 1–80 karakter `A-Z a-z 0-9 : . _ -`, unik per kejadian. Id yang sama dalam
  24 jam tidak dikirim lagi.
- `type` wajib: `registered`, `account_linked`, `account_rejected`, `withdrawal_processing`,
  `withdrawal_done`, `withdrawal_failed`, `login_new_device`, `generic`.
- `whatsapp` wajib, nomor telepon saja (boleh diawali `0`, `62`, `+62`; alamat ber-`@` ditolak).
- `name` opsional (maks 100), `language` `id` | `en` (bawaan `id`).
- `text` opsional, maks 1000, dikirim apa adanya. Kosong = teks bawaan umum per `type` dan
  bahasa (tanpa angka atau tautan).

Respons (tanpa data member):

| Status | Body | Arti |
| --- | --- | --- |
| 200 | `{"ok":true,"sent":true}` | terkirim |
| 200 | `{"ok":true,"sent":false,"reason":"duplicate"}` | `id` sudah diterima dalam 24 jam |
| 200 | `{"ok":true,"sent":false,"reason":"throttled"}` | chat yang sama dengan `type` yang sama < 60 detik lalu (`login_new_device`: < 10 menit), atau chat itu sudah menerima 6 event dalam 1 jam terakhir (semua `type`) |
| 200 | `{"ok":true,"sent":false,"reason":"opted_out"}` | nomor ada di daftar berhenti broadcast (termasuk STOP dari chat `@lid` yang nomornya diketahui) |
| 200 | `{"ok":true,"sent":false,"reason":"send_failed"}` | WhatsApp gagal (nomor company belum tersambung, di luar jendela 24 jam Cloud API); jangan diulang terus |
| 429 | `{"error":...}` | lebih dari 200 percobaan kirim per jam per company |
| 400 | `{"error":...}` | payload atau nomor tidak sah |
| 401 / 404 / 503 | `{"error":...}` | tanda tangan salah/kedaluwarsa · rute/secret belum diatur · database belum siap atau daftar berhenti tidak terbaca |

Semua respons 200 menandai `id` selesai (kiriman ulang = `duplicate`); 429 dan 503 tidak, jadi
`id` yang sama boleh dikirim lagi nanti. Dedupe, jeda, dan kuota disimpan di memori, tidak
di database, dan kembali kosong saat Agnee dimulai ulang. Isi pesan dan nomor lengkap tidak
pernah dicatat di log.

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

Rute lama `/webhook/lead`, `/webhook/lead-verify`, dan `/webhook/event` (berbasis env, Bull Babe) tetap jalan.
