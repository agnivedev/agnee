# Base image dipaku ke digest, bukan tag mengambang.
#
# `node:22-bookworm-slim` di-retag upstream tanpa memberi tahu siapa pun. Waktu
# itu terjadi, digest-nya berubah dan SEMUA layer di bawahnya batal — termasuk
# `apt-get install chromium` yang biasanya tinggal ambil dari cache. Pada
# 21 Sep itu berarti mengunduh ulang seluruh Chromium dari deb.debian.org yang
# sedang merangkak (satu paket 3 MB butuh ~206 detik); setelah 13 menit koneksi
# SSH deploy-nya putus dan deploy gagal. Naik versi harus jadi keputusan sadar,
# bukan kejutan di tengah deploy.
#
# Cara menaikkan: ambil digest terbaru lalu ganti KEDUA baris FROM di bawah.
#   docker buildx imagetools inspect node:22-bookworm-slim | head -2
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

# ── Stage 1: build the frontend ───────────────────────────────────────────────
# web/ is a Vite build, so the image cannot serve a single page without it.
# It runs in its own stage so Vite, React and TypeScript never reach the
# runtime image.
FROM ${NODE_IMAGE} AS web

# This stage installs dev dependencies too, which pulls puppeteer in. Without
# this it would download a Chromium the build stage never runs.
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY web ./web
RUN npm run build:web


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates dumb-init fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node assets ./assets
COPY --chown=node:node knowledge ./knowledge
COPY --chown=node:node db ./db
COPY --from=web --chown=node:node /build/dist ./dist

RUN install -d -o node -g node /data/whatsapp /data/mcp

# Commit yang membangun image ini, ditanam di dalamnya.
#
# `git pull` di server bisa berhasil sementara build-nya gagal sesudahnya —
# itu persis yang terjadi 21 Sep, dan hasilnya HEAD server menunjuk commit baru
# sementara container masih melayani yang lama. Siapa pun yang mengecek
# `git rev-parse HEAD` saat itu akan mendapat jawaban yang salah. Sidik jari ini
# dibaca `deploy/remote-deploy.sh` supaya pertanyaannya bisa ditanyakan ke
# container yang BENAR-BENAR jalan, bukan ke working tree di sebelahnya.
#
# Sengaja diletakkan setelah semua COPY: ARG membatalkan cache untuk layer di
# bawahnya, dan nilainya berubah tiap commit. Di sini yang ikut dibangun ulang
# cuma layer-layer sepele ini.
#
# Tidak diekspos lewat /health — rute itu terbuka tanpa autentikasi.
ARG GIT_SHA=unknown
RUN printf '%s' "$GIT_SHA" > /app/.git-sha && chown node:node /app/.git-sha

USER node

EXPOSE 4100 4200

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
