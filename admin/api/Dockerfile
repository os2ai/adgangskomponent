FROM node:24.13.1-slim

RUN apt update -y && apt install openssl -y && apt clean

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci && npm cache clean --force

COPY src src

USER node
CMD ["node", "src/start.js"]
