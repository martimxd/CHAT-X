const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const envPath = fs.existsSync(path.join(root, ".env")) ? path.join(root, ".env") : path.join(root, ".env.example");
const errors = [];
const warnings = [];

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) entries.push(...walk(fullPath));
    else entries.push(fullPath);
  }
  return entries;
}

function isLocalUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function validateOriginList(value, name) {
  if (!value) return;
  for (const origin of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin.replace(/\/+$/, "")) {
        errors.push(`${name} contains an invalid origin: ${origin}`);
      }
    } catch {
      errors.push(`${name} contains an invalid origin: ${origin}`);
    }
  }
}

function scanFiles(files, patterns, label) {
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        errors.push(`${label} contains '${pattern}' in ${path.relative(root, file)}`);
      }
    }
  }
}

const env = readEnv(envPath);
const appPublicUrl = env.APP_PUBLIC_URL || env.PUBLIC_APP_URL || "";
const apiPublicUrl = env.API_PUBLIC_URL || "";
const allowedOrigins = env.ALLOWED_ORIGINS || env.CORS_ORIGIN || "";
const viteApiBaseUrl = env.VITE_API_BASE_URL || "";

if (!appPublicUrl) warnings.push("APP_PUBLIC_URL is not set.");
if (!apiPublicUrl) warnings.push("API_PUBLIC_URL is not set; same-origin /api will be used.");
validateOriginList(allowedOrigins, env.ALLOWED_ORIGINS ? "ALLOWED_ORIGINS" : "CORS_ORIGIN");

if (viteApiBaseUrl && isLocalUrl(viteApiBaseUrl) && appPublicUrl && !isLocalUrl(appPublicUrl)) {
  errors.push("VITE_API_BASE_URL points to localhost while APP_PUBLIC_URL is public. Leave VITE_API_BASE_URL empty for same-origin deployments.");
}

if (env.COOKIE_SECURE_AUTO === "false" && appPublicUrl.startsWith("https://")) {
  warnings.push("COOKIE_SECURE_AUTO=false with an HTTPS public URL can break secure cookie deployments.");
}

scanFiles(walk(path.join(root, "web", "src")), ["http://localhost", "ws://localhost", "http://127.0.0.1", "ws://127.0.0.1"], "public client source");

const distDir = path.join(root, "web", "dist");
if (fs.existsSync(distDir)) {
  scanFiles(
    walk(distDir).filter((file) => /\.(js|css|html)$/.test(file)),
    ["http://localhost", "ws://localhost", "http://127.0.0.1", "ws://127.0.0.1"],
    "production frontend bundle"
  );
} else {
  warnings.push("web/dist does not exist yet; run npm run build before checking the production bundle.");
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
console.info("Deployment checks passed.");
