import React from "react";
import { FileText, Image, Music, Video } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { formatTime } from "../lib/format.js";
import { Avatar } from "./Avatar.jsx";

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

export function ChatListItem({ chat, selected, onOpen }) {
  const { t } = useI18n();
  const title = chat.name || (chat.type === "group" ? t("groupChat") : t("directChat"));
  const unreadCount = Number(chat.unreadCount || 0);

  return (
    <button className={`chat-list-item ${selected ? "selected" : ""}`} onClick={() => onOpen(chat.id)}>
      <Avatar name={title} type={chat.type} />
      <span className="chat-list-main">
        <span className="chat-list-row">
          <strong>{title}</strong>
          <time>{formatTime(chat.latestMessage?.createdAt || chat.updatedAt)}</time>
        </span>
        <span className="chat-list-row chat-list-preview">
          <span>
            <LatestIcon type={chat.latestMessage?.messageType} />
            {latestLabel(chat, t)}
          </span>
          {unreadCount > 0 && <em className="unread-badge">{unreadCount > 99 ? "99+" : unreadCount}</em>}
        </span>
      </span>
    </button>
  );
}
