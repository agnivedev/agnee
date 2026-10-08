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

# Disk server dipakai bersama Insight dan aplikasi lain. Tanpa pemangkasan,
# cache build menumpuk sampai build berikutnya tidak bisa menulis — 2 Okt 2026
# disk penuh sampai container database Insight ikut hilang. Cache dipangkas
# (bukan dihapus habis, supaya build tetap cepat) sebelum build, image lama
# dibuang sesudahnya.
#
# 8 Okt 2026 itu terulang dengan cara lain: build Agnee dan build Insight jalan
# BERSAMAAN, disk 20 GB habis sampai 0 byte, Postgres produksi mati, dan Docker
# meninggalkan endpoint jaringan rusak. Dua pagar di bawah mencegahnya:
#   1. tunggu build lain di server (Insight, atau build manual) selesai dulu;
#   2. jangan mulai build kalau sisa disk di bawah DEPLOY_MIN_FREE_MB.
# Build yang tidak dimulai tidak merusak apa pun: container lama tetap
# melayani, dan deploy ini gagal dengan pesan yang jelas.

# Batas sisa disk sebelum build. Build Agnee dari cache memakan ~0,5 GB, build
# penuh (npm ci + Chromium) lebih; 8 Okt titik terendahnya 320 MB dari awal
# 1,5 GB. 2 GB menyisakan ruang untuk Postgres yang tetap menulis selama build.
MIN_FREE_MB="${DEPLOY_MIN_FREE_MB:-2048}"
# Berapa lama menunggu build lain sebelum menyerah. Build Insight biasanya
# selesai dalam beberapa menit; lebih dari ini berarti ada yang macet dan
# perlu dilihat orang, bukan ditimpa build kedua.
BUILD_WAIT_SECONDS="${DEPLOY_BUILD_WAIT_SECONDS:-900}"

sisa_disk_mb() {
  # Root data Docker, bukan direktori repo: di server keduanya satu dataset,
  # tapi yang diisi build adalah /var/lib/docker.
  df -Pm "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)" | awk 'NR==2 {print $4}'
}

build_lain_berjalan() {
  # Hanya proses yang PROGRAMNYA docker / plugin docker-compose dengan
  # subperintah build (pola berjangkar di awal baris perintah). Versi pertama
  # mencocokkan teks di mana saja dan ikut menangkap `bash -c "... grep 'docker
  # build' ..."` milik orang yang sedang memeriksa server, yang bisa menahan
  # deploy 15 menit lalu membatalkannya. Rantai `bash -c "... && docker compose
  # build ..."` tetap terdeteksi lewat proses anak docker-nya sendiri.
  pgrep -af '^([^ ]*/)?docker(-compose)? +(compose +)?(buildx +)?build( |$)' || true
}

menunggu=0
while [ -n "$(build_lain_berjalan)" ]; do
  if [ "$menunggu" -ge "$BUILD_WAIT_SECONDS" ]; then
    echo "GAGAL: masih ada build lain di server setelah ${BUILD_WAIT_SECONDS} detik:" >&2
    build_lain_berjalan >&2
    echo "Deploy dibatalkan sebelum build; produksi tetap menjalankan versi lama." >&2
    exit 1
  fi
  if [ "$menunggu" -eq 0 ]; then
    echo "==> Ada build lain di server, menunggu selesai:"
    build_lain_berjalan
  fi
  sleep 15
  menunggu=$((menunggu + 15))
done

docker builder prune -af --keep-storage 1500MB >/dev/null || true

sisa="$(sisa_disk_mb)"
if [ -z "$sisa" ] || [ "$sisa" -lt "$MIN_FREE_MB" ]; then
  # Satu pembersihan yang selalu aman sebelum menyerah: image tanpa tag yang
  # tidak dipakai container mana pun.
  docker image prune -f >/dev/null || true
  sisa="$(sisa_disk_mb)"
fi
if [ -z "$sisa" ] || [ "$sisa" -lt "$MIN_FREE_MB" ]; then
  echo "GAGAL: sisa disk ${sisa:-?} MB, butuh minimal ${MIN_FREE_MB} MB untuk build." >&2
  echo "Deploy dibatalkan sebelum build; produksi tetap menjalankan versi lama." >&2
  echo "Lihat 'docker system df' dan 'df -h /'. Jangan menghapus volume." >&2
  df -h / >&2 || true
  exit 1
fi
echo "==> Sisa disk ${sisa} MB (minimal ${MIN_FREE_MB} MB), mulai build"

docker compose build app mcp
docker compose up -d app mcp
docker image prune -f >/dev/null || true

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
