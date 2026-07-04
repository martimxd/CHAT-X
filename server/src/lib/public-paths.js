export function buildMediaDownloadPath(mediaId, expiresAt, signature) {
  return `/api/media/${mediaId}/download?expiresAt=${expiresAt}&signature=${encodeURIComponent(signature)}`;
}
