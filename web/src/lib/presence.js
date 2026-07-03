import { formatTime } from "./format.js";

export function typingSummary(chat, currentUser, typingUsers, t) {
  const users = [...(typingUsers?.values?.() || [])].filter((item) => item.userId !== currentUser?.id);
  if (users.length === 0) return "";
  if (chat?.type === "group") {
    if (users.length === 1) return t("userTyping", { name: users[0].userName });
    if (users.length === 2) return t("twoUsersTyping", { first: users[0].userName, second: users[1].userName });
    return t("severalTyping");
  }
  return t("typing");
}

export function statusText(peer, t) {
  if (!peer) return "";
  if (peer.online) return t("online");
  if (peer.lastSeenAt) return t("lastSeenAt", { time: formatTime(peer.lastSeenAt) });
  return t("offline");
}
