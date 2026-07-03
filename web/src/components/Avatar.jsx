import React, { useEffect, useState } from "react";
import { MessageSquare, Users } from "lucide-react";
import { api, apiUrl, getToken } from "../lib/api.js";

export function Avatar({ name = "", type = "direct", size = "md", mediaId = null }) {
  const [src, setSrc] = useState("");
  const initial = name.trim().charAt(0).toUpperCase();

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (!mediaId) {
      setSrc("");
      return () => {};
    }
    async function loadAvatar() {
      try {
        const link = await api(`/api/media/${mediaId}/link`);
        const response = await fetch(apiUrl(link.url), {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        if (!response.ok) throw new Error("avatar_load_failed");
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setSrc(objectUrl);
      } catch {
        if (active) setSrc("");
      }
    }
    loadAvatar();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId]);

  return (
    <span className={`wa-avatar wa-avatar-${size}`}>
      {src ? <img src={src} alt="" /> : (initial || (type === "group" ? <Users size={size === "lg" ? 24 : 18} /> : <MessageSquare size={size === "lg" ? 24 : 18} />))}
    </span>
  );
}
