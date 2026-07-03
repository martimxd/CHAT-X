const PRIVATE_KEY_STORAGE = "shsm_private_key_jwk";
const PBKDF2_ITERATIONS = 250000;

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8Encode(value) {
  return new TextEncoder().encode(value);
}

function utf8Decode(value) {
  return new TextDecoder().decode(value);
}

async function derivePasswordKey(password, salt) {
  const baseKey = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function generateIdentityBundle(password) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const encryptedPrivateKeyJwk = await encryptPrivateKeyJwk(privateKeyJwk, password);
  savePrivateKeyJwk(privateKeyJwk);
  return { publicKeyJwk, encryptedPrivateKeyJwk, privateKey: keyPair.privateKey };
}

export async function encryptPrivateKeyJwk(privateKeyJwk, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePasswordKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    utf8Encode(JSON.stringify(privateKeyJwk))
  );
  return {
    version: 1,
    algorithm: "PBKDF2-SHA256-AES-GCM",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptPrivateKeyBundle(bundle, password) {
  const salt = base64ToBytes(bundle.salt);
  const iv = base64ToBytes(bundle.iv);
  const key = await derivePasswordKey(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    base64ToBytes(bundle.ciphertext)
  );
  const privateKeyJwk = JSON.parse(utf8Decode(plaintext));
  savePrivateKeyJwk(privateKeyJwk);
  return importPrivateKey(privateKeyJwk);
}

export async function importPrivateKey(privateKeyJwk) {
  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["decrypt"]
  );
}

export function savePrivateKeyJwk(privateKeyJwk) {
  sessionStorage.setItem(PRIVATE_KEY_STORAGE, JSON.stringify(privateKeyJwk));
}

export async function loadPrivateKey() {
  const stored = sessionStorage.getItem(PRIVATE_KEY_STORAGE);
  if (!stored) return null;
  return importPrivateKey(JSON.parse(stored));
}

export function clearPrivateKey() {
  sessionStorage.removeItem(PRIVATE_KEY_STORAGE);
}

export async function generateChatKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportChatKey(chatKey) {
  const raw = await crypto.subtle.exportKey("raw", chatKey);
  return bytesToBase64(new Uint8Array(raw));
}

export async function importChatKey(rawBase64) {
  return crypto.subtle.importKey("raw", base64ToBytes(rawBase64), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

export async function wrapChatKeyForUser(chatKey, publicKeyJwk) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"]
  );
  const raw = await crypto.subtle.exportKey("raw", chatKey);
  const ciphertext = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, raw);
  return {
    version: 1,
    algorithm: "RSA-OAEP-SHA256",
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function unwrapChatKey(envelope, privateKey) {
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, base64ToBytes(envelope.ciphertext));
  return importChatKey(bytesToBase64(new Uint8Array(raw)));
}

async function gzipBytes(bytes) {
  if (!("CompressionStream" in window)) {
    return { bytes, compression: "none" };
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return { bytes: compressed, compression: "gzip" };
}

async function gunzipBytes(bytes, compression) {
  if (compression !== "gzip") return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encryptPayload(chatKey, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = utf8Encode(JSON.stringify(payload));
  const compressed = await gzipBytes(encoded);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chatKey, compressed.bytes);
  return {
    version: 1,
    algorithm: "AES-GCM-256",
    compression: compressed.compression,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptPayload(chatKey, envelope) {
  if (!envelope?.ciphertext) return null;
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    chatKey,
    base64ToBytes(envelope.ciphertext)
  );
  const decompressed = await gunzipBytes(new Uint8Array(plaintext), envelope.compression);
  return JSON.parse(utf8Decode(decompressed));
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) return file;
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = bitmapUrl;
    });
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    return new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export async function encryptFileForChat(chatKey, file) {
  const preparedFile = await compressImage(file);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await preparedFile.arrayBuffer());
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chatKey, data);
  const encryptedBlob = new Blob([ciphertext], { type: "application/octet-stream" });
  return {
    encryptedBlob,
    metadata: {
      version: 1,
      algorithm: "AES-GCM-256",
      iv: bytesToBase64(iv),
      originalName: file.name,
      storedName: preparedFile.name,
      originalMimeType: file.type || "application/octet-stream",
      storedMimeType: preparedFile.type || "application/octet-stream",
      originalByteSize: file.size,
      storedByteSize: preparedFile.size,
      compressedInBrowser: preparedFile !== file
    }
  };
}

export async function decryptFileFromChat(chatKey, encryptedBlob, metadata) {
  const ciphertext = await encryptedBlob.arrayBuffer();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(metadata.iv) },
    chatKey,
    ciphertext
  );
  return new Blob([plaintext], { type: metadata.storedMimeType || metadata.originalMimeType || "application/octet-stream" });
}
