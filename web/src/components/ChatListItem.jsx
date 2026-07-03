import React from "react";
import { FileText, Image, Music, Video } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { formatTime } from "../lib/format.js";
import { Avatar } from "./Avatar.jsx";
import { getChatTitle, getDirectPeer } from "../lib/chat.js";
import { typingSummary } from "../lib/presence.js";

function latestLabel(chat, t) {
  if (!chat.latestMessage) return t("noMessages");
  if (chat.latestMessage.deletedForEveryoneAt) return t("deletedMessage");
  if (chat.latestMessage.messageType === "image") return t("imageMessage");
  if (chat.latestMessage.messageType === "video") return t("videoMessage");
  if (chat.latestMessage.messageType === "audio") return t("audioMessage");
  if (chat.latestMessage.messageType === "file") return t("fileMessage");
  return t("encryptedPreview");
}

function LatestIcon({ type }) {
  if (type === "image") return <Image size={14} />;
  if (type === "video") return <Video size={14} />;
  if (type === "audio") return <Music size={14} />;
  if (type === "file") return <FileText size={14} />;
  return null;
}

export function ChatListItem({ chat, selected, onOpen, currentUser, presence, typingUsers }) {
  const { t } = useI18n();
  const peer = getDirectPeer(chat, currentUser);
  const peerPresence = peer ? presence?.get(peer.id) : null;
  const title = getChatTitle(chat, currentUser, t);
  const unreadCount = Number(chat.unreadCount || 0);
  const typing = typingSummary(chat, currentUser, typingUsers, t);
  const avatarMediaId = chat.type === "group" ? chat.avatarMediaId : peer?.avatarMediaId;

  return (
    <button className={`chat-list-item ${selected ? "selected" : ""}`} onClick={() => onOpen(chat.id)}>
      <span className="avatar-presence">
        <Avatar name={title} type={chat.type} mediaId={avatarMediaId} />
        {peerPresence?.online && <i aria-label={t("online")} />}
      </span>
      <span className="chat-list-main">
        <span className="chat-list-row">
          <strong>{title}</strong>
          <time>{formatTime(chat.latestMessage?.createdAt || chat.updatedAt)}</time>
        </span>
        <span className="chat-list-row chat-list-preview">
          <span>
            {typing ? typing : <><LatestIcon type={chat.latestMessage?.messageType} />{latestLabel(chat, t)}</>}
          </span>
          {unreadCount > 0 && <em className="unread-badge">{unreadCount > 99 ? "99+" : unreadCount}</em>}
        </span>
      </span>
    </button>
  );
}
