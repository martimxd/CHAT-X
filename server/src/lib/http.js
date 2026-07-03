export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function pickUserPublic(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    isFirstAdmin: row.is_first_admin,
    isBanned: row.is_banned,
    isDisabled: row.is_disabled,
    language: row.language,
    showReadReceipts: row.show_read_receipts,
    showOnlineStatus: row.show_online_status,
    onlineVisibility: row.online_visibility,
    lastSeenVisibility: row.last_seen_visibility,
    showTypingStatus: row.show_typing_status,
    defaultDisappearingSeconds: row.default_disappearing_seconds,
    nickname: row.nickname || null,
    blockedByMe: Boolean(row.blocked_by_me),
    blocksMe: Boolean(row.blocks_me),
    publicKeyJwk: row.public_key_jwk,
    avatarMediaId: row.avatar_media_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}
