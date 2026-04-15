import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { usePeer } from "../hooks/usePeer";

const AUTO_MINIMIZE_MS = 5000;

const Connect = () => {
  const {
    connections,
    myId,
    peerStatus,
    networkingEnv,
    activeTransport,
    availableTransports,
    autoFallbackTriggered,
    connectionPhase,
    roomName,
    isHost,
    setActiveTransport,
  } = usePeer();
  const { t } = useI18n();
  const [isMinimized, setIsMinimized] = useState(false);
  // マウント後 AUTO_MINIMIZE_MS で自動最小化。ユーザーが 1 回でも手動操作したら以降発動しない。
  const userInteractedRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!userInteractedRef.current) setIsMinimized(true);
    }, AUTO_MINIMIZE_MS);
    return () => clearTimeout(timer);
  }, []);

  const peerStatusText = useMemo(() => {
    switch (peerStatus.status) {
      case "open":
        return t("connect.signaling.ok");
      case "connecting":
        return t("connect.signaling.connecting");
      case "disconnected":
        return t("connect.signaling.disconnected");
      case "error":
        return `${t("connect.signaling.error")}${peerStatus.type ? `(${peerStatus.type})` : ""} ${peerStatus.message}`;
      default:
        return t("connect.signaling.unknown");
    }
  }, [peerStatus, t]);

  const phaseText = useMemo(() => {
    switch (connectionPhase) {
      case "trying-host":
        return `${t("connect.transport")}: "${roomName}"${t("connect.phase.tryingHost")}`;
      case "connecting-client":
        return `${t("connect.transport")}: "${roomName}"${t("connect.phase.connectingClient")}`;
      case "connected":
        return isHost
          ? `ルーム "${roomName}" — ${t("connect.phase.host")}`
          : `ルーム "${roomName}" — ${t("connect.phase.client")}`;
      case "manual":
        return t("connect.phase.manual");
    }
  }, [connectionPhase, roomName, isHost, t]);

  return (
    <div className="connection-panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "1.1em" }}>{t("connect.title")}</h3>
        <button
          type="button"
          onClick={() => {
            userInteractedRef.current = true;
            setIsMinimized((v) => !v);
          }}
          style={{
            padding: "2px 8px",
            fontSize: "0.8em",
            backgroundColor: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.3)",
          }}
        >
          {isMinimized ? t("connect.expand") : t("connect.minimize")}
        </button>
      </div>

      {!isMinimized && (
        <>
          <div className="id-display">
            <p
              style={{
                margin: "5px 0",
                fontSize: "0.95em",
                fontWeight: "bold",
              }}
            >
              {phaseText}
            </p>
            <p style={{ margin: "5px 0", fontSize: "0.9em" }}>
              {t("connect.transport")}:{" "}
              {activeTransport === "peerjs" ? "PeerJS(WebRTC)" : "WS Relay"}
            </p>
            <p style={{ margin: "5px 0", fontSize: "0.9em" }}>
              {t("connect.yourId")}: {myId || t("connect.generating")}
            </p>
            <p style={{ margin: "5px 0", fontSize: "0.85em", opacity: 0.9 }}>
              {peerStatusText}
            </p>

            {peerStatus.status === "error" &&
              peerStatus.type !== "unavailable-id" && (
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "0.8em",
                    opacity: 0.85,
                  }}
                >
                  {t("connect.networkHelp")}
                </p>
              )}

            {autoFallbackTriggered && (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "0.8em",
                  opacity: 0.9,
                }}
              >
                {t("connect.autoFallback")}
              </p>
            )}
          </div>

          {connections.length > 0 && (
            <div className="connections-list">
              <h3>{t("connect.peers")}</h3>
              <ul>
                {connections.map((conn) => (
                  <li
                    key={conn.id}
                    className={conn.open ? "connected" : "disconnected"}
                  >
                    {conn.id} ({conn.open ? t("connect.peerOpen") : t("connect.peerClosed")})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details style={{ marginTop: "8px" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85em" }}>
              ▶ {t("connect.networkSettings")}
            </summary>
            <div style={{ fontSize: "0.8em", opacity: 0.9, marginTop: "6px" }}>
              <div>PeerServer host: {networkingEnv.peerHost}</div>
              <div>PeerServer port: {networkingEnv.peerPort}</div>
              <div>PeerServer path: {networkingEnv.peerPath}</div>
              <div>PeerServer secure: {networkingEnv.peerSecure}</div>
              <div>ICE servers: {networkingEnv.iceServers}</div>
              <div>ICE transport: {networkingEnv.iceTransportPolicy}</div>
              <div>Preferred transport: {networkingEnv.preferredTransport}</div>
              <div>WS relay URL: {networkingEnv.wsRelayUrl}</div>
              <div style={{ marginTop: "8px" }}>
                <span>{t("connect.transport")}: </span>
                <select
                  value={activeTransport}
                  onChange={(e) =>
                    setActiveTransport(e.target.value as "peerjs" | "wsrelay")
                  }
                >
                  <option value="peerjs">PeerJS (WebRTC)</option>
                  <option
                    value="wsrelay"
                    disabled={!availableTransports.includes("wsrelay")}
                  >
                    WS Relay
                  </option>
                </select>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
};

export default Connect;
