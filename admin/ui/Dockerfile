# https://hub.docker.com/layers/library/node/24.16.0-slim/images/sha256-cbd8bcbdfd0d148205c9449dff3ca3c9c94d73f393a0e03ef1c8d3846c5038bf
FROM node:24.16.0-slim@sha256:cbd8bcbdfd0d148205c9449dff3ca3c9c94d73f393a0e03ef1c8d3846c5038bf AS build

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY src src
COPY static static
COPY svelte.config.js svelte.config.js
COPY vite.config.js vite.config.js
COPY jsconfig.json jsconfig.json

ENV PUBLIC_OIDC_AUTH_CLIENT_ID=PUBLIC_OIDC_AUTH_CLIENT_ID
ENV PUBLIC_OIDC_AUTH_AUTHORITY=PUBLIC_OIDC_AUTH_AUTHORITY
ENV PUBLIC_KEYCLOAK_API_BASEURL=PUBLIC_KEYCLOAK_API_BASEURL
ENV PUBLIC_KEYCLOAK_REALM_BASEURL=PUBLIC_KEYCLOAK_REALM_BASEURL
ENV PUBLIC_API_BASEURL=PUBLIC_API_BASEURL

RUN npm run build -- --mode production

# https://hub.docker.com/layers/library/nginx/1.31.1-alpine/images/sha256-31db9045b34376493fd4fb695d8a8d03bbfffaf6297fcde82d0f925ce2dd329a
FROM nginx:1.31.1-alpine@sha256:31db9045b34376493fd4fb695d8a8d03bbfffaf6297fcde82d0f925ce2dd329a
COPY --from=build /app/build/ /usr/share/nginx/html

ENV PUBLIC_OIDC_AUTH_CLIENT_ID=PUBLIC_OIDC_AUTH_CLIENT_ID
ENV PUBLIC_OIDC_AUTH_AUTHORITY=PUBLIC_OIDC_AUTH_AUTHORITY
ENV PUBLIC_KEYCLOAK_API_BASEURL=PUBLIC_KEYCLOAK_API_BASEURL
ENV PUBLIC_KEYCLOAK_REALM_BASEURL=PUBLIC_KEYCLOAK_REALM_BASEURL
ENV PUBLIC_API_BASEURL=PUBLIC_API_BASEURL

COPY ./nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
