import React, { useEffect, useState } from "react";
import { AlertCircle, Download } from "lucide-react";
import { api, apiUrl, getToken } from "../lib/api.js";
import { decryptFileFromChat } from "../lib/crypto.js";
import { detectMediaKind, getMediaMimeType, getMediaName } from "../lib/media.js";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { FileMessageCard } from "./FileMessageCard.jsx";

export function MediaMessage({ media, messageType, chatKey, onImagePreview }) {
  const { t } = useI18n();
  const kind = detectMediaKind(media, messageType);
  const [state, setState] = useState({ status: kind === "file" ? "idle" : "loading", url: "", error: "" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadPreview() {
      if (!media?.id || kind === "file") return;
      setState({ status: "loading", url: "", error: "" });
      try {
        const link = await api(`/api/media/${media.id}/link`);
        const response = await fetch(apiUrl(link.url), {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error("media_fetch_failed");
        const encryptedBlob = await response.blob();
        const plaintext = await decryptFileFromChat(chatKey, encryptedBlob, media);
        objectUrl = URL.createObjectURL(plaintext);
        if (!cancelled) setState({ status: "ready", url: objectUrl, error: "" });
      } catch (error) {
        if (!cancelled) setState({ status: "error", url: "", error: error.message });
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatKey, kind, media]);

  async function downloadMedia() {
    const link = await api(`/api/media/${media.id}/link`);
    const response = await fetch(apiUrl(link.url), {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    const encryptedBlob = await response.blob();
    const plaintext = await decryptFileFromChat(chatKey, encryptedBlob, media);
    const url = URL.createObjectURL(plaintext);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getMediaName(media);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!media?.id) return null;

  if (kind === "file") {
    return <FileMessageCard media={media} onDownload={downloadMedia} />;
  }

  if (state.status === "loading") {
    return (
      <div className={`media-frame media-frame-${kind}`}>
        <div className="media-skeleton" />
        <span className="media-status">{t("mediaLoading")}</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="media-fallback">
        <AlertCircle size={18} />
        <span>{t("mediaLoadFailed")}</span>
        <button onClick={downloadMedia}>{t("downloadMedia")}</button>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <button className="image-message-button" onClick={() => onImagePreview(state.url, getMediaName(media))} aria-label={t("imagePreview")}>
        <img src={state.url} alt={getMediaName(media)} className="media-image" />
      </button>
    );
  }

  if (kind === "video") {
    return (
      <div className="media-frame">
        <video src={state.url} className="media-video" controls preload="metadata" />
        <button className="media-download" onClick={downloadMedia} title={t("downloadMedia")} aria-label={t("downloadMedia")}>
          <Download size={16} />
        </button>
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="audio-message">
        <audio src={state.url} controls preload="metadata" />
        <span>{getMediaMimeType(media, messageType)}</span>
      </div>
    );
  }

  return <FileMessageCard media={media} onDownload={downloadMedia} />;
}
