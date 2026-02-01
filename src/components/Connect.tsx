import { useMemo, useState } from "react";
import { usePeer } from "../hooks/usePeer";

const Connect = () => {
  const { peerManager, connections, myId, peerStatus, networkingEnv } =
    usePeer();
  const [remoteId, setRemoteId] = useState("");
  const [mode, setMode] = useState<"none" | "host" | "client">("none");
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

      // ホストに接続後、ピアリストを要求
      // （root アプリは peerList を使ってメッシュ接続に拡張する）
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
                `docs/NETWORKING.ja.md` を参照してください。
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
              </div>
            </details>
          </div>

          {mode === "none" && (
            <div className="mode-selection">
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
