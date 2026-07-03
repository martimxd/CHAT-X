import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import QRCode from "qrcode";
import {
  Check,
  FilePlus,
  Lock,
  MessageSquare,
  Shield,
  Trash2,
  UserPlus
} from "lucide-react";
import { I18nProvider, useI18n } from "./i18n/I18nProvider.jsx";
import { API_BASE_URL, api, getToken, setToken } from "./lib/api.js";
import {
  clearPrivateKey,
  decryptPrivateKeyBundle,
  encryptPrivateKeyJwk,
  generateChatKey,
  generateIdentityBundle,
  loadPrivateKey,
  unwrapChatKey,
  wrapChatKeyForUser
} from "./lib/crypto.js";
import { ChatLayout } from "./components/ChatLayout.jsx";
import { ChatWindow } from "./components/ChatWindow.jsx";
import { Avatar } from "./components/Avatar.jsx";
import { CallOverlay, startOutgoingCall } from "./components/CallOverlay.jsx";
import { PhotoCropper } from "./components/PhotoCropper.jsx";
import { QrScanner } from "./components/QrScanner.jsx";
import { ThemeToggle } from "./components/ThemeToggle.jsx";
import { ThemeProvider, useTheme } from "./theme/ThemeProvider.jsx";
import { formatDateTime } from "./lib/format.js";
import { getDirectPeer, getMemberDisplayName } from "./lib/chat.js";
import "./styles.css";

function errorKey(error) {
  return `error_${error?.code || "unknown"}`;
}

function AuthCard({ children }) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <ThemeToggle compact />
        {children}
      </section>
    </main>
  );
}

function LoginPage({ onLogin }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("password");
  const [username, setUsername] = useState("");
  const [password, setPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState(null);
  const [qrImage, setQrImage] = useState("");
  const [qrSeconds, setQrSeconds] = useState(0);

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

  const requestQr = useCallback(async () => {
    setError("");
    setQrImage("");
    try {
      const data = await api("/api/auth/qr/request", { method: "POST" });
      setQr(data);
      setQrSeconds(Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000)));
      setQrImage(await QRCode.toDataURL(data.token, { width: 220, margin: 1 }));
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }, [t]);

  useEffect(() => {
    if (mode !== "qr") return undefined;
    requestQr().catch(() => {});
    return undefined;
  }, [mode, requestQr]);

  useEffect(() => {
    if (!qr?.token || mode !== "qr") return undefined;
    const countdown = window.setInterval(() => {
      setQrSeconds(Math.max(0, Math.floor((new Date(qr.expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    const poll = window.setInterval(async () => {
      try {
        const data = await api(`/api/auth/qr/status/${encodeURIComponent(qr.token)}`);
        if (data.status === "approved" && data.token) {
          setToken(data.token);
          await onLogin(data.user, "", { needsUnlock: true });
        }
        if (data.status === "denied" || data.status === "expired" || data.status === "consumed") {
          setError(t(`qrStatus_${data.status}`));
          window.clearInterval(poll);
        }
      } catch (err) {
        setError(t(errorKey(err)));
      }
    }, 2500);
    return () => {
      window.clearInterval(countdown);
      window.clearInterval(poll);
    };
  }, [mode, onLogin, qr, t]);

  return (
    <AuthCard>
      <div className="brand-lock"><Lock size={28} /></div>
      <h1>{t("appName")}</h1>
      <p>{t("loginSubtitle")}</p>
      <div className="auth-tabs">
        <button type="button" className={mode === "password" ? "active" : ""} onClick={() => setMode("password")}>{t("passwordLogin")}</button>
        <button type="button" className={mode === "qr" ? "active" : ""} onClick={() => setMode("qr")}>{t("qrLogin")}</button>
      </div>
      {mode === "password" ? (
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
      ) : (
        <div className="qr-login-panel">
          {qrImage ? <img src={qrImage} alt={t("qrLogin")} /> : <div className="qr-placeholder">{t("loading")}</div>}
          <strong>{t("scanQrCode")}</strong>
          <span>{t("qrExpiresIn", { seconds: qrSeconds })}</span>
          <button type="button" className="secondary" onClick={requestQr}>{t("refreshQr")}</button>
          <p className="notice">{t("qrLoginUnlockNotice")}</p>
          {error && <div className="error">{error}</div>}
        </div>
      )}
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

function UnlockPage({ user, onUnlock, onLogout }) {
  const { t } = useI18n();
  const [password, setPasswordValue] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onUnlock(user, password);
    } catch {
      setError(t("unlockFailed"));
    }
  }

  return (
    <AuthCard>
      <div className="brand-lock"><Lock size={28} /></div>
      <h1>{t("unlockTitle")}</h1>
      <p>{t("unlockSubtitle")}</p>
      <form className="stack" onSubmit={submit}>
        <label>
          <span>{t("password")}</span>
          <input value={password} onChange={(event) => setPasswordValue(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary">{t("unlockAction")}</button>
        <button type="button" className="secondary" onClick={onLogout}>{t("logout")}</button>
      </form>
    </AuthCard>
  );
}

function Shell({ user, setUser, onLogout }) {
  const { t, setLanguage } = useI18n();
  const { setTheme } = useTheme();
  const [view, setView] = useState("chats");
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [chatKey, setChatKey] = useState(null);
  const [eventVersion, setEventVersion] = useState(0);
  const [socket, setSocket] = useState(null);
  const [call, setCall] = useState(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [presence, setPresence] = useState(new Map());
  const [typingByChat, setTypingByChat] = useState(new Map());
  const chatKeys = useRef(new Map());
  const typingTimers = useRef(new Map());

  const refreshChats = useCallback(async () => {
    setChatsLoading(true);
    try {
      const data = await api("/api/chats");
      setChats(data.chats);
    } finally {
      setChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshChats().catch(() => {});
  }, [refreshChats, eventVersion]);

  useEffect(() => {
    const nextSocket = io(API_BASE_URL || undefined, { auth: { token: getToken() } });
    setSocket(nextSocket);
    const onMessage = (payload) => {
      setEventVersion((value) => value + 1);
      if (document.hidden && user.notificationsEnabled && window.Notification?.permission === "granted") {
        const notification = new Notification(user.notificationPreviews ? t("newMessageWithPreview") : t("newMessage"), {
          body: user.notificationPreviews ? t("encryptedPreview") : t("notificationGenericBody")
        });
        notification.onclick = () => {
          window.focus();
          if (payload?.chatId) openChat(payload.chatId).catch(() => {});
        };
      }
    };
    nextSocket.on("message:new", onMessage);
    nextSocket.on("message:updated", () => setEventVersion((value) => value + 1));
    nextSocket.on("message:deleted", () => setEventVersion((value) => value + 1));
    nextSocket.on("chat:updated", ({ chatId } = {}) => {
      setEventVersion((value) => value + 1);
      if (chatId && selected?.id === chatId) openChat(chatId).catch(() => {});
    });
    nextSocket.on("chat:removed", ({ chatId }) => {
      setChats((items) => items.filter((chat) => chat.id !== chatId));
      if (selected?.id === chatId) {
        setSelected(null);
        setChatKey(null);
      }
    });
    nextSocket.on("presence:changed", ({ userId, online, lastSeenAt }) => {
      setPresence((current) => {
        const next = new Map(current);
        next.set(userId, { online: Boolean(online), lastSeenAt: lastSeenAt || null });
        return next;
      });
      setSelected((current) => current ? {
        ...current,
        members: current.members?.map((member) => member.id === userId ? { ...member, online: Boolean(online), lastSeenAt: lastSeenAt || member.lastSeenAt } : member)
      } : current);
    });
    nextSocket.on("typing", ({ chatId, userId, userName, isTyping }) => {
      const key = `${chatId}:${userId}`;
      window.clearTimeout(typingTimers.current.get(key));
      setTypingByChat((current) => {
        const next = new Map(current);
        const users = new Map(next.get(chatId) || []);
        if (isTyping) users.set(userId, { userId, userName });
        else users.delete(userId);
        if (users.size === 0) next.delete(chatId);
        else next.set(chatId, users);
        return next;
      });
      if (isTyping) {
        typingTimers.current.set(key, window.setTimeout(() => {
          setTypingByChat((current) => {
            const next = new Map(current);
            const users = new Map(next.get(chatId) || []);
            users.delete(userId);
            if (users.size === 0) next.delete(chatId);
            else next.set(chatId, users);
            return next;
          });
        }, 4500));
      }
    });
    nextSocket.on("call:incoming", (payload) => {
      setCall({
        status: "incoming",
        callId: payload.callId,
        chatId: payload.chatId,
        callerId: payload.callerId,
        peerId: payload.callerId,
        peerName: payload.callerName || t("directChat"),
        offer: payload.offer
      });
    });
    nextSocket.on("call:ringing", ({ callId, calleeId }) => {
      setCall((value) => value ? { ...value, callId, peerId: calleeId } : value);
    });
    nextSocket.on("call:error", ({ code }) => {
      setCall(null);
      window.alert(t(`error_${code || "unknown"}`));
    });
    return () => {
      nextSocket.close();
      setSocket(null);
    };
  }, [selected?.id, t, user.notificationPreviews, user.notificationsEnabled]);

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
    data.chat.members?.forEach((member) => {
      if (member.online || member.lastSeenAt) {
        setPresence((current) => {
          const next = new Map(current);
          next.set(member.id, { online: Boolean(member.online), lastSeenAt: member.lastSeenAt || null });
          return next;
        });
      }
    });
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
    setTheme(nextUser.theme || "system");
  }

  async function startCall(chat) {
    if (!socket) return;
    const peer = getDirectPeer(chat, user);
    if (!peer) return;
    try {
      await startOutgoingCall({ socket, chat, peer, setCall, t });
    } catch {
      window.alert(t("cameraMicrophoneDenied"));
    }
  }

  const chatOpen = view === "chats" && selected && chatKey;

  return (
    <ChatLayout
      user={user}
      view={view}
      setView={setView}
      chats={chats}
      selectedChatId={selected?.id}
      chatsLoading={chatsLoading}
      mobileChatOpen={Boolean(chatOpen)}
      onOpen={openChat}
      onCreateDirect={createDirect}
      onCreateGroup={createGroup}
      onLogout={onLogout}
      presence={presence}
      typingByChat={typingByChat}
    >
      {view === "chats" && (
        chatOpen
          ? (
            <ChatWindow
              chat={selected}
              chatKey={chatKey}
              user={user}
              eventVersion={eventVersion}
              onRefresh={() => openChat(selected.id)}
              onBack={() => { setSelected(null); setChatKey(null); }}
              onStartCall={startCall}
              socket={socket}
              typingUsers={typingByChat.get(selected.id)}
              presence={presence}
            />
          )
          : <EmptyState icon={<MessageSquare />} title={t("selectChat")} body={t("privacyModelBody")} />
      )}
      {view === "settings" && <SettingsPage user={user} setUser={updateUser} onLogout={onLogout} onOpenQrScanner={() => setQrScannerOpen(true)} />}
      {view === "admin" && user.isAdmin && <AdminConsole />}
      <CallOverlay socket={socket} call={call} setCall={setCall} />
      {qrScannerOpen && <QrScanner onClose={() => setQrScannerOpen(false)} />}
    </ChatLayout>
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

function SettingsPage({ user, setUser, onLogout, onOpenQrScanner }) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState({
    displayName: user.displayName,
    language,
    showReadReceipts: user.showReadReceipts,
    showOnlineStatus: user.showOnlineStatus,
    theme: user.theme || theme,
    notificationsEnabled: user.notificationsEnabled || false,
    notificationPreviews: user.notificationPreviews || false,
    onlineVisibility: user.onlineVisibility || "everyone",
    lastSeenVisibility: user.lastSeenVisibility || "everyone",
    showTypingStatus: user.showTypingStatus !== false,
    defaultDisappearingSeconds: user.defaultDisappearingSeconds || 0
  });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [deleteText, setDeleteText] = useState("");
  const [cropperOpen, setCropperOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadAccountLists = useCallback(async () => {
    const [blocks, sessionData] = await Promise.all([
      api("/api/users/me/blocks"),
      api("/api/users/me/sessions")
    ]);
    setBlockedUsers(blocks.users);
    setSessions(sessionData.sessions);
  }, []);

  useEffect(() => {
    loadAccountLists().catch(() => {});
  }, [loadAccountLists]);

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
      setTheme(data.user.theme || "system");
      setMessage(t("accountUpdated"));
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError("");
    try {
      const storedPrivateKey = sessionStorage.getItem("chatx_private_key_jwk");
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

  async function uploadAvatar(file) {
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", "avatar");
    form.set("encryptedBlob", "false");
    setUploadingAvatar(true);
    setError("");
    try {
      const data = await api("/api/media", { method: "POST", body: form });
      setUser({ ...user, avatarMediaId: data.media.id });
      setCropperOpen(false);
      setMessage(t("accountUpdated"));
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setUploadingAvatar(false);
    }
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

  async function requestNotifications() {
    if (!("Notification" in window)) {
      setError(t("notificationsUnsupported"));
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setError(t("notificationPermissionDenied"));
      return;
    }
    setProfile({ ...profile, notificationsEnabled: true });
    new Notification(t("testNotificationTitle"), { body: t("testNotificationBody") });
  }

  function testNotification() {
    if (window.Notification?.permission === "granted") {
      new Notification(t("testNotificationTitle"), { body: t("testNotificationBody") });
    } else {
      setError(t("notificationPermissionDenied"));
    }
  }

  async function unblock(userId) {
    await api(`/api/users/${userId}/block`, { method: "DELETE" });
    await loadAccountLists();
  }

  async function revokeSession(sessionId) {
    await api(`/api/users/me/sessions/${sessionId}`, { method: "DELETE" });
    await loadAccountLists();
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <h1>{t("settings")}</h1>
        <div className="settings-avatar-row">
          <Avatar name={user.displayName || user.username} mediaId={user.avatarMediaId} size="lg" />
          <button type="button" className="secondary" onClick={() => setCropperOpen(true)} disabled={uploadingAvatar}>
            <FilePlus size={18} />{uploadingAvatar ? t("loading") : t("changeProfilePhoto")}
          </button>
        </div>
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
          <label>
            <span>{t("theme")}</span>
            <select value={profile.theme} onChange={(event) => { setProfile({ ...profile, theme: event.target.value }); setTheme(event.target.value); }}>
              <option value="light">{t("lightMode")}</option>
              <option value="dark">{t("darkMode")}</option>
              <option value="system">{t("systemMode")}</option>
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={profile.showReadReceipts} onChange={(event) => setProfile({ ...profile, showReadReceipts: event.target.checked })} />{t("showReadReceipts")}</label>
          <label className="toggle"><input type="checkbox" checked={profile.showOnlineStatus} onChange={(event) => setProfile({ ...profile, showOnlineStatus: event.target.checked })} />{t("showOnlineStatus")}</label>
          <label>
            <span>{t("whoCanSeeOnline")}</span>
            <select value={profile.onlineVisibility} onChange={(event) => setProfile({ ...profile, onlineVisibility: event.target.value })}>
              <option value="everyone">{t("everyone")}</option>
              <option value="contacts">{t("contactsOnly")}</option>
              <option value="nobody">{t("nobody")}</option>
            </select>
          </label>
          <label>
            <span>{t("whoCanSeeLastSeen")}</span>
            <select value={profile.lastSeenVisibility} onChange={(event) => setProfile({ ...profile, lastSeenVisibility: event.target.value })}>
              <option value="everyone">{t("everyone")}</option>
              <option value="contacts">{t("contactsOnly")}</option>
              <option value="nobody">{t("nobody")}</option>
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={profile.showTypingStatus} onChange={(event) => setProfile({ ...profile, showTypingStatus: event.target.checked })} />{t("showTypingStatus")}</label>
          <label className="toggle"><input type="checkbox" checked={profile.notificationsEnabled} onChange={(event) => setProfile({ ...profile, notificationsEnabled: event.target.checked })} />{t("enableNotifications")}</label>
          <label className="toggle"><input type="checkbox" checked={profile.notificationPreviews} onChange={(event) => setProfile({ ...profile, notificationPreviews: event.target.checked })} />{t("showNotificationPreview")}</label>
          <label><span>{t("disappearingDefault")}</span><input type="number" min="0" value={profile.defaultDisappearingSeconds} onChange={(event) => setProfile({ ...profile, defaultDisappearingSeconds: event.target.value })} /></label>
          <button className="primary"><Check size={18} />{t("save")}</button>
        </form>
      </div>
      <div className="panel">
        <h2>{t("notifications")}</h2>
        <div className="button-row">
          <button type="button" className="secondary" onClick={requestNotifications}>{t("enableBrowserNotifications")}</button>
          <button type="button" className="secondary" onClick={testNotification}>{t("testNotification")}</button>
        </div>
        <p className="notice">{t("notificationStatus")}: {window.Notification?.permission || t("unsupported")}</p>
        <h2>{t("qrLogin")}</h2>
        <button type="button" className="secondary" onClick={onOpenQrScanner}>{t("scanQrCode")}</button>
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
      <div className="panel">
        <h2>{t("blockedUsers")}</h2>
        <div className="table-list compact">
          {blockedUsers.length === 0 && <p className="empty-list-copy">{t("noBlockedUsers")}</p>}
          {blockedUsers.map((item) => (
            <div key={item.id} className="table-row">
              <span><strong>{getMemberDisplayName(item)}</strong><small>{item.username}</small></span>
              <button type="button" className="secondary small" onClick={() => unblock(item.id)}>{t("unblockUser")}</button>
            </div>
          ))}
        </div>
        <h2>{t("activeSessions")}</h2>
        <div className="table-list compact">
          {sessions.map((session) => (
            <div key={session.id} className="table-row">
              <span><strong>{session.deviceName || t("unknownDevice")}</strong><small>{formatDateTime(session.lastSeenAt)}</small></span>
              {session.current ? <em>{t("currentSession")}</em> : <button type="button" className="secondary small" onClick={() => revokeSession(session.id)}>{t("revoke")}</button>}
            </div>
          ))}
        </div>
      </div>
      {cropperOpen && <PhotoCropper title={t("cropPhoto")} onCancel={() => setCropperOpen(false)} onCropped={uploadAvatar} />}
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
  const [newInvite, setNewInvite] = useState({ expiresIn: "5h", maxUses: 1 });
  const [createdInvite, setCreatedInvite] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [error, setError] = useState("");
  const inviteExpirations = {
    "5h": { label: t("fiveHours"), ms: 5 * 60 * 60 * 1000 },
    "1d": { label: t("oneDay"), ms: 24 * 60 * 60 * 1000 },
    "1w": { label: t("oneWeek"), ms: 7 * 24 * 60 * 60 * 1000 },
    "1m": { label: t("oneMonth"), ms: 30 * 24 * 60 * 60 * 1000 }
  };

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
      const expiresAt = new Date(Date.now() + inviteExpirations[newInvite.expiresIn].ms).toISOString();
      const data = await api("/api/admin/invites", {
        method: "POST",
        body: { expiresAt, maxUses: Number(newInvite.maxUses) }
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

  async function copyInvite(url) {
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(url);
      setCopyMessage(t("inviteLinkCopied"));
    } catch {
      setCopyMessage(t("clipboardFailed"));
    }
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
            <label>
              <span>{t("expiresAt")}</span>
              <select value={newInvite.expiresIn} onChange={(event) => setNewInvite({ ...newInvite, expiresIn: event.target.value })}>
                {Object.entries(inviteExpirations).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
              </select>
            </label>
            <label><span>{t("maxUses")}</span><input type="number" min="1" value={newInvite.maxUses} onChange={(event) => setNewInvite({ ...newInvite, maxUses: event.target.value })} /></label>
            <button className="primary">{t("createInvite")}</button>
          </form>
          {createdInvite && <div className="success invite-result"><span>{t("inviteLink")}: {createdInvite}</span><button className="secondary small" onClick={() => copyInvite(createdInvite)}>{t("copyLink")}</button></div>}
          {copyMessage && <div className="success">{copyMessage}</div>}
          <h2>{t("invites")}</h2>
          <div className="table-list">
            {invites.map((invite) => (
              <div key={invite.id} className="table-row">
                <span><strong>{invite.tokenPrefix}</strong><small>{formatDateTime(invite.expiresAt)} · {Math.max(0, invite.maxUses - invite.useCount)} {t("remainingUses")}</small></span>
                <span className="row-actions">
                  <em>{invite.revokedAt ? t("revoked") : invite.active ? t("active") : t("expired")}</em>
                  {invite.url && <button onClick={() => copyInvite(invite.url)}>{t("copyLink")}</button>}
                  {!invite.revokedAt && <button onClick={() => revokeInvite(invite)}>{t("revoke")}</button>}
                </span>
              </div>
            ))}
          </div>
          <h2>{t("auditLogs")}</h2>
          <div className="table-list compact">
            {logs.map((log) => (
              <div key={log.id} className="table-row">
                <span><strong>{log.action}</strong><small>{formatDateTime(log.created_at)}</small></span>
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
  const { setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const inviteToken = window.location.pathname.startsWith("/invite/")
    ? window.location.pathname.split("/invite/")[1]
    : null;

  const setupKeys = useCallback(async (nextUser, password) => {
    if (nextUser.mustChangeCredentials) {
      setUser(nextUser);
      setLanguage(nextUser.language);
      setTheme(nextUser.theme || "system");
      return;
    }
    if (nextUser.encryptedPrivateKeyJwk) {
      await decryptPrivateKeyBundle(nextUser.encryptedPrivateKeyJwk, password);
      setUser(nextUser);
      setLanguage(nextUser.language);
      setTheme(nextUser.theme || "system");
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
    setTheme(updated.user.theme || "system");
  }, [setLanguage, setTheme]);

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
        setTheme(data.user.theme || "system");
      })
      .catch(() => {
        setToken(null);
        clearPrivateKey();
      })
      .finally(() => setReady(true));
  }, [setLanguage, setTheme]);

  async function handleLogin(nextUser, password, options = {}) {
    try {
      setUnlockError("");
      if (options.needsUnlock) {
        setUser(nextUser);
        setLanguage(nextUser.language);
        setTheme(nextUser.theme || "system");
        setNeedsUnlock(true);
        return;
      }
      await setupKeys(nextUser, password);
      setNeedsUnlock(false);
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
    setNeedsUnlock(false);
  }

  if (!ready) return <AuthCard><p>{t("loading")}</p></AuthCard>;
  if (inviteToken && !user) return <InviteRegistrationPage token={inviteToken} onLogin={handleLogin} />;
  if (!user) return <LoginPage onLogin={handleLogin} />;
  if (needsUnlock) return <UnlockPage user={user} onUnlock={async (nextUser, password) => { await setupKeys(nextUser, password); setNeedsUnlock(false); }} onLogout={logout} />;
  if (unlockError) return <AuthCard><div className="error">{unlockError}</div><button className="primary" onClick={logout}>{t("retry")}</button></AuthCard>;
  if (user.mustChangeCredentials) return <ForcedChangePage user={user} onChanged={setUser} />;
  return <Shell user={user} setUser={setUser} onLogout={logout} />;
}

export function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
