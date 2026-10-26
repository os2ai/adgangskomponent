# https://hub.docker.com/layers/library/node/24.22.1-slim/images/sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

RUN apt update -y && apt upgrade -y && apt install openssl -y && apt clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY src src
USER node
CMD ["node", "src/start.js"]
