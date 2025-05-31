import { useState } from "react";
import "./App.css";
import { usePeer } from "./PeerProvider";

const Connect = () => {
  const { peerManager, connections, myId } = usePeer();
  const [remoteId, setRemoteId] = useState("");

  const handleConnect = () => {
    if (peerManager && remoteId.trim()) {
      peerManager.connect(remoteId);
    }
  };

  return (
    <div className="connection-panel">
      <div className="id-display">
        <p>あなたのID: {myId}</p>
      </div>
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
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="connect-form">
        <input
          type="text"
          value={remoteId}
          onChange={(e) => setRemoteId(e.target.value)}
          placeholder="接続先のIDを入力"
        />
        <button type="button" onClick={handleConnect}>
          接続
        </button>
      </div>
    </div>
  );
};

export default Connect;
