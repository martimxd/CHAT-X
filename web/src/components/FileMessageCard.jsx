import React from "react";
import { Download, FileText } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { formatFileSize } from "../lib/format.js";
import { getMediaName, getMediaSize } from "../lib/media.js";

export function FileMessageCard({ media, onDownload }) {
  const { t } = useI18n();
  const filename = getMediaName(media);
  const size = formatFileSize(getMediaSize(media));

  return (
    <div className="file-message-card">
      <span className="file-message-icon"><FileText size={22} /></span>
      <span className="file-message-copy">
        <strong>{filename}</strong>
        <small>{size || t("fileSizeUnknown")}</small>
      </span>
      <button className="bubble-icon-button" onClick={onDownload} title={t("downloadMedia")} aria-label={t("downloadMedia")}>
        <Download size={18} />
      </button>
    </div>
  );
}
