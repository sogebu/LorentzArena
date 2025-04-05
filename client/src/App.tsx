import { useEffect, useState } from 'react';
import { WebRTCClient } from './webrtc';
import { SignalingClient } from './signaling';

const SIGNALING_SERVER_URL = 'http://localhost:8080/api';

function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [clients, setClients] = useState<string[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isWebRTCConnected, setIsWebRTCConnected] = useState(false);
  const [myClientId, setMyClientId] = useState<string | null>(null);

  const [webrtc] = useState(() => new WebRTCClient());
  const [signaling] = useState(() => new SignalingClient(SIGNALING_SERVER_URL));

  useEffect(() => {
    const initialize = async () => {
      // シグナリングサーバーに接続
      const clientId = await signaling.connect();
      setMyClientId(clientId);
      setIsConnected(true);

      // クライアント一覧の取得
      const clientList = await signaling.getClients();
      setClients(clientList);

      // メッセージの受信設定
      webrtc.onMessage((message) => {
        setMessages((prev) => [...prev, `相手: ${message}`]);
      });

      // ICE candidateの処理
      webrtc.onIceCandidate((candidate) => {
        if (selectedClient) {
          signaling.sendIceCandidate(selectedClient, candidate);
        }
      });

      // シグナリングの設定
      signaling.onOffer(async (offer, from) => {
        const answer = await webrtc.handleOffer(offer);
        await signaling.sendAnswer(from, answer);
        setIsWebRTCConnected(true);
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
  }, [selectedClient]);

  const handleSendOffer = async () => {
    if (!selectedClient) return;

    const offer = await webrtc.createOffer();
    await signaling.sendOffer(selectedClient, offer);
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;

    webrtc.sendMessage(inputMessage);
    setMessages((prev) => [...prev, `自分: ${inputMessage}`]);
    setInputMessage('');
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">WebRTC チャット</h1>
      
      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">接続状態</h2>
        <p>シグナリングサーバー: {isConnected ? '接続中' : '未接続'}</p>
        <p>WebRTC接続: {isWebRTCConnected ? '接続中' : '未接続'}</p>
        <p>自分のID: {myClientId || '未接続'}</p>
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">クライアント一覧</h2>
        <select
          className="border p-2 rounded"
          value={selectedClient || ''}
          onChange={(e) => setSelectedClient(e.target.value)}
        >
          <option value="">選択してください</option>
          {clients.map((client) => (
            <option key={client} value={client}>
              {client}
            </option>
          ))}
        </select>
        <button
          className="ml-2 bg-blue-500 text-white px-4 py-2 rounded"
          onClick={handleSendOffer}
          disabled={!selectedClient || isWebRTCConnected}
        >
          接続開始
        </button>
      </div>

      <div className="mb-4">
        <h2 className="text-xl font-semibold mb-2">メッセージ</h2>
        <div className="border p-4 h-64 overflow-y-auto mb-4">
          {messages.map((message, index) => (
            <p key={index} className="mb-2">
              {message}
            </p>
          ))}
        </div>
        <div className="flex">
          <input
            type="text"
            className="border p-2 rounded flex-grow"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            disabled={!isWebRTCConnected}
          />
          <button
            className="ml-2 bg-green-500 text-white px-4 py-2 rounded"
            onClick={handleSendMessage}
            disabled={!isWebRTCConnected}
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
