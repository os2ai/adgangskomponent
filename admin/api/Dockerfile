FROM node:24.13.1-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci && npm cache clean --force

COPY src src

USER node
CMD ["node", "src/start.js"]
