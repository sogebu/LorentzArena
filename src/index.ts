import { createSignaling, type SignalingMessage } from './signaling';

// WebRTC接続の管理
const createGameConnection = () => {
  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  const signaling = createSignaling();

  const statusElement = document.getElementById('connectionStatus') as HTMLDivElement;
  const messagesElement = document.getElementById('messages') as HTMLDivElement;

  const updateStatus = (status: string) => {
    statusElement.textContent = `接続状態: ${status}`;
  };

  const addMessage = (message: string) => {
    const messageDiv = document.createElement('div');
    messageDiv.textContent = message;
    messagesElement.appendChild(messageDiv);
  };

  const initConnection = async () => {
    signaling.connect();
    
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // ICE candidate が生成されたときの処理
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.send({
          type: 'candidate',
          payload: event.candidate
        });
      }
    };

    dataChannel = peerConnection.createDataChannel('gameData');
    
    dataChannel.onmessage = (event) => {
      addMessage(`受信: ${event.data}`);
    };

    dataChannel.onopen = () => {
      updateStatus('接続済み');
      addMessage('接続が確立されました');
    };

    dataChannel.onclose = () => {
      updateStatus('切断');
      addMessage('接続が切断されました');
    };
  };

  const createOffer = async () => {
    if (!peerConnection) return;
    
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      signaling.send({
        type: 'offer',
        payload: offer
      });
    } catch (e) {
      console.error('オファーの作成に失敗:', e);
    }
  };

  const sendMessage = (message: string) => {
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(message);
      addMessage(`送信: ${message}`);
    } else {
      addMessage('エラー: 接続が確立されていません');
    }
  };

  return {
    init: initConnection,
    createOffer,
    sendMessage
  };
};

// ゲームの初期化
const game = createGameConnection();

// UIイベントの設定
document.getElementById('connectButton')?.addEventListener('click', () => {
  game.init();
});

document.getElementById('sendTestMessage')?.addEventListener('click', () => {
  game.sendMessage('テストメッセージ');
});
