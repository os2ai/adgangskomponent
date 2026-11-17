# https://hub.docker.com/layers/library/node/26.13.1-slim/images/sha256-a5a5adfee3013de54504e0e6aff49993acf7daed072e86be75b8818c0f6ac258
FROM node:26.13.1-slim@sha256:a5a5adfee3013de54504e0e6aff49993acf7daed072e86be75b8818c0f6ac258

RUN apt update -y && apt install openssl -y && apt clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY src src
USER node
CMD ["node", "src/start.js"]
