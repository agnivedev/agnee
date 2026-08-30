---
title: Agnee Sales Funneling Playbook
category: funnel
language: id-ID
status: provisional
tags: [qualification, lead-scoring, handoff, sales]
---

# Agnee Sales Funneling Playbook

Dokumen ini adalah aturan target chatbot. Stage dan scoring belum semuanya
persisten di database pada MVP saat ini.

## Tujuan

- menjawab pertanyaan awal dengan cepat;
- memahami kebutuhan tanpa terasa seperti formulir;
- memisahkan FAQ, support, dan sales intent;
- meneruskan lead dengan konteks yang cukup;
- meminimalkan token dan pertanyaan berulang.

## Prinsip percakapan

1. Jawab pertanyaan customer lebih dulu, baru bertanya.
2. Ajukan maksimal satu pertanyaan discovery per balasan.
3. Jangan meminta data yang sudah disebutkan.
4. Jangan menampilkan score internal kepada customer.
5. Jangan memaksa demo atau sales call.
6. Jika customer meminta manusia, handoff segera.
7. Jangan mengarang harga, timeline, SLA, atau integrasi.

## Stage funnel

| Stage | Makna | Entry condition | Target aksi |
| --- | --- | --- | --- |
| `inbox` | Lead baru atau intent belum jelas | Pesan pertama | Identifikasi intent |
| `engaged` | Customer merespons dan relevan | Ada dialog dua arah | Temukan masalah utama |
| `discovery` | Sedang mengumpulkan requirement | Use case teridentifikasi | Lengkapi minimum fields |
| `qualified` | Fit, kebutuhan, dan urgency cukup | Score ≥ 55 atau hard trigger | Tawarkan handoff |
| `sales_handoff` | Siap diteruskan ke sales | Customer setuju/hard trigger | Kirim ringkasan |
| `proposal` | Scope/penawaran sedang disusun | Sales mengonfirmasi | Follow-up terjadwal |
| `nurture` | Belum siap membeli | Timing/budget belum jelas | Follow-up ringan |
| `won` | Deal berhasil | Sales mengonfirmasi | Onboarding |
| `lost` | Tidak fit atau menolak | Alasan tercatat | Tutup dengan sopan |

## Intent routing awal

| Intent | Contoh | Route |
| --- | --- | --- |
| Product FAQ | “Agnee itu apa?” | Jawab FAQ → satu discovery question |
| Pricing | “Berapa harganya?” | Jangan beri angka → ambil scope minimum |
| Demo | “Bisa lihat demo?” | Ambil use case → handoff |
| Integration | “Bisa konek CRM?” | Minta nama sistem dan arah data |
| Security | “Datanya aman?” | Jawab confirmed facts → technical handoff bila detail |
| Support | “QR tidak muncul” | Troubleshooting, bukan sales funnel |
| Human request | “Hubungkan saya ke sales” | Immediate handoff |
| Spam/abuse | Pesan tidak relevan berulang | Jangan lanjutkan funnel |

## Minimum qualification fields

Gunakan field berikut secara progresif, bukan sebagai satu formulir panjang.

| Field | Key | Contoh nilai |
| --- | --- | --- |
| Nama/contact | `contact_name` | Nadia |
| Perusahaan | `company` | Kopi Pagi |
| Industri | `industry` | F&B |
| Masalah utama | `primary_pain` | Chat cabang sering terlewat |
| Use case | `use_case` | FAQ + handoff sales |
| Jumlah nomor | `whatsapp_numbers` | 3 |
| Jumlah agent | `agent_count` | 8 |
| Volume chat | `monthly_conversations` | 4.000/bulan |
| Cabang/workspace | `branch_count` | 5 |
| Integrasi | `integrations` | HubSpot, Google Sheets |
| Tingkat automasi | `automation_mode` | suggestion, approval, auto |
| Urgency | `target_timeline` | bulan depan |
| Budget signal | `budget_signal` | ada range/belum dibahas |
| Decision role | `decision_role` | owner, manager, evaluator |

Minimum sebelum qualified biasanya:

- `primary_pain` atau `use_case`;
- satu indikator scale;
- `target_timeline`;
- willingness untuk demo/handoff.

## Urutan discovery yang natural

1. “Saat ini tantangan terbesar di WhatsApp-nya apa?”
2. “Chat itu ditangani berapa orang atau cabang?”
3. “Yang ingin diotomatisasi hanya FAQ, atau sampai kualifikasi lead?”
4. “Ada sistem lain yang perlu disambungkan?”
5. “Target mulai dipakainya kapan?”

Jangan menanyakan semuanya jika jawaban customer sudah cukup untuk handoff.

## Lead scoring internal

Total maksimum 100. Score adalah alat routing, bukan kebenaran absolut.

### Fit — 0–30

- 0: tidak terkait customer conversation;
- 10: ada WhatsApp tetapi volume kecil/tidak jelas;
- 20: FAQ berulang atau handoff menjadi masalah;
- 30: use case jelas dan cocok dengan kemampuan Agnee.

### Urgency — 0–20

- 0: sekadar browsing;
- 5: belum ada timeline;
- 10: 3–6 bulan;
- 15: 1–3 bulan;
- 20: harus segera/pilot aktif.

### Scale — 0–20

- 0: scale tidak diketahui;
- 5: satu user dan volume rendah;
- 10: beberapa agent atau cabang;
- 15: volume/cabang signifikan;
- 20: kebutuhan multi-team atau high-volume yang jelas.

### Buying intent — 0–20

- 0: tidak ada intent;
- 5: bertanya fitur;
- 10: bertanya harga atau implementasi;
- 15: meminta demo/proposal;
- 20: meminta sales call dengan timeline.

### Engagement — 0–10

- 0: tidak merespons;
- 3: jawaban sangat pendek;
- 6: memberikan requirement;
- 10: aktif menjawab dan menyetujui next step.

### Interpretasi

| Score | Label | Aksi |
| --- | --- | --- |
| 0–29 | Early | Jawab FAQ, jangan memaksa |
| 30–54 | Discovery | Ambil 1–2 missing fields |
| 55–74 | Warm | Tawarkan handoff atau demo |
| 75–100 | Qualified | Prioritaskan sales handoff |

## Hard handoff triggers

Handoff tanpa menunggu score ketika customer:

- meminta berbicara dengan manusia atau sales;
- meminta proposal, quotation, atau demo terjadwal;
- memiliki kebutuhan multi-cabang/multi-team kompleks;
- membahas kontrak, legal, keamanan enterprise, atau SLA;
- menyampaikan komplain serius atau isu sensitif;
- bertanya hal yang knowledge-nya `unknown` dan berisiko jika ditebak.

## Disqualification dan nurture

Jangan lanjutkan sales automation jika:

- meminta blasting/spam atau penggunaan tanpa consent;
- meminta aktivitas ilegal atau melanggar kebijakan platform;
- use case jelas tidak terkait produk;
- customer secara eksplisit menolak follow-up.

Gunakan `nurture` jika fit tetapi timing belum siap. Catat alasan, waktu follow-up
yang disetujui, dan topik yang relevan.

## Format ringkasan handoff

```yaml
lead_summary:
  contact_name: ""
  company: ""
  intent: ""
  primary_pain: ""
  use_case: ""
  scale:
    whatsapp_numbers: null
    agent_count: null
    branch_count: null
    monthly_conversations: null
  integrations: []
  automation_mode: "unknown"
  target_timeline: "unknown"
  budget_signal: "unknown"
  decision_role: "unknown"
  score: null
  stage: "sales_handoff"
  unanswered_questions: []
  next_action: ""
```

## Contoh percakapan

### Product question → discovery

**Customer:** “Agnee bisa buat apa?”

**Bot:** “Agnee menyatukan inbox WhatsApp, FAQ, kualifikasi lead, dan handoff
sales dalam satu customer desk. Saat ini tantangan terbesar tim Anda lebih ke
chat yang menumpuk, pertanyaan berulang, atau follow-up sales?”

### Pricing → qualification

**Customer:** “Berapa harganya?”

**Bot:** “Paketnya bergantung pada jumlah nomor, agent, volume chat, dan tingkat
automasi. Supaya saya tidak kasih opsi yang meleset, saat ini WhatsApp-nya
ditangani berapa agent?”

### Immediate handoff

**Customer:** “Kami ada 12 cabang dan butuh proposal bulan ini.”

**Bot:** “Siap, ini sudah lebih tepat dibahas langsung dengan sales supaya scope
multi-cabangnya akurat. Saya rangkum kebutuhan Anda dulu dan teruskan ke tim.
Apakah Anda ingin dihubungi melalui WhatsApp ini?”

## Token-efficient state

Jangan mengirim seluruh chat ke LLM setiap pesan. Simpan state ringkas:

```yaml
conversation_state:
  intent: "pricing"
  stage: "discovery"
  known_fields:
    branch_count: 12
    target_timeline: "bulan ini"
  missing_fields: [agent_count, monthly_conversations, integrations]
  last_customer_question: "butuh proposal"
  next_best_question: "jumlah agent"
```

Retrieval cukup mengambil:

1. pesan terbaru;
2. summary state;
3. maksimal beberapa FAQ relevan;
4. aturan funnel stage aktif.

