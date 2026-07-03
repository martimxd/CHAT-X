import React, { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.jsx";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxAvatarBytes = 5 * 1024 * 1024;

export function PhotoCropper({ title, onCancel, onCropped }) {
  const { t } = useI18n();
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const imageRef = useRef(null);

  useEffect(() => {
    if (!file) {
      setUrl("");
      return () => {};
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  function selectFile(event) {
    const nextFile = event.target.files?.[0];
    setError("");
    if (!nextFile) return;
    if (!acceptedTypes.has(nextFile.type)) {
      setError(t("unsupportedImageType"));
      return;
    }
    if (nextFile.size > maxAvatarBytes) {
      setError(t("avatarTooLarge"));
      return;
    }
    setFile(nextFile);
    setZoom(1);
  }

  async function crop() {
    if (!imageRef.current || !file) return;
    const image = imageRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 512, 512);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob) {
      setError(t("imageCropFailed"));
      return;
    }
    onCropped(new File([blob], "avatar.webp", { type: "image/webp" }));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="photo-cropper">
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onCancel} aria-label={t("close")}><X size={18} /></button>
        </header>
        {!url ? (
          <label className="photo-drop">
            <ImagePlus size={28} />
            <span>{t("choosePhoto")}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} />
          </label>
        ) : (
          <>
            <div className="crop-stage">
              <img ref={imageRef} src={url} alt={t("cropPhoto")} style={{ transform: `scale(${zoom})` }} />
            </div>
            <label className="range-label">
              <span>{t("zoom")}</span>
              <input type="range" min="1" max="2.4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <footer>
          <button type="button" className="secondary" onClick={onCancel}>{t("cancel")}</button>
          <button type="button" className="primary" onClick={crop} disabled={!file}><Check size={17} />{t("savePhoto")}</button>
        </footer>
      </div>
    </div>
  );
}
