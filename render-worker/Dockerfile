FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb pulseaudio pulseaudio-utils ffmpeg dumb-init \
    fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 renderer && useradd -u 1001 -g renderer -m renderer

WORKDIR /app/render-worker
COPY render-worker/package.json render-worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=renderer:renderer render-worker/ ./
COPY --chown=renderer:renderer src/lib/htmlRecordingLayout.ts /app/src/lib/htmlRecordingLayout.ts
ENV CHROMIUM_BIN=/usr/bin/chromium
USER renderer
ENTRYPOINT ["dumb-init", "--", "node", "src/cli.mjs"]
