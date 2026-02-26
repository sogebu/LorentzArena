import { useEffect, useMemo, useState } from "react";
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
    setActiveTransport,
  } = usePeer();
  const [remoteId, setRemoteId] = useState("");
  const [mode, setMode] = useState<"none" | "host" | "client">("none");
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    setMode("none");
  }, [activeTransport]);

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

  const handleStartAsHost = () => {
    if (peerManager) {
      peerManager.setAsHost();
      setMode("host");
    }
  };

  const handleConnectToHost = () => {
    if (peerManager && remoteId.trim()) {
      peerManager.setHostId(remoteId);
      peerManager.connect(remoteId);
      setMode("client");

      // 互換のため残しているが、2+1 は基本的にホスト中継型で peerList は必須ではない。
      setTimeout(() => {
        peerManager.sendTo(remoteId, { type: "requestPeerList" });
      }, 1000);
    }
  };

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

            {peerStatus.status === "error" && (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "0.8em",
                  opacity: 0.85,
                }}
              >
                学校/社内ネットワークだと WebRTC が塞がれていることがあります。
                その場合は通信方式を `WS Relay` に切り替えてください。
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
                `VITE_NETWORK_TRANSPORT=auto` のため、PeerJS失敗時に
                `WS Relay` へ自動切替しました。
              </p>
            )}

            {mode !== "none" && (
              <p style={{ margin: "8px 0 0", fontSize: "0.9em" }}>
                モード: {mode === "host" ? "ホスト" : "クライアント"}
              </p>
            )}

            <details style={{ marginTop: "8px" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85em" }}>
                ネットワーク設定（env）
              </summary>
              <div
                style={{ fontSize: "0.8em", opacity: 0.9, marginTop: "6px" }}
              >
                <div>PeerServer host: {networkingEnv.peerHost}</div>
                <div>PeerServer port: {networkingEnv.peerPort}</div>
                <div>PeerServer path: {networkingEnv.peerPath}</div>
                <div>PeerServer secure: {networkingEnv.peerSecure}</div>
                <div>ICE servers: {networkingEnv.iceServers}</div>
                <div>ICE transport: {networkingEnv.iceTransportPolicy}</div>
                <div>
                  Preferred transport: {networkingEnv.preferredTransport}
                </div>
                <div>WS relay URL: {networkingEnv.wsRelayUrl}</div>
              </div>
            </details>
          </div>

          {mode === "none" && (
            <div className="mode-selection">
              <h3>通信方式</h3>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <select
                  value={activeTransport}
                  onChange={(e) =>
                    setActiveTransport(
                      e.target.value as "peerjs" | "wsrelay",
                    )
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
                {!availableTransports.includes("wsrelay") && (
                  <span style={{ fontSize: "0.8em", opacity: 0.85 }}>
                    `VITE_WS_RELAY_URL` 未設定
                  </span>
                )}
              </div>

              <h3>モードを選択</h3>
              <button type="button" onClick={handleStartAsHost}>
                ホストとして開始
              </button>
              <div style={{ margin: "10px 0" }}>
                <input
                  type="text"
                  value={remoteId}
                  onChange={(e) => setRemoteId(e.target.value)}
                  placeholder="ホストのIDを入力"
                />
                <button type="button" onClick={handleConnectToHost}>
                  ホストに接続
                </button>
              </div>
            </div>
          )}

          {mode !== "none" && (
            <div className="connections-list">
              <h3>接続中の相手</h3>
              {connections.length === 0 ? (
                <p>接続中の相手はいません</p>
              ) : (
                <ul>
                  {connections.map((conn) => (
                    <li
                      key={conn.id}
                      className={conn.open ? "connected" : "disconnected"}
                    >
                      {conn.id} ({conn.open ? "接続中" : "接続準備中/失敗"})
                      {mode === "client" &&
                        conn.id === peerManager?.getHostId() &&
                        " (ホスト)"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Connect;
