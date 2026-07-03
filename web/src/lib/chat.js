export function getMemberDisplayName(member) {
  return member?.nickname || member?.displayName || member?.username || "";
}

export function getChatTitle(chat, currentUser, t) {
  if (chat?.type === "group") return chat.name || t("groupChat");
  const peer = chat?.directPeer || chat?.members?.find((member) => member.id !== currentUser?.id);
  return getMemberDisplayName(peer) || t("directChat");
}

export function getDirectPeer(chat, currentUser) {
  return chat?.directPeer || chat?.members?.find((member) => member.id !== currentUser?.id) || null;
}

export function currentMember(chat, currentUser) {
  return chat?.members?.find((member) => member.id === currentUser?.id) || null;
}

export function canUsePermission(chat, currentUser, key) {
  if (chat?.type !== "group") return true;
  const member = currentMember(chat, currentUser);
  const value = chat.permissions?.[key] || "admins";
  return value === "everyone" || member?.role === "admin";
}
