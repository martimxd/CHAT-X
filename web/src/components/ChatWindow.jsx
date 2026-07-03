import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MoreVertical, Paperclip, Pin, Search, Send, Smile } from "lucide-react";
import { api } from "../lib/api.js";
import { decryptPayload, encryptFileForChat, encryptPayload } from "../lib/crypto.js";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Avatar } from "./Avatar.jsx";
import { MessageBubble } from "./MessageBubble.jsx";
import { ImagePreviewModal } from "./ImagePreviewModal.jsx";

function classifyMessageType(file) {
  if (!file) return "text";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

export function ChatWindow({ chat, chatKey, user, eventVersion, onRefresh, onBack }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState([]);
  const [decrypted, setDecrypted] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [search, setSearch] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const messageEndRef = useRef(null);

  useEffect(() => {
    let active = true;
    api(`/api/chats/${chat.id}/messages`)
      .then((data) => { if (active) setMessages(data.messages); })
      .catch(() => {});
    api(`/api/chats/${chat.id}/read`, { method: "POST" }).catch(() => {});
    return () => { active = false; };
  }, [chat.id, eventVersion]);

  useEffect(() => {
    let active = true;
    Promise.all(messages.map(async (message) => {
      if (message.deletedForEveryoneAt || !message.encryptedPayload) {
        return { message, body: null, canModerate: chat.members?.some((member) => member.id === user.id && member.role === "admin") };
      }
      try {
        return {
          message,
          body: await decryptPayload(chatKey, message.encryptedPayload),
          canModerate: chat.members?.some((member) => member.id === user.id && member.role === "admin")
        };
      } catch {
        return {
          message,
          body: { text: t("decryptFailed") },
          canModerate: chat.members?.some((member) => member.id === user.id && member.role === "admin")
        };
      }
    })).then((items) => { if (active) setDecrypted(items); });
    return () => { active = false; };
  }, [messages, chatKey, chat.members, user.id, t]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [decrypted.length]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return decrypted;
    return decrypted.filter((item) => (item.body?.text || "").toLowerCase().includes(term));
  }, [decrypted, search]);

  const title = chat.name || chat.members?.filter((member) => member.id !== user.id).map((member) => member.displayName).join(", ") || t("directChat");
  const subtitle = chat.type === "group" ? t("groupStatus", { count: chat.members?.length || 0 }) : t("directStatus");

  async function submit(event) {
    event.preventDefault();
    if (!text.trim() && !file) return;
    setError("");
    try {
      if (editing) {
        const envelope = await encryptPayload(chatKey, { text, editedAt: new Date().toISOString() });
        await api(`/api/chats/${chat.id}/messages/${editing.message.id}`, { method: "PATCH", body: { encryptedPayload: envelope } });
        setEditing(null);
        setText("");
        await onRefresh();
        return;
      }

      let mediaId = null;
      let mediaMetadata = null;
      let messageType = "text";
      if (file) {
        const encrypted = await encryptFileForChat(chatKey, file);
        const form = new FormData();
        form.set("file", encrypted.encryptedBlob, `${file.name}.encrypted`);
        form.set("chatId", chat.id);
        form.set("purpose", "message");
        form.set("encryptedBlob", "true");
        form.set("metadata", JSON.stringify({ clientEncrypted: true, originalName: file.name }));
        const upload = await api("/api/media", { method: "POST", body: form });
        mediaId = upload.media.id;
        mediaMetadata = { id: mediaId, ...encrypted.metadata };
        messageType = classifyMessageType(file);
      }

      const envelope = await encryptPayload(chatKey, {
        text,
        media: mediaMetadata,
        sentAt: new Date().toISOString()
      });
      await api(`/api/chats/${chat.id}/messages`, {
        method: "POST",
        body: {
          encryptedPayload: envelope,
          messageType,
          mediaId,
          replyToId: replyTo?.message.id || null
        }
      });
      setText("");
      setFile(null);
      setReplyTo(null);
      await onRefresh();
    } catch (err) {
      setError(t(`error_${err?.code || "unknown"}`));
    }
  }

  async function removeMessage(message, scope) {
    await api(`/api/chats/${chat.id}/messages/${message.id}`, { method: "DELETE", body: { scope } });
    await onRefresh();
  }

  function startEdit(item) {
    setEditing(item);
    setText(item.body?.text || "");
  }

  return (
    <section className="wa-chat-window">
      <header className="wa-chat-header">
        <button className="mobile-back-button" onClick={onBack} title={t("backToChats")} aria-label={t("backToChats")}>
          <ArrowLeft size={20} />
        </button>
        <Avatar name={title} type={chat.type} size="lg" />
        <div className="wa-chat-title">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {chat.pinnedMessageId && <span className="pinned-chip"><Pin size={14} />{t("pinnedMessage")}</span>}
        <button className="header-icon-button" title={t("moreOptions")} aria-label={t("moreOptions")}><MoreVertical size={20} /></button>
      </header>

      <div className="wa-chat-search">
        <Search size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("localSearchPlaceholder")} />
      </div>

      <div className="wa-message-pane">
        {filtered.length === 0 && <p className="empty-list-copy center">{t("noMessages")}</p>}
        {filtered.map((item) => (
          <MessageBubble
            key={item.message.id}
            item={item}
            own={item.message.senderId === user.id}
            chatKey={chatKey}
            onReply={setReplyTo}
            onEdit={startEdit}
            onDelete={removeMessage}
            onImagePreview={(src, alt) => setPreview({ src, alt })}
          />
        ))}
        <div ref={messageEndRef} />
      </div>

      <form className="wa-composer" onSubmit={submit}>
        {(replyTo || editing || file || error) && (
          <div className="compose-context">
            <span>
              {editing ? t("edit") : replyTo ? `${t("replyTo")}: ${replyTo.body?.text || t("encryptedPreview")}` : file ? `${t("mediaReady")}: ${file.name}` : error}
            </span>
            <button type="button" onClick={() => { setReplyTo(null); setEditing(null); setFile(null); setError(""); }}>{t("cancel")}</button>
          </div>
        )}
        <button type="button" className="composer-icon-button" onClick={() => setText((value) => `${value}🙂`)} title={t("emoji")} aria-label={t("emoji")}>
          <Smile size={21} />
        </button>
        <label className="composer-icon-button" title={t("attachFile")} aria-label={t("attachFile")}>
          <Paperclip size={21} />
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={t("messagePlaceholder")} />
        <button className="composer-send" title={t("send")} aria-label={t("send")}><Send size={19} /></button>
      </form>

      <ImagePreviewModal src={preview?.src} alt={preview?.alt} onClose={() => setPreview(null)} />
    </section>
  );
}
