import { useMemo, useState } from "react";
import { usePeer } from "../hooks/usePeer";

const Connect = () => {
  const {
    peerManager,
    connections,
    myId,
    peerStatus,
    networkingEnv,
    activeTransport,
    availableTransports,
    autoFallbackTriggered,
    connectionPhase,
    roomName,
    setActiveTransport,
  } = usePeer();
  const [isMinimized, setIsMinimized] = useState(false);

  const peerStatusText = useMemo(() => {
    switch (peerStatus.status) {
      case "open":
        return "シグナリング: 接続OK";
      case "connecting":
        return "シグナリング: 接続中...";
      case "disconnected":
        return "シグナリング: 切断";
      case "error":
        return `シグナリング: エラー${peerStatus.type ? `(${peerStatus.type})` : ""} ${peerStatus.message}`;
      default:
        return "シグナリング: 状態不明";
    }
  }, [peerStatus]);

  const phaseText = useMemo(() => {
    switch (connectionPhase) {
      case "trying-host":
        return `ルーム "${roomName}" に接続中...（ホスト試行）`;
      case "connecting-client":
        return `ルーム "${roomName}" に接続中...（クライアント）`;
      case "connected":
        return peerManager?.getIsHost()
          ? `ルーム "${roomName}" — ホスト`
          : `ルーム "${roomName}" — クライアント`;
      case "manual":
        return "手動接続モード";
    }
  }, [connectionPhase, roomName, peerManager, connections]);

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
        <h3 style={{ margin: 0, fontSize: "1.1em" }}>接続設定</h3>
        <button
          type="button"
          onClick={() => setIsMinimized(!isMinimized)}
          style={{
            padding: "2px 8px",
            fontSize: "0.8em",
            backgroundColor: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.3)",
          }}
        >
          {isMinimized ? "展開" : "最小化"}
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
              通信方式:{" "}
              {activeTransport === "peerjs" ? "PeerJS(WebRTC)" : "WS Relay"}
            </p>
            <p style={{ margin: "5px 0", fontSize: "0.9em" }}>
              あなたのID: {myId || "生成中..."}
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
                  学校/社内ネットワークだと WebRTC
                  が塞がれていることがあります。 その場合は通信方式を WS Relay
                  に切り替えてください。
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
                PeerJS失敗のため WS Relay へ自動切替しました。
              </p>
            )}
          </div>

          {connections.length > 0 && (
            <div className="connections-list">
              <h3>接続中の相手</h3>
              <ul>
                {connections.map((conn) => (
                  <li
                    key={conn.id}
                    className={conn.open ? "connected" : "disconnected"}
                  >
                    {conn.id} ({conn.open ? "接続中" : "接続準備中/失敗"})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details style={{ marginTop: "8px" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85em" }}>
              ▶ ネットワーク設定(env)
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
                <span>通信方式: </span>
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
