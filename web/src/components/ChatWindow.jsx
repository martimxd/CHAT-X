import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crown, FilePlus, LogOut, MoreVertical, Paperclip, Phone, Pin, Search, Send, Shield, Smile, UserMinus, UserPlus } from "lucide-react";
import { api } from "../lib/api.js";
import { decryptPayload, encryptFileForChat, encryptPayload } from "../lib/crypto.js";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Avatar } from "./Avatar.jsx";
import { MessageBubble } from "./MessageBubble.jsx";
import { ImagePreviewModal } from "./ImagePreviewModal.jsx";
import { PhotoCropper } from "./PhotoCropper.jsx";
import { SharedContentTabs } from "./SharedContentTabs.jsx";
import { canUsePermission, currentMember, getChatTitle, getDirectPeer, getMemberDisplayName } from "../lib/chat.js";
import { statusText, typingSummary } from "../lib/presence.js";

function classifyMessageType(file) {
  if (!file) return "text";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

export function ChatWindow({ chat, chatKey, user, eventVersion, onRefresh, onBack, onStartCall, socket, typingUsers, presence }) {
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [newMembers, setNewMembers] = useState("");
  const [permissionDraft, setPermissionDraft] = useState(chat.permissions || {});
  const messageEndRef = useRef(null);
  const searchRef = useRef(null);
  const typingStarted = useRef(false);
  const typingTimer = useRef(null);

  const directPeerBase = getDirectPeer(chat, user);
  const directPresence = directPeerBase ? presence?.get(directPeerBase.id) : null;
  const directPeer = directPeerBase ? { ...directPeerBase, ...directPresence } : null;
  const member = currentMember(chat, user);
  const isAdmin = member?.role === "admin";

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

  useEffect(() => {
    setPermissionDraft(chat.permissions || {});
    setNickname(directPeer?.nickname || "");
  }, [chat.id, chat.permissions, directPeer?.nickname]);

  const title = getChatTitle(chat, user, t);
  const typingText = typingSummary(chat, user, typingUsers, t);
  const onlineMembers = chat.members?.filter((item) => item.id !== user.id && (presence?.get(item.id)?.online || item.online)).length || 0;
  const subtitle = typingText || (chat.type === "group" ? t("groupStatusOnline", { count: chat.members?.length || 0, online: onlineMembers }) : statusText(directPeer, t));
  const avatarMediaId = chat.type === "group" ? chat.avatarMediaId : directPeer?.avatarMediaId;

  useEffect(() => {
    return () => {
      if (typingStarted.current && socket) socket.emit("typing", { chatId: chat.id, isTyping: false });
      window.clearTimeout(typingTimer.current);
      typingStarted.current = false;
    };
  }, [chat.id, socket]);

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
        form.set("metadata", JSON.stringify({
          clientEncrypted: true,
          originalName: file.name,
          originalMimeType: file.type || "application/octet-stream",
          originalByteSize: file.size,
          mediaKind: messageType
        }));
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
      socket?.emit("typing", { chatId: chat.id, isTyping: false });
      typingStarted.current = false;
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

  function handleTextChange(value) {
    setText(value);
    if (!socket) return;
    if (!typingStarted.current && value.trim()) {
      socket.emit("typing", { chatId: chat.id, isTyping: true });
      typingStarted.current = true;
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      if (typingStarted.current) socket.emit("typing", { chatId: chat.id, isTyping: false });
      typingStarted.current = false;
    }, 1600);
  }

  async function leaveGroup() {
    if (!window.confirm(t("leaveGroupConfirm"))) return;
    try {
      await api(`/api/chats/${chat.id}/leave`, { method: "POST", body: {} });
      onBack();
    } catch (err) {
      setError(t(`error_${err?.code || "unknown"}`));
    }
  }

  async function uploadGroupAvatar(file) {
    const form = new FormData();
    form.set("file", file);
    form.set("chatId", chat.id);
    form.set("purpose", "group_avatar");
    form.set("encryptedBlob", "false");
    try {
      await api("/api/media", { method: "POST", body: form });
      setCropperOpen(false);
      await onRefresh();
    } catch (err) {
      setError(t(`error_${err?.code || "unknown"}`));
    }
  }

  async function savePermissions() {
    try {
      await api(`/api/chats/${chat.id}/permissions`, { method: "PATCH", body: permissionDraft });
      await onRefresh();
    } catch (err) {
      setError(t(`error_${err?.code || "unknown"}`));
    }
  }

  async function addMembers(event) {
    event.preventDefault();
    const usernames = newMembers.split(",").map((value) => value.trim()).filter(Boolean);
    if (usernames.length === 0) return;
    await api(`/api/chats/${chat.id}/members`, { method: "POST", body: { usernames } });
    setNewMembers("");
    await onRefresh();
  }

  async function promote(memberId) {
    await api(`/api/chats/${chat.id}/members/${memberId}/promote`, { method: "POST" });
    await onRefresh();
  }

  async function demote(memberId) {
    await api(`/api/chats/${chat.id}/members/${memberId}/demote`, { method: "POST" });
    await onRefresh();
  }

  async function removeMember(memberId) {
    if (!window.confirm(t("removeMemberConfirm"))) return;
    await api(`/api/chats/${chat.id}/members/${memberId}`, { method: "DELETE" });
    await onRefresh();
  }

  async function toggleBlock() {
    if (!directPeer) return;
    const method = directPeer.blockedByMe ? "DELETE" : "POST";
    await api(`/api/users/${directPeer.id}/block`, { method });
    await onRefresh();
  }

  async function saveNickname(event) {
    event.preventDefault();
    if (!directPeer) return;
    if (nickname.trim()) {
      await api(`/api/users/${directPeer.id}/nickname`, { method: "PUT", body: { nickname: nickname.trim() } });
    } else {
      await api(`/api/users/${directPeer.id}/nickname`, { method: "DELETE" });
    }
    await onRefresh();
  }

  return (
    <section className="wa-chat-window">
      <header className="wa-chat-header">
        <button className="mobile-back-button" onClick={onBack} title={t("backToChats")} aria-label={t("backToChats")}>
          <ArrowLeft size={20} />
        </button>
        <button type="button" className="chat-header-identity" onClick={() => setInfoOpen(true)}>
          <span className="avatar-presence">
            <Avatar name={title} type={chat.type} size="lg" mediaId={avatarMediaId} />
            {chat.type === "direct" && directPeer?.online && <i aria-label={t("online")} />}
          </span>
          <span className="wa-chat-title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </span>
        </button>
        {chat.pinnedMessageId && <span className="pinned-chip"><Pin size={14} />{t("pinnedMessage")}</span>}
        {chat.type === "direct" && <button className="header-icon-button" onClick={() => onStartCall(chat)} title={t("videoCall")} aria-label={t("videoCall")}><Phone size={20} /></button>}
        <button className="header-icon-button" onClick={() => setInfoOpen((value) => !value)} title={t("moreOptions")} aria-label={t("moreOptions")}><MoreVertical size={20} /></button>
      </header>

      <div className="wa-chat-search">
        <Search size={16} />
        <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("localSearchPlaceholder")} />
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
        <input value={text} onChange={(event) => handleTextChange(event.target.value)} placeholder={t("messagePlaceholder")} />
        <button className="composer-send" title={t("send")} aria-label={t("send")}><Send size={19} /></button>
      </form>

      {infoOpen && (
        <aside className="chat-info-panel">
          <header>
            <Avatar name={title} type={chat.type} size="lg" mediaId={avatarMediaId} />
            <span><strong>{title}</strong><small>{chat.type === "group" ? t("groupInfo") : t("contactInfo")}</small></span>
            <button type="button" className="mobile-back-button" onClick={() => setInfoOpen(false)} aria-label={t("backToChats")}><ArrowLeft size={19} /></button>
          </header>
          {chat.type === "direct" && directPeer && (
            <div className="info-section">
              <h2>{t("contactInfo")}</h2>
              <p className="notice">{statusText(directPeer, t)}</p>
              <div className="profile-action-grid">
                <button type="button" className="secondary" onClick={() => setInfoOpen(false)}>{t("message")}</button>
                <button type="button" className="secondary" onClick={() => onStartCall(chat)}>{t("videoCall")}</button>
                <button type="button" className="secondary" onClick={() => { setInfoOpen(false); searchRef.current?.focus(); }}>{t("searchInConversation")}</button>
                <button type="button" className="secondary">{t("muteNotifications")}</button>
              </div>
              <form className="compact-form" onSubmit={saveNickname}>
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={t("nickname")} />
                <button className="secondary">{t("editNickname")}</button>
              </form>
              <p className="notice">{t("originalUsername")}: {directPeer.username}</p>
              <button type="button" className={directPeer.blockedByMe ? "secondary" : "danger"} onClick={toggleBlock}>
                {directPeer.blockedByMe ? t("unblockUser") : t("blockUser")}
              </button>
              <SharedContentTabs chat={chat} chatKey={chatKey} refreshKey={eventVersion} onImagePreview={(src, alt) => setPreview({ src, alt })} />
            </div>
          )}
          {chat.type === "group" && (
            <>
              <div className="info-section">
                <h2>{t("groupSettings")}</h2>
                <p className="notice">{t("groupStatusOnline", { count: chat.members?.length || 0, online: onlineMembers })}</p>
                <div className="profile-action-grid">
                  <button type="button" className="secondary" onClick={() => { setInfoOpen(false); searchRef.current?.focus(); }}>{t("searchInGroup")}</button>
                  <button type="button" className="secondary">{t("muteNotifications")}</button>
                </div>
                {canUsePermission(chat, user, "changeImage") && <button type="button" className="secondary" onClick={() => setCropperOpen(true)}><FilePlus size={17} />{t("changeGroupPhoto")}</button>}
                <button type="button" className="danger" onClick={leaveGroup}><LogOut size={17} />{t("leaveGroup")}</button>
              </div>
              <SharedContentTabs chat={chat} chatKey={chatKey} refreshKey={eventVersion} onImagePreview={(src, alt) => setPreview({ src, alt })} />
              {isAdmin && (
                <div className="info-section">
                  <h2>{t("groupPermissions")}</h2>
                  {["send", "editInfo", "addMembers", "changeImage", "startCalls"].map((key) => (
                    <label key={key}>
                      <span>{t(`permission_${key}`)}</span>
                      <select value={permissionDraft[key] || "admins"} onChange={(event) => setPermissionDraft({ ...permissionDraft, [key]: event.target.value })}>
                        <option value="everyone">{t("everyone")}</option>
                        <option value="admins">{t("adminsOnly")}</option>
                      </select>
                    </label>
                  ))}
                  <button type="button" className="primary" onClick={savePermissions}>{t("save")}</button>
                </div>
              )}
              {canUsePermission(chat, user, "addMembers") && (
                <form className="info-section compact-form" onSubmit={addMembers}>
                  <input value={newMembers} onChange={(event) => setNewMembers(event.target.value)} placeholder={t("groupMembers")} />
                  <button className="secondary"><UserPlus size={16} />{t("addMembers")}</button>
                </form>
              )}
              <div className="info-section">
                <h2>{t("members")}</h2>
                <div className="member-list">
                  {chat.members?.filter((item) => !item.deletedAt).map((item) => (
                    <div key={item.id} className="member-row">
                      <Avatar name={getMemberDisplayName(item)} mediaId={item.avatarMediaId} />
                      <span><strong>{getMemberDisplayName(item)}</strong><small>{item.role === "admin" ? t("adminRole") : item.username}</small></span>
                      {isAdmin && item.id !== user.id && (
                        <span className="row-actions">
                          <button type="button" onClick={() => item.role === "admin" ? demote(item.id) : promote(item.id)} title={item.role === "admin" ? t("removeAdmin") : t("promote")}><Crown size={15} /></button>
                          <button type="button" onClick={() => removeMember(item.id)} title={t("removeMember")}><UserMinus size={15} /></button>
                        </span>
                      )}
                      {item.id === chat.ownerId && <Shield size={15} className="owner-mark" />}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      )}
      <ImagePreviewModal src={preview?.src} alt={preview?.alt} onClose={() => setPreview(null)} />
      {cropperOpen && <PhotoCropper title={t("changeGroupPhoto")} onCancel={() => setCropperOpen(false)} onCropped={uploadGroupAvatar} />}
    </section>
  );
}
