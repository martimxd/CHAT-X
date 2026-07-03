import React from "react";
import { ChatSidebar } from "./ChatSidebar.jsx";

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
  children
}) {
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
      <main className="wa-workspace">{children}</main>
    </div>
  );
}
