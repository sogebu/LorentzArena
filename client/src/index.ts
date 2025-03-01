import { createSignaling } from './signaling';

const createGameConnection = () => {
  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  const signaling = createSignaling();

  const statusElement = document.getElementById('connectionStatus') as HTMLDivElement;
  const messagesElement = document.getElementById('messages') as HTMLDivElement;
  const debugInfoElement = document.getElementById('debugInfo') as HTMLDivElement;
  const createOfferButton = document.getElementById('createOfferButton') as HTMLButtonElement;
  const sendTestMessageButton = document.getElementById('sendTestMessage') as HTMLButtonElement;

  const updateStatus = (status: string) => {
    statusElement.textContent = `接続状態: ${status}`;
  };

  const updateDebugInfo = () => {
    const info = [
      `クライアントID: ${signaling.getClientId() || '未取得'}`,
      `WebRTC状態: ${peerConnection?.connectionState || '未接続'}`,
      `DataChannel状態: ${dataChannel?.readyState || '未接続'}`
    ];
    debugInfoElement.innerHTML = info.join('<br>');
  };

  const addMessage = (message: string) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const time = new Date().toLocaleTimeString();
    messageDiv.innerHTML = `
      <span class="message-time">[${time}]</span>
      ${message}
    `;
    
    messagesElement.appendChild(messageDiv);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  };

  const initConnection = async () => {
    signaling.connect();

    signaling.on('connected', ({ clientId }) => {
      addMessage(`シグナリングサーバーに接続しました（ID: ${clientId}）`);
      updateStatus('シグナリングサーバーに接続済み');
      createOfferButton.disabled = false;
      updateDebugInfo();
    });

    signaling.on('peer_disconnected', ({ clientId }) => {
      addMessage(`ピア切断: ${clientId}`);
    });

    signaling.on('offer', async (offer) => {
      if (!peerConnection) {
        await setupPeerConnection();
      }
      await peerConnection?.setRemoteDescription(offer);
      const answer = await peerConnection?.createAnswer();
      await peerConnection?.setLocalDescription(answer);
      signaling.send({
        type: 'answer',
        payload: answer
      });
    });

    signaling.on('answer', async (answer) => {
      await peerConnection?.setRemoteDescription(answer);
    });

    signaling.on('candidate', async (candidate) => {
      await peerConnection?.addIceCandidate(candidate);
    });

    // 定期的なデバッグ情報の更新
    setInterval(updateDebugInfo, 1000);
  };

  const setupPeerConnection = async () => {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // 接続状態の変更を監視
    peerConnection.onconnectionstatechange = () => {
      updateStatus(`WebRTC: ${peerConnection?.connectionState}`);
      updateDebugInfo();
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.send({
          type: 'candidate',
          payload: event.candidate
        });
      }
    };

    dataChannel = peerConnection.createDataChannel('gameData');
    setupDataChannel(dataChannel);

    peerConnection.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onmessage = (event) => {
      addMessage(`受信: ${event.data}`);
    };

    channel.onopen = () => {
      updateStatus('ピア接続済み');
      addMessage('データチャネルが開きました');
      sendTestMessageButton.disabled = false;
      updateDebugInfo();
    };

    channel.onclose = () => {
      updateStatus('切断');
      addMessage('データチャネルが閉じました');
      sendTestMessageButton.disabled = true;
      updateDebugInfo();
    };
  };

  const createOffer = async () => {
    if (!peerConnection) {
      await setupPeerConnection();
    }
    
    try {
      const offer = await peerConnection?.createOffer();
      await peerConnection?.setLocalDescription(offer);
      
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

document.getElementById('createOfferButton')?.addEventListener('click', () => {
  game.createOffer();
});

document.getElementById('sendTestMessage')?.addEventListener('click', () => {
  game.sendMessage('テストメッセージ');
});
