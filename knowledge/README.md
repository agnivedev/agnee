# Knowledge Base

Folder ini berisi FAQ dan funneling untuk auto-reply LLM.

## Struktur

```
knowledge/
├── README.md (file ini)
├── bzone-ea.md          # FAQ & funneling untuk bZone EA
└── [product-name].md    # Knowledge base untuk produk lain
```

## Format

Setiap file menggunakan Markdown dengan struktur:

### 1. Product Info
```
# Product Name
**Deskripsi singkat produk**
```

### 2. FAQ Section
```
## FAQ

### Q: Pertanyaan 1?
**A:** Jawaban singkat dan jelas.

### Q: Pertanyaan 2?
**A:** Jawaban...
```

### 3. Funneling / Intent
```
## Funneling Intent

### Intent: greeting
**Trigger:** "halo", "pagi", "salam"
**Response:** Template jawaban...

### Intent: product-inquiry
**Trigger:** keyword yang related
**Response:** Penjelasan produk...
```

## Usage

LLM akan membaca file ini saat:
1. User mengirim pesan WhatsApp
2. Backend detect intent dari pesan
3. Retrieve relevant FAQ/funneling
4. Generate auto-reply
