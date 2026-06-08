# https://hub.docker.com/layers/library/node/24.16.0-slim/images/sha256-cbd8bcbdfd0d148205c9449dff3ca3c9c94d73f393a0e03ef1c8d3846c5038bf
FROM node:24.16.0-slim@sha256:cbd8bcbdfd0d148205c9449dff3ca3c9c94d73f393a0e03ef1c8d3846c5038bf

RUN apt update -y && apt install openssl -y && apt clean

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci && npm cache clean --force

COPY src src

USER node
CMD ["node", "src/start.js"]
