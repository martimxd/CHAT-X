import React from "react";
import { MessageSquare, Users } from "lucide-react";

export function Avatar({ name = "", type = "direct", size = "md" }) {
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <span className={`wa-avatar wa-avatar-${size}`}>
      {initial || (type === "group" ? <Users size={size === "lg" ? 24 : 18} /> : <MessageSquare size={size === "lg" ? 24 : 18} />)}
    </span>
  );
}
