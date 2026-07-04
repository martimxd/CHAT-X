import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NODE_ENV",
  "APP_PUBLIC_URL",
  "PUBLIC_APP_URL",
  "API_PUBLIC_URL",
  "ALLOWED_ORIGINS",
  "CORS_ORIGIN",
  "ALLOW_CLOUDFLARE_TEMP_TUNNELS",
  "TRUST_PROXY",
  "COOKIE_SECURE_AUTO",
  "COOKIE_SAMESITE",
  "MEDIA_ENCRYPTION_KEY_BASE64"
];

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const mediaKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadOrigin(env = {}) {
  restoreEnv();
  vi.resetModules();
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_PUBLIC_URL: "https://chat.example.com",
    ALLOWED_ORIGINS: "https://chat.example.com,http://localhost:3000,http://127.0.0.1:3000",
    MEDIA_ENCRYPTION_KEY_BASE64: mediaKey,
    ...env
  });
  return import("../src/lib/origin.js");
}

function mockReq(headers = {}, extra = {}) {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    method: "GET",
    protocol: "http",
    headers: normalizedHeaders,
    socket: {},
    get(name) {
      return normalizedHeaders[name.toLowerCase()];
    },
    header(name) {
      return normalizedHeaders[name.toLowerCase()];
    },
    ...extra
  };
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("deployment origin helpers", () => {
  it("allows configured origins and rejects unknown production origins", async () => {
    const { isOriginAllowed } = await loadOrigin();

    expect(isOriginAllowed("https://chat.example.com")).toBe(true);
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
    expect(isOriginAllowed("https://evil.example.net")).toBe(false);
  });

  it("only allows trycloudflare origins when explicitly enabled", async () => {
    let origin = await loadOrigin();
    expect(origin.isOriginAllowed("https://random.trycloudflare.com")).toBe(false);

    origin = await loadOrigin({ ALLOW_CLOUDFLARE_TEMP_TUNNELS: "true" });
    expect(origin.isOriginAllowed("https://random.trycloudflare.com")).toBe(true);
    expect(origin.isOriginAllowed("http://random.trycloudflare.com")).toBe(false);
  });

  it("detects secure cookies behind a trusted HTTPS proxy", async () => {
    const { getCookieOptions } = await loadOrigin({ TRUST_PROXY: "true", COOKIE_SECURE_AUTO: "true" });

    expect(getCookieOptions(mockReq({ "x-forwarded-proto": "https" })).secure).toBe(true);
    expect(getCookieOptions(mockReq({ "x-forwarded-proto": "http" })).secure).toBe(false);
  });

  it("generates invite links from the current allowed public origin", async () => {
    const { buildPublicUrl } = await loadOrigin({ ALLOW_CLOUDFLARE_TEMP_TUNNELS: "true", TRUST_PROXY: "true" });
    const req = mockReq({
      host: "server:4000",
      "x-forwarded-host": "random.trycloudflare.com",
      "x-forwarded-proto": "https"
    });

    expect(buildPublicUrl(req, "/invite/token")).toBe("https://random.trycloudflare.com/invite/token");
  });

  it("keeps signed media URLs relative to the authenticated API", async () => {
    const { buildMediaDownloadPath } = await import("../src/lib/public-paths.js");

    expect(buildMediaDownloadPath("media-id", 123, "a+b/c")).toBe("/api/media/media-id/download?expiresAt=123&signature=a%2Bb%2Fc");
  });
});

describe("health endpoint", () => {
  it("returns database, public URL, and websocket health without secrets", async () => {
    restoreEnv();
    vi.resetModules();
    Object.assign(process.env, {
      NODE_ENV: "production",
      APP_PUBLIC_URL: "https://chat.example.com",
      ALLOWED_ORIGINS: "https://chat.example.com",
      TRUST_PROXY: "true",
      MEDIA_ENCRYPTION_KEY_BASE64: mediaKey
    });
    vi.doMock("../src/db.js", () => ({
      pool: { query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 }) },
      query: vi.fn(),
      withTransaction: vi.fn()
    }));
    const request = (await import("supertest")).default;
    const { createApp } = await import("../src/app.js");

    const response = await request(createApp())
      .get("/api/health")
      .set("Host", "internal:4000")
      .set("X-Forwarded-Host", "chat.example.com")
      .set("X-Forwarded-Proto", "https")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      app: "Chat X",
      database: { ok: true },
      publicUrl: "https://chat.example.com",
      websocket: { available: true, path: "/socket.io" }
    });
    expect(JSON.stringify(response.body)).not.toContain("postgres://");
  });
});
