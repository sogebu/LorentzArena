import { useEffect, useState } from "react";
import { usePeer } from "../hooks/usePeer";

const Chat = () => {
  const { peerManager } = usePeer();
  const [messages, setMessages] = useState<Array<{ id: string; text: string }>>(
    [],
  );
  const [inputText, setInputText] = useState("");

  useEffect(() => {
    if (peerManager) {
      peerManager.onMessage("text", (id, msg) => {
        if (msg.type === "text") {
          setMessages((prev) => [...prev, { id, text: msg.text }]);
        }
      });
    }
    return () => {
      if (peerManager) {
        peerManager.offMessage("text");
      }
    };
  }, [peerManager]);

  const handleSend = () => {
    if (peerManager && inputText.trim()) {
      peerManager.send({ type: "text", text: inputText });
      setMessages((prev) => [...prev, { id: "me", text: inputText }]);
      setInputText("");
    }
  };

  if (!peerManager) {
    return <div>Loading...</div>;
  }

  return (
    <div className="chat-container">
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
};

export default Chat;
