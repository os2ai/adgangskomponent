import { PUBLIC_OIDC_AUTH_CLIENT_ID, PUBLIC_OIDC_AUTH_AUTHORITY } from "$env/static/public";

const _thisUrl = typeof location === "object" ? new URL(location.href) : new URL("https://adgang.os2.eu");
const _thisBaseUrl = `${_thisUrl.protocol}//${_thisUrl.host}`;

export const clientId = PUBLIC_OIDC_AUTH_CLIENT_ID || "PUBLIC_OIDC_AUTH_CLIENT_ID"; // OIDC_AUTH_CLIENT_ID can be replaced by nginx at runtime
export const authority = PUBLIC_OIDC_AUTH_AUTHORITY || "PUBLIC_OIDC_AUTH_AUTHORITY"; // OIDC_AUTH_AUTHORITY can be replaced by nginx at runtime
export const redirectUri = `${_thisBaseUrl}/`;
export const logoutUrl = `${_thisBaseUrl}/`;
