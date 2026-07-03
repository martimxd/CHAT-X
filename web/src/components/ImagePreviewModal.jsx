import React from "react";
import { X } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";

export function ImagePreviewModal({ src, alt, onClose }) {
  const { t } = useI18n();
  if (!src) return null;

  return (
    <div className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label={t("imagePreview")}>
      <button className="image-preview-close" onClick={onClose} title={t("closePreview")} aria-label={t("closePreview")}>
        <X size={22} />
      </button>
      <img src={src} alt={alt} className="image-preview-modal" />
    </div>
  );
}
