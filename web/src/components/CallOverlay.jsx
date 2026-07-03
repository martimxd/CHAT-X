import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { api } from "../lib/api.js";
import { useI18n } from "../i18n/I18nProvider.jsx";

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function CallOverlay({ socket, call, setCall }) {
  const { t } = useI18n();
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const selfVideoRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!call || call.status !== "active") {
      setDuration(0);
      return () => {};
    }
    const started = Date.now();
    const timer = window.setInterval(() => setDuration(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [call]);

  useEffect(() => {
    if (selfVideoRef.current) selfVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (!socket) return () => {};
    const onAnswer = async ({ callId, answer }) => {
      if (call?.callId !== callId || !pcRef.current) return;
      await pcRef.current.setRemoteDescription(answer);
      setCall((value) => value ? { ...value, status: "active" } : value);
    };
    const onIce = async ({ candidate }) => {
      if (!pcRef.current || !candidate) return;
      await pcRef.current.addIceCandidate(candidate).catch(() => {});
    };
    const onRejected = ({ callId }) => {
      if (call?.callId === callId) endLocal(t("callRejected"));
    };
    const onEnded = ({ callId }) => {
      if (call?.callId === callId) endLocal(t("callEnded"));
    };
    socket.on("call:answer", onAnswer);
    socket.on("call:ice", onIce);
    socket.on("call:rejected", onRejected);
    socket.on("call:ended", onEnded);
    return () => {
      socket.off("call:answer", onAnswer);
      socket.off("call:ice", onIce);
      socket.off("call:rejected", onRejected);
      socket.off("call:ended", onEnded);
    };
  }, [call?.callId, setCall, socket, t]);

  useEffect(() => {
    if (!call?.pc) return;
    pcRef.current = call.pc;
    localStreamRef.current = call.localStream || null;
    setLocalStream(call.localStream || null);
    setRemoteStream(call.remoteStream || null);
    if (call.callId && call.peerId) {
      call.pc.onicecandidate = (event) => {
        if (event.candidate) socket?.emit("call:ice", { callId: call.callId, chatId: call.chatId, targetUserId: call.peerId, candidate: event.candidate });
      };
    }
  }, [call?.callId, call?.pc, call?.peerId, call?.chatId, call?.localStream, call?.remoteStream, socket]);

  async function createPeer(targetUserId, chatId, callId) {
    const config = await api("/api/calls/config").catch(() => ({ iceServers: [] }));
    const pc = new RTCPeerConnection({ iceServers: config.iceServers || [] });
    const remote = new MediaStream();
    setRemoteStream(remote);
    pc.ontrack = (event) => event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
    pc.onicecandidate = (event) => {
      if (event.candidate) socket?.emit("call:ice", { callId, chatId, targetUserId, candidate: event.candidate });
    };
    pcRef.current = pc;
    return pc;
  }

  async function getLocalMedia() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 } }, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch {
      setError(t("cameraMicrophoneDenied"));
      throw new Error("media_denied");
    }
  }

  async function accept() {
    const stream = await getLocalMedia();
    const pc = await createPeer(call.callerId, call.chatId, call.callId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    await pc.setRemoteDescription(call.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit("call:answer", { callId: call.callId, chatId: call.chatId, callerId: call.callerId, answer });
    setCall({ ...call, status: "active", peerId: call.callerId });
  }

  function reject() {
    socket?.emit("call:reject", { callId: call.callId, chatId: call.chatId, callerId: call.callerId });
    endLocal();
  }

  function endLocal(finalMessage = "") {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    if (finalMessage) setError(finalMessage);
    setCall(null);
  }

  function endCall() {
    if (call?.callId && call?.peerId) socket?.emit("call:end", { callId: call.callId, chatId: call.chatId, targetUserId: call.peerId });
    endLocal();
  }

  function toggleMute() {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = muted;
    });
    setMuted(!muted);
  }

  function toggleCamera() {
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = cameraOff;
    });
    setCameraOff(!cameraOff);
  }

  if (!call) return null;

  const incoming = call.status === "incoming";
  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label={t("videoCall")}>
      <div className="call-surface">
        <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
        {!remoteStream && <div className="call-placeholder"><Video size={38} /><strong>{call.peerName}</strong><span>{incoming ? t("incomingCall") : t("outgoingCall")}</span></div>}
        <video ref={selfVideoRef} className="self-video" autoPlay playsInline muted />
        <header className="call-top">
          <strong>{call.peerName}</strong>
          <span>{call.status === "active" ? formatDuration(duration) : t(call.status === "incoming" ? "incomingCall" : "calling")}</span>
        </header>
        <footer className="call-controls">
          {incoming ? (
            <>
              <button className="call-button reject" onClick={reject} aria-label={t("rejectCall")}><PhoneOff size={24} /></button>
              <button className="call-button accept" onClick={accept} aria-label={t("acceptCall")}><Phone size={24} /></button>
            </>
          ) : (
            <>
              <button className="call-button neutral" onClick={toggleMute} aria-label={muted ? t("unmuteMicrophone") : t("muteMicrophone")}>{muted ? <MicOff size={23} /> : <Mic size={23} />}</button>
              <button className="call-button neutral" onClick={toggleCamera} aria-label={cameraOff ? t("enableCamera") : t("disableCamera")}>{cameraOff ? <VideoOff size={23} /> : <Video size={23} />}</button>
              <button className="call-button reject" onClick={endCall} aria-label={t("endCall")}><PhoneOff size={24} /></button>
            </>
          )}
        </footer>
        {error && <div className="call-error">{error}</div>}
      </div>
    </div>
  );
}

export async function startOutgoingCall({ socket, chat, peer, setCall, t }) {
  const config = await api("/api/calls/config").catch(() => ({ iceServers: [] }));
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 } }, audio: true });
  const pc = new RTCPeerConnection({ iceServers: config.iceServers || [] });
  const remote = new MediaStream();
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  pc.ontrack = (event) => event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const draft = {
    status: "outgoing",
    chatId: chat.id,
    peerId: peer.id,
    peerName: peer.nickname || peer.displayName || peer.username || t("directChat"),
    pc,
    localStream: stream,
    remoteStream: remote
  };
  setCall(draft);
  socket.emit("call:start", { chatId: chat.id, offer });
  return { pc, stream, remote };
}
