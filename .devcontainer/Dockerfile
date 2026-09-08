FROM mcr.microsoft.com/devcontainers/base:resolute

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt update && apt upgrade -y && apt install -y \
    zsh

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash \
    && apt install -y nodejs

RUN corepack enable

RUN npm install -g \
    @anthropic-ai/claude-code

# Playwright が動かす chromium が要る共有ライブラリ。
# ブラウザの実体そのものは vscode の側で入れる（~/.cache/ms-playwright）。
# ここで入れるのは root でしか入らない apt の側だけである。
RUN npx --yes playwright@1.63.0 install-deps chromium

USER vscode

# ブラウザの実体。約170MB あるので、作り直したときに取り直す。
# 版は package.json の @playwright/test と揃えること。
# ずれると playwright が「入っていない」と言って落ちる。
RUN npx --yes playwright@1.63.0 install chromium

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV SHELL=/bin/zsh
ENV PATH=${PATH}:${HOME}/.local/bin
