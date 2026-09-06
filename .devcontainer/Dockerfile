FROM mcr.microsoft.com/devcontainers/base:resolute

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt update && apt upgrade -y && apt install -y \
    zsh

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash \
    && apt install -y nodejs

RUN corepack enable

RUN npm install -g \
    @anthropic-ai/claude-code

USER vscode

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV SHELL=/bin/zsh
ENV PATH=${PATH}:${HOME}/.local/bin
