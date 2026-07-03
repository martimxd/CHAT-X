const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);
const videoExtensions = new Set(["mp4", "webm", "mov", "m4v", "ogg"]);
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "webm"]);

export function getMediaName(media = {}) {
  return media.originalName || media.storedName || media.filename || media.metadata?.originalName || media.metadata?.storedName || "media";
}

export function getMediaMimeType(media = {}, messageType = "file") {
  return media.storedMimeType || media.originalMimeType || media.mimeType || media.metadata?.storedMimeType || media.metadata?.originalMimeType || typeToMime(messageType);
}

export function getMediaSize(media = {}) {
  return media.storedByteSize || media.originalByteSize || media.size || media.metadata?.storedByteSize || media.metadata?.originalByteSize || 0;
}

export function detectMediaKind(media = {}, messageType = "file") {
  const mimeType = getMediaMimeType(media, messageType).toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  const name = getMediaName(media).toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : "";
  if (imageExtensions.has(extension)) return "image";
  if (videoExtensions.has(extension)) return "video";
  if (audioExtensions.has(extension)) return "audio";
  if (["image", "video", "audio"].includes(messageType)) return messageType;
  return "file";
}

function typeToMime(messageType) {
  if (messageType === "image") return "image/*";
  if (messageType === "video") return "video/*";
  if (messageType === "audio") return "audio/*";
  return "application/octet-stream";
}
