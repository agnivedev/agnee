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
| `tradersmastermind` | Trader's Mastermind | Campaign webinar trading (keyword CHART) | aktif |
| `al-gold-fx` | AL Gold FX | Company Bang Al, CS Tari (playbook di `playbooks/al-gold-fx/`) | aktif |
| `beweix-digital` | Bewei | Jasa visual AI CGI dan iklan (hanya `tenant.json`; isinya di playbook per produk) | aktif |

Untuk client baru, salin struktur `clients/bzone`, ganti `tenant.json`, lalu isi
FAQ/funnel/policy dari sumber client yang sudah disetujui. Dokumentasi produk
Agnee berada di root project dan `docs/`, bukan di customer-facing knowledge.

Knowledge `agnee` dipertahankan untuk chatbot landing page dan penjualan produk
Agnee. Knowledge `bzone` dipakai untuk melayani customer bZone. Keduanya tidak
dimuat bersamaan.

## Paket Knowledge Source (`knowledge/ks/`)

Berbeda dari pack client di atas: `knowledge/ks/<paket>/` adalah template
percakapan yang dipasang ke sebuah company, bukan pengetahuan milik satu
client. Isinya General Knowledge (nada, alur, larangan), skema isian Specific
Knowledge, dan skenario simulasi. Folder ini juga menjadi sumber paket bawaan
sampai katalog Expertz tersedia. Lihat [`../docs/knowledge-source.md`](../docs/knowledge-source.md).
