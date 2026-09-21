#!/usr/bin/env bash
#
# Dijalankan DI SERVER produksi oleh .github/workflows/deploy.yml, tepat
# sesudah `git pull`. Isinya ada di repo dan bukan ditempel sebagai satu baris
# di dalam workflow, supaya bisa dibaca dan diubah lewat review biasa — dan
# karena `git pull` di atasnya selalu membawa versi terbaru sebelum
# dijalankan, perubahan di sini ikut berlaku pada deploy yang sama.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA
echo "==> Membangun ${GIT_SHA}"

docker compose build app mcp
docker compose up -d app mcp

# `git pull` bisa berhasil sementara build sesudahnya gagal. Itu yang terjadi
# 21 Sep: rantai perintahnya putus di `docker compose build`, `up -d` tidak
# pernah jalan, dan selama 19 menit HEAD server menunjuk commit baru sementara
# container masih melayani yang lama — sampai push berikutnya kebetulan
# memperbaikinya. Siapa pun yang mengecek `git rev-parse HEAD` saat itu akan
# mendapat jawaban yang salah tentang apa yang sebenarnya dilayani.
#
# "Perintahnya tidak error" bukan bukti kode baru sudah dilayani, jadi
# tanyakan langsung ke container yang benar-benar jalan.
gagal=0
for layanan in app mcp; do
  cid="$(docker compose ps -q "$layanan" || true)"
  if [ -z "$cid" ]; then
    echo "GAGAL: container ${layanan} tidak berjalan setelah deploy." >&2
    gagal=1
    continue
  fi
  terpasang="$(docker exec "$cid" cat /app/.git-sha 2>/dev/null || echo '<tidak terbaca>')"
  if [ "$terpasang" != "$GIT_SHA" ]; then
    echo "GAGAL: ${layanan} menjalankan '${terpasang}', seharusnya '${GIT_SHA}'." >&2
    gagal=1
    continue
  fi
  echo "==> ${layanan}: ${terpasang} ✓"
done

if [ "$gagal" -ne 0 ]; then
  echo "Image lama masih dilayani — deploy ini TIDAK sampai ke produksi." >&2
  exit 1
fi

echo "==> Deploy terverifikasi: produksi menjalankan ${GIT_SHA}"
