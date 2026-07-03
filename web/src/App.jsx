import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  Ban,
  Check,
  Download,
  Edit3,
  FilePlus,
  Lock,
  LogOut,
  MessageSquare,
  Paperclip,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users
} from "lucide-react";
import { I18nProvider, useI18n } from "./i18n/I18nProvider.jsx";
import { API_BASE_URL, api, apiUrl, getToken, setToken } from "./lib/api.js";
import {
  clearPrivateKey,
  decryptFileFromChat,
  decryptPayload,
  decryptPrivateKeyBundle,
  encryptFileForChat,
  encryptPayload,
  encryptPrivateKeyJwk,
  generateChatKey,
  generateIdentityBundle,
  loadPrivateKey,
  unwrapChatKey,
  wrapChatKeyForUser
} from "./lib/crypto.js";
import "./styles.css";

function errorKey(error) {
  return `error_${error?.code || "unknown"}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function classifyMessageType(file) {
  if (!file) return "text";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function AuthCard({ children }) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">{children}</section>
    </main>
  );
}

function LoginPage({ onLogin }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth/login", { method: "POST", body: { username, password } });
      setToken(data.token);
      await onLogin(data.user, password);
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard>
      <div className="brand-lock"><Lock size={28} /></div>
      <h1>{t("loginTitle")}</h1>
      <p>{t("loginSubtitle")}</p>
      <form onSubmit={submit} className="stack">
        <label>
          <span>{t("username")}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          <span>{t("password")}</span>
          <input value={password} onChange={(event) => setPasswordValue(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? t("loading") : t("loginAction")}</button>
      </form>
      <p className="notice">{t("defaultAdminNotice")}</p>
    </AuthCard>
  );
}

function ForcedChangePage({ user, onChanged }) {
  const { t } = useI18n();
  const [username, setUsername] = useState(user.username === "admin" ? "" : user.username);
  const [password, setPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const changed = await api("/api/auth/forced-change", {
        method: "POST",
        body: { username, password }
      });
      const bundle = await generateIdentityBundle(password);
      const updated = await api("/api/auth/key-bundle", {
        method: "PUT",
        body: {
          publicKeyJwk: bundle.publicKeyJwk,
          encryptedPrivateKeyJwk: bundle.encryptedPrivateKeyJwk
        }
      });
      onChanged({ ...changed.user, ...updated.user });
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard>
      <div className="brand-lock"><Shield size={28} /></div>
      <h1>{t("forcedTitle")}</h1>
      <p>{t("forcedSubtitle")}</p>
      <form onSubmit={submit} className="stack">
        <label>
          <span>{t("username")}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          <span>{t("newPassword")}</span>
          <input value={password} onChange={(event) => setPasswordValue(event.target.value)} type="password" autoComplete="new-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? t("loading") : t("forcedAction")}</button>
      </form>
    </AuthCard>
  );
}

function InviteRegistrationPage({ token, onLogin }) {
  const { t } = useI18n();
  const [invite, setInvite] = useState(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPasswordValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api(`/api/invites/${token}`)
      .then((data) => { if (active) setInvite(data); })
      .catch(() => { if (active) setInvite({ active: false }); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const bundle = await generateIdentityBundle(password);
      await api("/api/register", {
        method: "POST",
        body: {
          token,
          username,
          password,
          displayName,
          publicKeyJwk: bundle.publicKeyJwk,
          encryptedPrivateKeyJwk: bundle.encryptedPrivateKeyJwk
        }
      });
      const login = await api("/api/auth/login", { method: "POST", body: { username, password } });
      setToken(login.token);
      await onLogin(login.user, password);
      window.history.replaceState({}, "", "/");
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard>
      <div className="brand-lock"><UserPlus size={28} /></div>
      <h1>{t("inviteTitle")}</h1>
      <p>{checking ? t("inviteChecking") : t("inviteSubtitle")}</p>
      {!checking && !invite?.active && <div className="error">{t("inviteInvalid")}</div>}
      {invite?.active && <p className="notice">{t("inviteRemaining", { count: invite.remainingUses })}</p>}
      {invite?.active && (
        <form onSubmit={submit} className="stack">
          <label>
            <span>{t("username")}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            <span>{t("displayName")}</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
          </label>
          <label>
            <span>{t("password")}</span>
            <input value={password} onChange={(event) => setPasswordValue(event.target.value)} type="password" autoComplete="new-password" />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? t("keySetup") : t("inviteAction")}</button>
        </form>
      )}
    </AuthCard>
  );
}

function Shell({ user, setUser, onLogout }) {
  const { t, setLanguage } = useI18n();
  const [view, setView] = useState("chats");
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [chatKey, setChatKey] = useState(null);
  const [eventVersion, setEventVersion] = useState(0);
  const chatKeys = useRef(new Map());

  const refreshChats = useCallback(async () => {
    const data = await api("/api/chats");
    setChats(data.chats);
  }, []);

  useEffect(() => {
    refreshChats().catch(() => {});
  }, [refreshChats, eventVersion]);

  useEffect(() => {
    const socket = io(API_BASE_URL || undefined, { auth: { token: getToken() } });
    socket.on("message:new", () => setEventVersion((value) => value + 1));
    socket.on("message:updated", () => setEventVersion((value) => value + 1));
    socket.on("message:deleted", () => setEventVersion((value) => value + 1));
    socket.on("chat:updated", () => setEventVersion((value) => value + 1));
    socket.on("typing", () => setEventVersion((value) => value + 1));
    return () => socket.close();
  }, []);

  async function ensureChatKey(chat) {
    if (chatKeys.current.has(chat.id)) return chatKeys.current.get(chat.id);
    const privateKey = await loadPrivateKey();
    if (!privateKey) throw new Error("missing_private_key");
    if (chat.encryptedKey) {
      const key = await unwrapChatKey(chat.encryptedKey, privateKey);
      chatKeys.current.set(chat.id, key);
      return key;
    }
    const key = await generateChatKey();
    const wrappedKeys = await Promise.all(
      chat.members
        .filter((member) => member.publicKeyJwk)
        .map(async (member) => ({
          userId: member.id,
          encryptedKey: await wrapChatKeyForUser(key, member.publicKeyJwk)
        }))
    );
    await api(`/api/chats/${chat.id}/keys`, { method: "POST", body: { keys: wrappedKeys } });
    chatKeys.current.set(chat.id, key);
    return key;
  }

  async function openChat(chatId) {
    const data = await api(`/api/chats/${chatId}`);
    const key = await ensureChatKey(data.chat);
    setSelected(data.chat);
    setChatKey(key);
    setView("chats");
  }

  async function createDirect(username) {
    const data = await api("/api/chats/direct", { method: "POST", body: { username } });
    await refreshChats();
    const key = await ensureChatKey(data.chat);
    setSelected(data.chat);
    setChatKey(key);
  }

  async function createGroup(name, usernames) {
    const data = await api("/api/chats/groups", {
      method: "POST",
      body: { name, usernames: usernames.split(",").map((value) => value.trim()).filter(Boolean) }
    });
    await refreshChats();
    const key = await ensureChatKey(data.chat);
    setSelected(data.chat);
    setChatKey(key);
  }

  function updateUser(nextUser) {
    setUser(nextUser);
    setLanguage(nextUser.language);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <strong>{t("appName")}</strong>
            <span>{user.displayName}</span>
          </div>
        </div>
        <nav className="nav-buttons">
          <button className={view === "chats" ? "active" : ""} onClick={() => setView("chats")}><MessageSquare size={18} />{t("chatListTitle")}</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}><Settings size={18} />{t("settings")}</button>
          {user.isAdmin && <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}><Shield size={18} />{t("adminConsole")}</button>}
          <button onClick={onLogout}><LogOut size={18} />{t("logout")}</button>
        </nav>
        <ChatList chats={chats} onOpen={openChat} onCreateDirect={createDirect} onCreateGroup={createGroup} />
      </aside>
      <main className="workspace">
        {view === "chats" && (
          selected && chatKey
            ? <ChatWindow chat={selected} chatKey={chatKey} user={user} eventVersion={eventVersion} onRefresh={() => openChat(selected.id)} />
            : <EmptyState icon={<MessageSquare />} title={t("selectChat")} body={t("privacyModelBody")} />
        )}
        {view === "settings" && <SettingsPage user={user} setUser={updateUser} onLogout={onLogout} />}
        {view === "admin" && user.isAdmin && <AdminConsole />}
      </main>
    </div>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function ChatList({ chats, onOpen, onCreateDirect, onCreateGroup }) {
  const { t } = useI18n();
  const [direct, setDirect] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState("");
  const [error, setError] = useState("");

  async function submitDirect(event) {
    event.preventDefault();
    setError("");
    try {
      await onCreateDirect(direct);
      setDirect("");
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function submitGroup(event) {
    event.preventDefault();
    setError("");
    try {
      await onCreateGroup(groupName, members);
      setGroupName("");
      setMembers("");
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  return (
    <section className="chat-list">
      <h2>{t("chatListTitle")}</h2>
      <form onSubmit={submitDirect} className="compact-form">
        <input value={direct} onChange={(event) => setDirect(event.target.value)} placeholder={t("directPlaceholder")} />
        <button title={t("newDirect")} aria-label={t("newDirect")}><Plus size={18} /></button>
      </form>
      <form onSubmit={submitGroup} className="group-form">
        <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("groupName")} />
        <input value={members} onChange={(event) => setMembers(event.target.value)} placeholder={t("groupMembers")} />
        <button><Users size={18} />{t("createGroup")}</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="chat-items">
        {chats.length === 0 && <p className="muted">{t("noChats")}</p>}
        {chats.map((chat) => (
          <button key={chat.id} className="chat-item" onClick={() => onOpen(chat.id)}>
            <span className="avatar">{chat.type === "group" ? <Users size={18} /> : <MessageSquare size={18} />}</span>
            <span>
              <strong>{chat.name || (chat.type === "group" ? t("groupChat") : t("directChat"))}</strong>
              <small>{chat.latestMessage ? t("encryptedPreview") : t("noMessages")}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChatWindow({ chat, chatKey, user, eventVersion, onRefresh }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState([]);
  const [decrypted, setDecrypted] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [search, setSearch] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api(`/api/chats/${chat.id}/messages`)
      .then((data) => { if (active) setMessages(data.messages); })
      .catch(() => {});
    return () => { active = false; };
  }, [chat.id, eventVersion]);

  useEffect(() => {
    let active = true;
    Promise.all(messages.map(async (message) => {
      if (message.deletedForEveryoneAt || !message.encryptedPayload) return { message, body: null };
      try {
        return { message, body: await decryptPayload(chatKey, message.encryptedPayload) };
      } catch {
        return { message, body: { text: t("decryptFailed") } };
      }
    })).then((items) => { if (active) setDecrypted(items); });
    return () => { active = false; };
  }, [messages, chatKey, t]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return decrypted;
    return decrypted.filter((item) => (item.body?.text || "").toLowerCase().includes(term));
  }, [decrypted, search]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      if (editing) {
        const envelope = await encryptPayload(chatKey, { text, editedAt: new Date().toISOString() });
        await api(`/api/chats/${chat.id}/messages/${editing.id}`, { method: "PATCH", body: { encryptedPayload: envelope } });
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
      setError(t(errorKey(err)));
    }
  }

  async function removeMessage(message, scope) {
    await api(`/api/chats/${chat.id}/messages/${message.id}`, { method: "DELETE", body: { scope } });
    await onRefresh();
  }

  async function downloadMedia(body) {
    const link = await api(`/api/media/${body.media.id}/link`);
    const response = await fetch(apiUrl(link.url), {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const encryptedBlob = await response.blob();
    const plaintext = await decryptFileFromChat(chatKey, encryptedBlob, body.media);
    const url = URL.createObjectURL(plaintext);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = body.media.storedName || body.media.originalName || "media";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const title = chat.name || chat.members?.filter((member) => member.id !== user.id).map((member) => member.displayName).join(", ");

  return (
    <section className="chat-window">
      <header className="chat-header">
        <div>
          <h1>{title || t("chatListTitle")}</h1>
          <p>{chat.type === "group" ? t("groupChats") : t("privacyModelTitle")}</p>
        </div>
        {chat.pinnedMessageId && <span className="pill"><Pin size={14} />{t("pinnedMessage")}</span>}
      </header>
      <div className="chat-tools">
        <div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("localSearchPlaceholder")} /></div>
      </div>
      <div className="messages">
        {filtered.length === 0 && <p className="muted center">{t("noMessages")}</p>}
        {filtered.map(({ message, body }) => (
          <article key={message.id} className={`message ${message.senderId === user.id ? "own" : ""}`}>
            <div className="message-meta">
              <strong>{message.senderDisplayName || message.senderUsername || t("deletedMessage")}</strong>
              <span>{formatDate(message.createdAt)}</span>
              {message.editedAt && <span>{t("editedLabel")}</span>}
            </div>
            <p>{message.deletedForEveryoneAt ? t("deletedMessage") : body?.text || t("encryptedPreview")}</p>
            {body?.media && <button className="secondary small" onClick={() => downloadMedia(body)}><Download size={15} />{t("downloadMedia")}</button>}
            <div className="message-actions">
              <button title={t("reply")} aria-label={t("reply")} onClick={() => setReplyTo({ message, body })}><Reply size={15} /></button>
              {message.senderId === user.id && <button title={t("edit")} aria-label={t("edit")} onClick={() => { setEditing(message); setText(body?.text || ""); }}><Edit3 size={15} /></button>}
              <button title={t("deleteForMe")} aria-label={t("deleteForMe")} onClick={() => removeMessage(message, "me")}><Trash2 size={15} /></button>
              {message.senderId === user.id && <button title={t("deleteForEveryone")} aria-label={t("deleteForEveryone")} onClick={() => removeMessage(message, "everyone")}><Ban size={15} /></button>}
            </div>
          </article>
        ))}
      </div>
      <form className="composer" onSubmit={submit}>
        {replyTo && <div className="compose-context">{t("replyTo")}: {replyTo.body?.text || t("encryptedPreview")} <button type="button" onClick={() => setReplyTo(null)}>{t("cancel")}</button></div>}
        {file && <div className="compose-context">{t("mediaReady")}: {file.name} <button type="button" onClick={() => setFile(null)}>{t("cancel")}</button></div>}
        {error && <div className="error">{error}</div>}
        <label className="icon-upload" title={t("attachFile")} aria-label={t("attachFile")}>
          <Paperclip size={20} />
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={t("messagePlaceholder")} />
        <button className="primary" title={t("send")} aria-label={t("send")}><Send size={18} /></button>
      </form>
    </section>
  );
}

function SettingsPage({ user, setUser, onLogout }) {
  const { t, language, setLanguage } = useI18n();
  const [profile, setProfile] = useState({
    displayName: user.displayName,
    language,
    showReadReceipts: user.showReadReceipts,
    showOnlineStatus: user.showOnlineStatus,
    defaultDisappearingSeconds: user.defaultDisappearingSeconds || 0
  });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [deleteText, setDeleteText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/users/me", {
        method: "PATCH",
        body: {
          ...profile,
          defaultDisappearingSeconds: Number(profile.defaultDisappearingSeconds) || null
        }
      });
      setUser(data.user);
      setLanguage(data.user.language);
      setMessage(t("accountUpdated"));
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError("");
    try {
      const storedPrivateKey = sessionStorage.getItem("shsm_private_key_jwk");
      const encryptedPrivateKeyJwk = storedPrivateKey
        ? await encryptPrivateKeyJwk(JSON.parse(storedPrivateKey), passwords.newPassword)
        : undefined;
      const data = await api("/api/users/me/password", {
        method: "POST",
        body: { ...passwords, encryptedPrivateKeyJwk }
      });
      setUser(data.user);
      setPasswords({ currentPassword: "", newPassword: "" });
      setMessage(t("passwordUpdated"));
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", "avatar");
    form.set("encryptedBlob", "false");
    const data = await api("/api/media", { method: "POST", body: form });
    setUser({ ...user, avatarMediaId: data.media.id });
    setMessage(t("accountUpdated"));
  }

  async function deleteAccount(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/users/me", { method: "DELETE", body: { confirmation: deleteText } });
      onLogout();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <h1>{t("settings")}</h1>
        <form className="stack" onSubmit={saveProfile}>
          <label><span>{t("displayName")}</span><input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
          <label>
            <span>{t("language")}</span>
            <select value={profile.language} onChange={(event) => setProfile({ ...profile, language: event.target.value })}>
              <option value="en">{t("english")}</option>
              <option value="pt">{t("portuguese")}</option>
              <option value="fr">{t("french")}</option>
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={profile.showReadReceipts} onChange={(event) => setProfile({ ...profile, showReadReceipts: event.target.checked })} />{t("showReadReceipts")}</label>
          <label className="toggle"><input type="checkbox" checked={profile.showOnlineStatus} onChange={(event) => setProfile({ ...profile, showOnlineStatus: event.target.checked })} />{t("showOnlineStatus")}</label>
          <label><span>{t("disappearingDefault")}</span><input type="number" min="0" value={profile.defaultDisappearingSeconds} onChange={(event) => setProfile({ ...profile, defaultDisappearingSeconds: event.target.value })} /></label>
          <button className="primary"><Check size={18} />{t("save")}</button>
        </form>
      </div>
      <div className="panel">
        <h2>{t("avatar")}</h2>
        <label className="file-button"><FilePlus size={18} />{t("uploadAvatar")}<input type="file" accept="image/*" onChange={uploadAvatar} /></label>
        <h2>{t("changePassword")}</h2>
        <form className="stack" onSubmit={changePassword}>
          <label><span>{t("currentPassword")}</span><input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label><span>{t("newPassword")}</span><input type="password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label>
          <button className="secondary">{t("changePassword")}</button>
        </form>
        <h2>{t("deleteAccount")}</h2>
        <p className="notice">{t("deleteAccountWarning")}</p>
        <form className="compact-form" onSubmit={deleteAccount}>
          <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder={t("deleteConfirmation")} />
          <button className="danger"><Trash2 size={16} />{t("delete")}</button>
        </form>
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </section>
  );
}

function AdminConsole() {
  const { t } = useI18n();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [logs, setLogs] = useState([]);
  const [newUser, setNewUser] = useState({ username: "", password: "", displayName: "", isAdmin: false });
  const [newInvite, setNewInvite] = useState({ expiresAt: "", maxUses: 1 });
  const [createdInvite, setCreatedInvite] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [statsData, usersData, invitesData, logsData] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
      api("/api/admin/invites"),
      api("/api/admin/audit-logs")
    ]);
    setStats(statsData);
    setUsers(usersData.users);
    setInvites(invitesData.invites);
    setLogs(logsData.logs);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function createUser(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/admin/users", { method: "POST", body: newUser });
      setNewUser({ username: "", password: "", displayName: "", isAdmin: false });
      await load();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function updateUser(user, patch) {
    setError("");
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: patch });
      await load();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function createInvite(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/admin/invites", {
        method: "POST",
        body: { expiresAt: new Date(newInvite.expiresAt).toISOString(), maxUses: Number(newInvite.maxUses) }
      });
      setCreatedInvite(data.invite.url);
      await load();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function revokeInvite(invite) {
    await api(`/api/admin/invites/${invite.id}/revoke`, { method: "POST" });
    await load();
  }

  return (
    <section className="admin-page">
      <h1>{t("adminConsole")}</h1>
      {error && <div className="error">{error}</div>}
      <div className="stats-grid">
        <Stat label={t("totalUsers")} value={stats?.users?.total} />
        <Stat label={t("bannedUsers")} value={stats?.users?.banned} />
        <Stat label={t("disabledUsers")} value={stats?.users?.disabled} />
        <Stat label={t("totalChats")} value={stats?.chats?.total} />
        <Stat label={t("groupChats")} value={stats?.chats?.groups} />
        <Stat label={t("totalMessages")} value={stats?.messages?.total} />
      </div>
      <div className="page-grid">
        <div className="panel">
          <h2>{t("createUser")}</h2>
          <form className="stack" onSubmit={createUser}>
            <input value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} placeholder={t("username")} />
            <input value={newUser.displayName} onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} placeholder={t("displayName")} />
            <input value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} type="password" placeholder={t("password")} />
            <label className="toggle"><input type="checkbox" checked={newUser.isAdmin} onChange={(event) => setNewUser({ ...newUser, isAdmin: event.target.checked })} />{t("adminRole")}</label>
            <button className="primary"><UserPlus size={18} />{t("createUser")}</button>
          </form>
          <h2>{t("users")}</h2>
          <div className="table-list">
            {users.map((item) => (
              <div key={item.id} className="table-row">
                <span><strong>{item.username}</strong><small>{item.displayName}</small></span>
                {item.isFirstAdmin ? <em>{t("protectedAdmin")}</em> : (
                  <span className="row-actions">
                    <button onClick={() => updateUser(item, { isAdmin: !item.isAdmin })}>{item.isAdmin ? t("demote") : t("promote")}</button>
                    <button onClick={() => updateUser(item, { isBanned: !item.isBanned })}>{item.isBanned ? t("unban") : t("ban")}</button>
                    <button onClick={() => updateUser(item, { isDisabled: !item.isDisabled })}>{item.isDisabled ? t("enable") : t("disable")}</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h2>{t("createInvite")}</h2>
          <form className="stack" onSubmit={createInvite}>
            <label><span>{t("expiresAt")}</span><input type="datetime-local" value={newInvite.expiresAt} onChange={(event) => setNewInvite({ ...newInvite, expiresAt: event.target.value })} /></label>
            <label><span>{t("maxUses")}</span><input type="number" min="1" value={newInvite.maxUses} onChange={(event) => setNewInvite({ ...newInvite, maxUses: event.target.value })} /></label>
            <button className="primary">{t("createInvite")}</button>
          </form>
          {createdInvite && <div className="success">{t("inviteLink")}: {createdInvite}</div>}
          <h2>{t("invites")}</h2>
          <div className="table-list">
            {invites.map((invite) => (
              <div key={invite.id} className="table-row">
                <span><strong>{invite.tokenPrefix}</strong><small>{formatDate(invite.expiresAt)} · {invite.useCount}/{invite.maxUses}</small></span>
                <span className="row-actions">
                  <em>{invite.revokedAt ? t("revoked") : invite.active ? t("active") : t("expired")}</em>
                  {!invite.revokedAt && <button onClick={() => revokeInvite(invite)}>{t("revoke")}</button>}
                </span>
              </div>
            ))}
          </div>
          <h2>{t("auditLogs")}</h2>
          <div className="table-list compact">
            {logs.map((log) => (
              <div key={log.id} className="table-row">
                <span><strong>{log.action}</strong><small>{formatDate(log.created_at)}</small></span>
                <em>{log.actor_username || t("deletedMessage")}</em>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <strong>{value ?? "0"}</strong>
      <span>{label}</span>
    </div>
  );
}

function AppContent() {
  const { t, setLanguage } = useI18n();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [unlockError, setUnlockError] = useState("");
  const inviteToken = window.location.pathname.startsWith("/invite/")
    ? window.location.pathname.split("/invite/")[1]
    : null;

  const setupKeys = useCallback(async (nextUser, password) => {
    if (nextUser.mustChangeCredentials) {
      setUser(nextUser);
      setLanguage(nextUser.language);
      return;
    }
    if (nextUser.encryptedPrivateKeyJwk) {
      await decryptPrivateKeyBundle(nextUser.encryptedPrivateKeyJwk, password);
      setUser(nextUser);
      setLanguage(nextUser.language);
      return;
    }
    const bundle = await generateIdentityBundle(password);
    const updated = await api("/api/auth/key-bundle", {
      method: "PUT",
      body: {
        publicKeyJwk: bundle.publicKeyJwk,
        encryptedPrivateKeyJwk: bundle.encryptedPrivateKeyJwk
      }
    });
    setUser(updated.user);
    setLanguage(updated.user.language);
  }, [setLanguage]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api("/api/auth/me")
      .then(async (data) => {
        const privateKey = await loadPrivateKey();
        if (!privateKey && data.user.encryptedPrivateKeyJwk && !data.user.mustChangeCredentials) {
          setToken(null);
          clearPrivateKey();
          return;
        }
        setUser(data.user);
        setLanguage(data.user.language);
      })
      .catch(() => {
        setToken(null);
        clearPrivateKey();
      })
      .finally(() => setReady(true));
  }, [setLanguage]);

  async function handleLogin(nextUser, password) {
    try {
      setUnlockError("");
      await setupKeys(nextUser, password);
    } catch {
      setUnlockError(t("unlockFailed"));
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Session may already be gone; local logout still needs to complete.
    }
    setToken(null);
    clearPrivateKey();
    setUser(null);
  }

  if (!ready) return <AuthCard><p>{t("loading")}</p></AuthCard>;
  if (inviteToken && !user) return <InviteRegistrationPage token={inviteToken} onLogin={handleLogin} />;
  if (!user) return <LoginPage onLogin={handleLogin} />;
  if (unlockError) return <AuthCard><div className="error">{unlockError}</div><button className="primary" onClick={logout}>{t("retry")}</button></AuthCard>;
  if (user.mustChangeCredentials) return <ForcedChangePage user={user} onChanged={setUser} />;
  return <Shell user={user} setUser={setUser} onLogout={logout} />;
}

export function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
