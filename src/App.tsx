import { useState } from "react";
import { useMount } from "react-use";
import { PeerManager, type ConnectionStatus } from "./PeerManager";
import "./App.css";

function App() {
  const [peerManager, setPeerManager] = useState<PeerManager | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; text: string }>>(
    [],
  );
  const [inputText, setInputText] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [myId, setMyId] = useState("");
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);

  useMount(() => {
    const pm = new PeerManager(
      `user-${Math.random().toString(36).substring(2, 11)}`,
    );
    pm.onMessage((id, text) => {
      setMessages((prev) => [...prev, { id, text }]);
    });
    pm.onConnectionChange((conns) => {
      setConnections(conns);
    });
    setPeerManager(pm);
    setMyId(pm.id());
  });

  const handleSend = () => {
    if (inputText.trim() && peerManager) {
      peerManager.send(inputText);
      setMessages((prev) => [...prev, { id: "me", text: inputText }]);
      setInputText("");
    }
  };

  const handleConnect = () => {
    if (remoteId.trim() && peerManager) {
      peerManager.connect(remoteId);
    }
  };

  return (
    <div className="chat-container">
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

      <div className="messages-container">
        {messages.map((msg, i) => (
          <div
            key={`${msg.id}-${i}`}
            className={`message ${msg.id === "me" ? "my-message" : "other-message"}`}
          >
            <div className="message-sender">
              {msg.id === "me" ? "あなた" : msg.id}
            </div>
            <div className="message-text">{msg.text}</div>
          </div>
        ))}
      </div>

      <div className="input-container">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="メッセージを入力"
        />
        <button type="button" onClick={handleSend}>
          送信
        </button>
      </div>
    </div>
  );
}

export default App;
