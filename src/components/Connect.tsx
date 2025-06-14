import { useState } from "react";
import { usePeer } from "../hooks/usePeer";

const Connect = () => {
  const { peerManager, connections, myId } = usePeer();
  const [remoteId, setRemoteId] = useState("");
  const [mode, setMode] = useState<"none" | "host" | "client">("none");

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
      setTimeout(() => {
        peerManager.sendTo(remoteId, { type: "requestPeerList" });
      }, 1000);
    }
  };

  return (
    <div className="connection-panel">
      <div className="id-display">
        <p>あなたのID: {myId}</p>
        {mode !== "none" && (
          <p>モード: {mode === "host" ? "ホスト" : "クライアント"}</p>
        )}
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
                  {conn.id} ({conn.open ? "接続中" : "切断中"})
                  {mode === "host" &&
                    conn.id === peerManager?.getHostId() &&
                    " (ホスト)"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default Connect;
