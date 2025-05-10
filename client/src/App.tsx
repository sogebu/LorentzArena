import { useEffect, useState } from 'react';
import { SignalingClient } from './signaling';
import { WebRTCClient } from './webrtc';

const SIGNALING_SERVER_URL = process.env.VITE_SIGNALING_SERVER_URL;

interface ChatMessage {
  sender: string;
  content: string;
  timestamp: Date;
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [clients, setClients] = useState<string[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [myClientId] = useState<string>(() => Math.random().toString(36).substring(2, 15));

  const [webrtc] = useState(
    () =>
      new WebRTCClient({
        onMessage: (message, from) => {
          console.log(`Message received from ${from}: ${message}`);
          setMessages((prev) => [
            ...prev,
            {
              sender: from,
              content: message,
              timestamp: new Date(),
            },
          ]);
        },
      }),
  );
  const [signaling] = useState(
    () =>
      new SignalingClient({
        baseUrl: SIGNALING_SERVER_URL,
        clientId: myClientId,
        onOffer: async (offer, from) => {
          console.log(`Offer received from ${from}: ${offer}`);
          const answer = await webrtc.handleOffer(offer);
          await signaling.sendAnswer(from, answer);
        },
        onAnswer: async (answer) => {
          console.log(`Answer received: ${answer}`);
          await webrtc.handleAnswer(answer);
        },
        onIceCandidate: async (candidate) => {
          console.log(`ICE candidate received in signaling: ${candidate}`);
          await webrtc.handleIceCandidate(candidate);
        },
      }),
  );

  signaling.startPolling();

  // クライアント一覧の定期更新
  useEffect(() => {
    const interval = setInterval(async () => {
      const clientList = await signaling.getClients();
      setClients(clientList);
    }, 5000);
    return () => clearInterval(interval);
  });

  const handleConnectToHost = async (targetHostId: string) => {
    webrtc.onIceCandidate((candidate) => {
      console.log(`ICE candidate received in webrtc: ${candidate}`);
      signaling.sendIceCandidate(targetHostId, candidate);
    });

    const offer = await webrtc.createOffer(targetHostId);
    await signaling.sendOffer(targetHostId, offer);

    setHostId(targetHostId);
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;

    const message = inputMessage;
    setInputMessage('');

    webrtc.sendMessage(message);

    setMessages((prev) => [
      ...prev,
      {
        sender: myClientId || 'Unknown',
        content: message,
        timestamp: new Date(),
      },
    ]);
  };

  return (
    <div>
      <h1>WebRTC 多人数チャット</h1>

      <div>
        <h2>接続状態</h2>
        <p>自分のID: {myClientId}</p>
        <p>ホストID: {hostId || '未設定'}</p>
      </div>

      <div>
        <h2>アクション</h2>
        <div>
          <h3>利用可能なホスト</h3>
          <div>
            {clients.map((clientId) => (
              <div key={clientId}>
                <span>{clientId}</span>
                <button type="button" onClick={() => handleConnectToHost(clientId)}>
                  接続
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2>チャット</h2>
        <div>
          {messages.map((message, index) => (
            <div key={`message-${index}-${message.sender}-${message.timestamp.getTime()}`}>
              <span>
                {message.sender}: {message.content}
              </span>
              <span>{message.timestamp.toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
        <div>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyUp={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="メッセージを入力..."
          />
          <button type="button" onClick={handleSendMessage}>
            送信
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
