import React, { useMemo, useState } from "react";
import { LogOut, MessageSquarePlus, Search, Settings, Shield, UserPlus, Users } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Avatar } from "./Avatar.jsx";
import { ChatListItem } from "./ChatListItem.jsx";

export function ChatSidebar({
  user,
  view,
  setView,
  chats,
  selectedChatId,
  loading,
  onOpen,
  onCreateDirect,
  onCreateGroup,
  onLogout,
  presence,
  typingByChat
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [direct, setDirect] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState("");
  const [error, setError] = useState("");

  const filteredChats = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return chats;
    return chats.filter((chat) => (chat.name || chat.type).toLowerCase().includes(term));
  }, [chats, search]);

  async function submitDirect(event) {
    event.preventDefault();
    setError("");
    try {
      await onCreateDirect(direct);
      setDirect("");
    } catch (err) {
      setError(t(`error_${err?.code || "unknown"}`));
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
      setError(t(`error_${err?.code || "unknown"}`));
    }
  }

  return (
    <aside className="wa-sidebar">
      <header className="wa-sidebar-topbar">
        <Avatar name={user.displayName || user.username} size="lg" />
        <div className="wa-profile-copy">
          <strong>{user.displayName}</strong>
          <span>{user.username}</span>
        </div>
        <nav className="wa-top-actions">
          <button className={view === "chats" ? "active" : ""} onClick={() => setView("chats")} title={t("chatListTitle")} aria-label={t("chatListTitle")}><MessageSquarePlus size={20} /></button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")} title={t("settings")} aria-label={t("settings")}><Settings size={20} /></button>
          {user.isAdmin && <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")} title={t("adminConsole")} aria-label={t("adminConsole")}><Shield size={20} /></button>}
          <button onClick={onLogout} title={t("logout")} aria-label={t("logout")}><LogOut size={20} /></button>
        </nav>
      </header>

      <div className="wa-sidebar-search">
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchChats")} />
      </div>

      <section className="wa-create-panel">
        <form onSubmit={submitDirect} className="wa-create-row">
          <input value={direct} onChange={(event) => setDirect(event.target.value)} placeholder={t("directPlaceholder")} />
          <button title={t("newDirect")} aria-label={t("newDirect")}><UserPlus size={18} /></button>
        </form>
        <form onSubmit={submitGroup} className="wa-create-group">
          <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("groupName")} />
          <input value={members} onChange={(event) => setMembers(event.target.value)} placeholder={t("groupMembers")} />
          <button><Users size={18} />{t("createGroup")}</button>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </section>

      <section className="wa-chat-list" aria-label={t("chatListTitle")}>
        {loading && [0, 1, 2, 3].map((item) => <div key={item} className="chat-skeleton" />)}
        {!loading && filteredChats.length === 0 && <p className="empty-list-copy">{t("noChats")}</p>}
        {!loading && filteredChats.map((chat) => (
          <ChatListItem key={chat.id} chat={chat} selected={chat.id === selectedChatId} onOpen={onOpen} currentUser={user} presence={presence} typingUsers={typingByChat?.get(chat.id)} />
        ))}
      </section>
    </aside>
  );
}
