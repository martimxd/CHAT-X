import React from "react";
import { Ban, Edit3, Reply, Trash2 } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { formatTime } from "../lib/format.js";
import { MediaMessage } from "./MediaMessage.jsx";

export function MessageBubble({
  item,
  own,
  chatKey,
  onReply,
  onEdit,
  onDelete,
  onImagePreview
}) {
  const { t } = useI18n();
  const { message, body } = item;
  const deleted = Boolean(message.deletedForEveryoneAt);
  const media = body?.media || message.media;
  const hasText = Boolean(body?.text);

  return (
    <article className={`message-bubble-row ${own ? "own" : "received"}`}>
      <div className={`message-bubble ${own ? "sent" : "received"}`}>
        {!own && <strong className="message-author">{message.senderDisplayName || message.senderUsername || t("deletedMessage")}</strong>}
        {deleted ? (
          <p className="deleted-copy">{t("deletedMessage")}</p>
        ) : (
          <>
            {media && (
              <MediaMessage media={media} messageType={message.messageType} chatKey={chatKey} onImagePreview={onImagePreview} />
            )}
            {hasText && <p className="message-text">{body.text}</p>}
            {!hasText && !media && <p className="message-text">{t("encryptedPreview")}</p>}
          </>
        )}
        <footer className="bubble-footer">
          {message.editedAt && <span>{t("editedLabel")}</span>}
          <time>{formatTime(message.createdAt)}</time>
        </footer>
        <div className="bubble-actions">
          <button onClick={() => onReply(item)} title={t("reply")} aria-label={t("reply")}><Reply size={15} /></button>
          {own && !deleted && <button onClick={() => onEdit(item)} title={t("edit")} aria-label={t("edit")}><Edit3 size={15} /></button>}
          <button onClick={() => onDelete(message, "me")} title={t("deleteForMe")} aria-label={t("deleteForMe")}><Trash2 size={15} /></button>
          {(own || item.canModerate) && !deleted && <button onClick={() => onDelete(message, "everyone")} title={t("deleteForEveryone")} aria-label={t("deleteForEveryone")}><Ban size={15} /></button>}
        </div>
      </div>
    </article>
  );
}
