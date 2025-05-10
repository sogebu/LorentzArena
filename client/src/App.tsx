import { useEffect, useState } from 'react';
import { WebRTCClient } from './webrtc';
import { SignalingClient } from './signaling';

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
  const [isWebRTCConnected, setIsWebRTCConnected] = useState(false);
  const [myClientId, setMyClientId] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [connectedClients, setConnectedClients] = useState<Set<string>>(new Set());

  const [webrtc] = useState(() => new WebRTCClient());
  const [signaling, setSignaling] = useState<SignalingClient | null>(null);

  // クライアント一覧の更新
  const updateClients = async () => {
    if (!signaling) return;
    const clientList = await signaling.getClients();
    setClients(clientList);
  };

  useEffect(() => {
    const initialize = async () => {
      // シグナリングサーバーに接続
      const clientId = await signaling.connect();
      setMyClientId(clientId);

      // クライアント一覧の初期取得
      await updateClients();

      // メッセージの受信設定
      webrtc.onMessage((message, from) => {
        console.log(`Message received from ${from}: ${message}`);
        setMessages((prev) => [
          ...prev,
          {
            sender: from,
            content: message,
            timestamp: new Date(),
          },
        ]);

        // ホストの場合、メッセージを他の全員に転送
        if (webrtc.isHostMode() && from !== myClientId) {
          webrtc.sendMessage(message);
        }
      });

      // ICE candidateの処理
      webrtc.onIceCandidate((candidate) => {
        if (hostId) {
          signaling.sendIceCandidate(hostId, candidate);
        }
      });

      // シグナリングの設定
      signaling.onOffer(async (offer, from) => {
        const answer = await webrtc.handleOffer(offer);
        await signaling.sendAnswer(from, answer);
        setIsWebRTCConnected(true);
        setConnectedClients((prev) => new Set([...prev, from]));
      });

      signaling.onAnswer(async (answer) => {
        await webrtc.handleAnswer(answer);
        setIsWebRTCConnected(true);
      });

      signaling.onIceCandidate(async (candidate) => {
        await webrtc.handleIceCandidate(candidate);
      });

      // ポーリング開始
      signaling.startPolling();
    };

    initialize();
  }, []);

  // クライアント一覧の定期更新
  useEffect(() => {
    if (!myClientId) return;

    const interval = setInterval(updateClients, 5000);
    return () => clearInterval(interval);
  }, [myClientId]);

  const handleBecomeHost = async () => {
    webrtc.setHost(true);
    setHostId(myClientId);
  };

  const handleConnectToHost = async (targetHostId: string) => {
    if (!targetHostId) return;

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
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">WebRTC 多人数チャット</h1>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">接続状態</h2>
        <p>WebRTC接続: {isWebRTCConnected ? '接続中' : '未接続'}</p>
        <p>自分のID: {myClientId || '未接続'}</p>
        <p>ホストID: {hostId || '未設定'}</p>
        <p>接続中のクライアント: {connectedClients.size}人</p>
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">アクション</h2>
        {!hostId && (
          <button type="button" className="bg-green-500 text-white px-4 py-2 rounded mr-2" onClick={handleBecomeHost}>
            ホストになる
          </button>
        )}
        {!hostId && clients.length > 0 && (
          <div className="mt-2">
            <h3 className="text-lg font-semibold mb-2">利用可能なホスト</h3>
            <div className="space-y-2">
              {clients.map((clientId) => (
                <div key={clientId} className="flex items-center">
                  <span className="mr-2">{clientId}</span>
                  <button
                    type="button"
                    className="bg-blue-500 text-white px-4 py-2 rounded"
                    onClick={() => handleConnectToHost(clientId)}
                  >
                    接続
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">チャット</h2>
        <div className="border rounded p-4 h-96 overflow-y-auto mb-4">
          {messages.map((message, index) => (
            <div key={`message-${index}-${message.sender}-${message.timestamp.getTime()}`} className="mb-2">
              <span className="font-semibold">{message.sender}: </span>
              <span>{message.content}</span>
              <span className="text-gray-500 text-sm ml-2">{message.timestamp.toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
        <div className="flex">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            className="border rounded p-2 flex-grow mr-2"
            placeholder="メッセージを入力..."
          />
          <button type="button" className="bg-blue-500 text-white px-4 py-2 rounded" onClick={handleSendMessage}>
            送信
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
