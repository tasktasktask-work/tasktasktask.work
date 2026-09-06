# syntax=docker/dockerfile:1
#
# 本番用のイメージ。アプリの実行とマイグレーションの適用を兼ねる。
#
#   docker compose up -d                  アプリを動かす
#   docker compose run --rm app migrate   スキーマを適用する
#
# VPS 側にはソースを置かない。このイメージだけを push する。

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=UTC
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Atlas は Go の単体バイナリ。実行時のイメージへ持ち込むためだけに取る。
FROM debian:bookworm-slim AS atlas
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# 版は .atlas-version にまとめてある。CI も同じものを読む。
# -latest は canary ビルドを返すため使わない。
#
# TARGETARCH は BuildKit が入れる。素の docker build では空になりうるので、
# そのときはイメージ自身のアーキテクチャから補う。
# 空のまま URL を組むと atlas-linux--v1.3.0 を取りにいって失敗する。
ARG TARGETARCH
COPY .atlas-version /tmp/.atlas-version
RUN ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" \
 && VERSION="$(cat /tmp/.atlas-version)" \
 && curl -fsSL -o /atlas "https://release.ariga.io/atlas/atlas-linux-${ARCH}-${VERSION}" \
 && chmod +x /atlas \
 && /atlas version

FROM base AS runtime
ENV NODE_ENV=production

# 添付ファイルの置き場。compose.yaml がホスト側のディレクトリを差し込む。
RUN mkdir -p /var/lib/task3/attachments && chown -R node:node /var/lib/task3

# Next の standalone 出力。必要な依存だけが同梱されている。
# pg と @node-rs/argon2 もここに含まれるので、マイグレーションからも使える。
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# マイグレーションを同じイメージで流すために持ち込む
COPY --from=atlas /atlas /usr/local/bin/atlas
COPY migrations ./migrations
COPY db ./db
COPY scripts/apply-functions.mjs ./scripts/apply-functions.mjs
COPY bin/migrate.sh /usr/local/bin/migrate
RUN chmod +x /usr/local/bin/migrate

USER node
EXPOSE 3000
CMD ["node", "server.js"]
