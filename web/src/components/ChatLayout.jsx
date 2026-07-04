import React from "react";
import { ChatSidebar } from "./ChatSidebar.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";

export function ChatLayout({
  user,
  view,
  setView,
  chats,
  selectedChatId,
  chatsLoading,
  mobileChatOpen,
  onOpen,
  onCreateDirect,
  onCreateGroup,
  onLogout,
  presence,
  typingByChat,
  connectionStatus,
  children
}) {
  const { t } = useI18n();
  const showConnectionStatus = connectionStatus && connectionStatus !== "connected";

  return (
    <div className={`wa-app-shell ${mobileChatOpen ? "mobile-chat-open" : ""}`}>
      <ChatSidebar
        user={user}
        view={view}
        setView={setView}
        chats={chats}
        selectedChatId={selectedChatId}
        loading={chatsLoading}
        onOpen={onOpen}
        onCreateDirect={onCreateDirect}
        onCreateGroup={onCreateGroup}
        onLogout={onLogout}
        presence={presence}
        typingByChat={typingByChat}
      />
      <main className="wa-workspace">
        {showConnectionStatus && (
          <div className="connection-banner">
            {connectionStatus === "connecting" ? t("connectionReconnecting") : t("connectionLost")}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
