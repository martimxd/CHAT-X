import { config } from "../config.js";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function firstHeaderValue(value) {
  if (Array.isArray(value)) return firstHeaderValue(value[0]);
  if (!value) return "";
  return String(value).split(",")[0].trim();
}

export function normalizeOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!HTTP_PROTOCOLS.has(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function normalizeHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

export function isLocalHostname(hostname) {
  const host = normalizeHost(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

export function isPrivateNetworkHostname(hostname) {
  const host = normalizeHost(hostname);
  if (host.endsWith(".local")) return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254);
}

export function isCloudflareTempTunnelOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const url = new URL(normalized);
  return url.protocol === "https:" && url.hostname.toLowerCase().endsWith(".trycloudflare.com");
}

export function getConfiguredAllowedOrigins() {
  return [...new Set(config.allowedOrigins.map(normalizeOrigin).filter(Boolean))];
}

export function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (getConfiguredAllowedOrigins().includes(normalized)) return true;
  const url = new URL(normalized);
  if (config.nodeEnv !== "production" && (isLocalHostname(url.hostname) || isPrivateNetworkHostname(url.hostname))) return true;
  if (config.allowCloudflareTempTunnels && isCloudflareTempTunnelOrigin(normalized)) return true;
  return false;
}

export function getRequestPublicOrigin(req) {
  const forwardedProto = config.trustProxy ? firstHeaderValue(req.headers["x-forwarded-proto"]) : "";
  const forwardedHost = config.trustProxy ? firstHeaderValue(req.headers["x-forwarded-host"]) : "";
  const proto = forwardedProto || req.protocol || (req.socket?.encrypted ? "https" : "http");
  const host = forwardedHost || req.get?.("host") || req.headers.host;
  const origin = normalizeOrigin(`${proto}://${host}`);
  return origin || normalizeOrigin(config.publicAppUrl);
}

export function isRequestOriginAllowed(req, origin = req.get?.("origin") || req.headers.origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (isOriginAllowed(normalized)) return true;

  const requestOrigin = getRequestPublicOrigin(req);
  if (config.nodeEnv !== "production" && normalized === requestOrigin) return true;
  return false;
}

export function getBestPublicOrigin(req) {
  const browserOrigin = normalizeOrigin(req.get?.("origin") || req.headers.origin);
  if (browserOrigin && isOriginAllowed(browserOrigin)) return browserOrigin;

  const refererOrigin = normalizeOrigin(req.get?.("referer") || req.headers.referer);
  if (refererOrigin && isOriginAllowed(refererOrigin)) return refererOrigin;

  const requestOrigin = getRequestPublicOrigin(req);
  if (requestOrigin && isOriginAllowed(requestOrigin)) return requestOrigin;
  return normalizeOrigin(config.publicAppUrl) || requestOrigin;
}

export function buildPublicUrl(req, pathname) {
  const origin = getBestPublicOrigin(req);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${origin}${path}`;
}

export function shouldValidateOrigin(req) {
  return STATE_CHANGING_METHODS.has(req.method);
}

export function isSecureRequest(req) {
  if (req.secure) return true;
  if (!config.trustProxy) return false;
  return firstHeaderValue(req.headers["x-forwarded-proto"]).toLowerCase() === "https";
}

export function getCookieOptions(req) {
  const sameSite = ["lax", "strict", "none"].includes(config.cookieSameSite) ? config.cookieSameSite : "lax";
  return {
    httpOnly: true,
    sameSite,
    secure: config.cookieSecureAuto ? isSecureRequest(req) : false
  };
}

export function describeOriginPolicy() {
  return {
    allowedOrigins: getConfiguredAllowedOrigins(),
    allowCloudflareTempTunnels: config.allowCloudflareTempTunnels,
    trustProxy: config.trustProxy
  };
}
