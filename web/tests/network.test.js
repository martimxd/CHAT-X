import { describe, expect, it } from "vitest";
import { normalizeClientBaseUrl, resolveApiBaseUrl, resolveApiUrl, resolveWebSocketUrl } from "../src/lib/network.js";

function location(url) {
  return new URL(url);
}

describe("network URL generation", () => {
  it("uses relative API URLs by default", () => {
    expect(resolveApiBaseUrl("", location("https://random.trycloudflare.com"))).toBe("");
    expect(resolveApiUrl("/api/health", "", location("https://random.trycloudflare.com"))).toBe("/api/health");
  });

  it("does not call localhost from a public tunnel page", () => {
    expect(resolveApiBaseUrl("http://localhost:4000", location("https://random.trycloudflare.com"))).toBe("");
    expect(resolveApiUrl("/api/auth/login", "http://127.0.0.1:4000", location("https://chat.example.com"))).toBe("/api/auth/login");
  });

  it("blocks mixed-content API overrides on HTTPS pages", () => {
    expect(resolveApiBaseUrl("http://api.example.com", location("https://chat.example.com"))).toBe("");
  });

  it("keeps valid HTTPS API overrides for split-origin deployments", () => {
    expect(resolveApiBaseUrl("https://api.example.com/", location("https://chat.example.com"))).toBe("https://api.example.com");
  });

  it("generates WebSocket URLs from the current browser origin", () => {
    expect(resolveWebSocketUrl("", location("https://random.trycloudflare.com"))).toBe("wss://random.trycloudflare.com");
    expect(resolveWebSocketUrl("", location("http://localhost:3000"))).toBe("ws://localhost:3000");
  });

  it("generates WebSocket URLs from valid API overrides", () => {
    expect(resolveWebSocketUrl("https://api.example.com", location("https://chat.example.com"))).toBe("wss://api.example.com");
  });

  it("normalizes configured API base URLs", () => {
    expect(normalizeClientBaseUrl("https://chat.example.com/")).toBe("https://chat.example.com");
    expect(normalizeClientBaseUrl("/edge/")).toBe("/edge");
  });
});
