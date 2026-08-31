# Agnee Multi-client Knowledge

Agnee adalah platform. Knowledge yang dipakai untuk menjawab customer selalu
milik client/tenant, bukan knowledge tentang Agnee.

```text
knowledge/clients/<client-id>/
├── tenant.json
├── faq/
├── funnel/
└── policies/
```

Client runtime dipilih melalui `KNOWLEDGE_CLIENT`; default saat ini `bzone`.
Loader hanya membaca satu client aktif sehingga fakta, harga, persona, dan funnel
antarklien tidak tercampur.

| ID | Brand | Produk utama | Status |
| --- | --- | --- | --- |
| `bzone` | bZone Alpha / Bengkel EA Gold | EA MT5 custom dan bZone Chainsaw | aktif |
| `agnee` | Agnee by Agnive | Chatbot WhatsApp, customer desk, dan MCP | draft/internal |

Untuk client baru, salin struktur `clients/bzone`, ganti `tenant.json`, lalu isi
FAQ/funnel/policy dari sumber client yang sudah disetujui. Dokumentasi produk
Agnee berada di root project dan `docs/`, bukan di customer-facing knowledge.

Knowledge `agnee` dipertahankan untuk chatbot landing page dan penjualan produk
Agnee. Knowledge `bzone` dipakai untuk melayani customer bZone. Keduanya tidak
dimuat bersamaan.
