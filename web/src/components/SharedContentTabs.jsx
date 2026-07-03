import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "../lib/api.js";
import { decryptPayload } from "../lib/crypto.js";
import { formatDateTime } from "../lib/format.js";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { MediaMessage } from "./MediaMessage.jsx";

const urlPattern = /\bhttps?:\/\/[^\s<>"']+/gi;

export function SharedContentTabs({ chat, chatKey, refreshKey = 0, onImagePreview }) {
  const { t } = useI18n();
  const [tab, setTab] = useState("media");
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const tabs = useMemo(() => [
    { key: "media", label: t("media") },
    { key: "files", label: t("files") },
    { key: "links", label: t("links") },
    { key: "gifs", label: t("gifs") }
  ], [t]);

  async function load(nextCursor = null, append = false) {
    setLoading(true);
    setError("");
    try {
      const path = `/api/chats/${chat.id}/shared/${tab}?limit=30${nextCursor ? `&before=${encodeURIComponent(nextCursor)}` : ""}`;
      const data = await api(path);
      const decrypted = [];
      for (const item of data.items) {
        let body = null;
        try {
          body = item.encryptedPayload ? await decryptPayload(chatKey, item.encryptedPayload) : null;
        } catch {
          body = null;
        }
        if (tab === "links") {
          const urls = [...String(body?.text || "").matchAll(urlPattern)].map((match) => match[0]);
          urls.forEach((url) => decrypted.push({ ...item, body, url }));
        } else {
          const media = body?.media ? { ...item.media, ...body.media, id: item.media?.id || body.media.id } : item.media;
          if (media?.id) decrypted.push({ ...item, body, media });
        }
      }
      setItems((current) => append ? [...current, ...decrypted] : decrypted);
      setCursor(data.nextCursor || null);
    } catch {
      setError(t(`shared${tab.charAt(0).toUpperCase()}${tab.slice(1)}Error`));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setCursor(null);
    load().catch(() => {});
  }, [chat.id, chatKey, tab, refreshKey]);

  return (
    <section className="shared-tabs">
      <nav>
        {tabs.map((item) => (
          <button key={item.key} type="button" className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>
      {error && <div className="error">{error}</div>}
      {loading && items.length === 0 && <div className="chat-skeleton" />}
      {!loading && items.length === 0 && !error && <p className="empty-list-copy">{t(`no${tab.charAt(0).toUpperCase()}${tab.slice(1)}Yet`)}</p>}
      {tab === "links" ? (
        <div className="shared-link-list">
          {items.map((item) => (
            <a key={`${item.id}:${item.url}`} href={item.url} target="_blank" rel="noreferrer noopener" className="shared-link-card">
              <ExternalLink size={17} />
              <span><strong>{item.url}</strong><small>{formatDateTime(item.createdAt)} · {item.senderDisplayName || item.senderUsername || t("deletedMessage")}</small></span>
            </a>
          ))}
        </div>
      ) : (
        <div className={tab === "files" ? "shared-file-list" : "shared-media-grid"}>
          {items.map((item) => (
            <div key={item.id} className="shared-item">
              <MediaMessage media={item.media} messageType={item.messageType} chatKey={chatKey} onImagePreview={onImagePreview} />
              <small>{formatDateTime(item.createdAt)} · {item.senderDisplayName || item.senderUsername || t("deletedMessage")}</small>
            </div>
          ))}
        </div>
      )}
      {cursor && <button type="button" className="secondary load-more" disabled={loading} onClick={() => load(cursor, true)}>{loading ? t("loading") : t("loadMore")}</button>}
    </section>
  );
}
