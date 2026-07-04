import { deploymentHint, resolveApiBaseUrl, resolveApiUrl, resolveWebSocketUrl } from "./network.js";

const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_PUBLIC_URL || "";

export const API_BASE_URL = resolveApiBaseUrl(RAW_API_BASE_URL);
const TOKEN_KEY = "chatx_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response;
  try {
    response = await fetch(resolveApiUrl(path, RAW_API_BASE_URL), {
      ...options,
      headers,
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
    });
  } catch (cause) {
    if (import.meta.env.DEV) {
      console.warn("API request failed", {
        path,
        apiBaseUrl: API_BASE_URL || "(same-origin)",
        hint: deploymentHint(),
        cause
      });
    }
    const error = new Error("network_error");
    error.code = "network_error";
    error.details = deploymentHint();
    throw error;
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.code || "unknown");
    error.code = data.error?.code || "unknown";
    error.details = data.error?.details;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function apiUrl(path) {
  return resolveApiUrl(path, RAW_API_BASE_URL);
}

export function socketUrl() {
  return resolveWebSocketUrl(RAW_API_BASE_URL);
}

export function networkHint() {
  return deploymentHint();
}
