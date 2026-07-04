const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function browserLocation() {
  return typeof window === "undefined" ? null : window.location;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function isLocalHostname(hostname) {
  return LOCAL_HOSTS.has(String(hostname || "").toLowerCase().replace(/^\[(.*)\]$/, "$1"));
}

export function normalizeClientBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimTrailingSlash(trimmed);
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return trimTrailingSlash(`${url.origin}${url.pathname === "/" ? "" : url.pathname}`);
  } catch {
    return "";
  }
}

export function resolveApiBaseUrl(rawBaseUrl, location = browserLocation()) {
  const baseUrl = normalizeClientBaseUrl(rawBaseUrl);
  if (!baseUrl || baseUrl.startsWith("/") || !location) return baseUrl;

  const configured = new URL(baseUrl);
  if (configured.origin === location.origin) return "";

  if (isLocalHostname(configured.hostname) && !isLocalHostname(location.hostname)) {
    console.warn("Ignoring localhost API override on a public page; using same-origin /api routes.");
    return "";
  }

  if (location.protocol === "https:" && configured.protocol === "http:") {
    console.warn("Ignoring insecure API override on an HTTPS page; using same-origin /api routes.");
    return "";
  }

  return baseUrl;
}

export function resolveApiUrl(path, baseUrl, location = browserLocation()) {
  return `${resolveApiBaseUrl(baseUrl, location)}${path}`;
}

export function resolveWebSocketUrl(rawBaseUrl, location = browserLocation()) {
  const apiBaseUrl = resolveApiBaseUrl(rawBaseUrl, location);

  if (apiBaseUrl && !apiBaseUrl.startsWith("/")) {
    const url = new URL(apiBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.origin;
  }

  if (!location) return undefined;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

export function isCloudflareTemporaryTunnel(location = browserLocation()) {
  return Boolean(location?.protocol === "https:" && location.hostname.toLowerCase().endsWith(".trycloudflare.com"));
}

export function deploymentHint(location = browserLocation()) {
  if (isCloudflareTemporaryTunnel(location)) {
    return "Cloudflare Tunnel detected. If strict origin checks are enabled, add this URL to ALLOWED_ORIGINS or set ALLOW_CLOUDFLARE_TEMP_TUNNELS=true.";
  }
  return "Check APP_PUBLIC_URL, API_PUBLIC_URL, ALLOWED_ORIGINS, and reverse proxy forwarding for /api and /socket.io.";
}
