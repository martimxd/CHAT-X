import React, { useEffect, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useI18n } from "../i18n/I18nProvider.jsx";

export function QrScanner({ onClose }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stream;
    let timer;
    let detector;
    async function start() {
      if (!("BarcodeDetector" in window)) return;
      try {
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (videoRef.current) videoRef.current.srcObject = stream;
        timer = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          const codes = await detector.detect(videoRef.current).catch(() => []);
          const value = codes[0]?.rawValue;
          if (value) setToken(value);
        }, 900);
      } catch {
        setError(t("cameraPermissionDenied"));
      }
    }
    start();
    return () => {
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [t]);

  async function approve(approve) {
    setError("");
    setMessage("");
    try {
      await api("/api/auth/qr/approve", { method: "POST", body: { token, approve } });
      setMessage(approve ? t("qrLoginApproved") : t("qrLoginDenied"));
      setToken("");
    } catch (err) {
      setError(t(`error_${err?.code || "unknown"}`));
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("scanQrCode")}>
      <div className="qr-scanner">
        <header>
          <h2>{t("scanQrCode")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")}><X size={18} /></button>
        </header>
        <video ref={videoRef} autoPlay playsInline muted />
        <label>
          <span>{t("qrToken")}</span>
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("qrTokenPlaceholder")} />
        </label>
        <div className="qr-actions">
          <button type="button" className="secondary" onClick={() => approve(false)} disabled={!token}><X size={17} />{t("denyLogin")}</button>
          <button type="button" className="primary" onClick={() => approve(true)} disabled={!token}><Check size={17} />{t("approveLogin")}</button>
        </div>
        <p className="notice"><Camera size={15} />{t("qrApprovePrompt")}</p>
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
