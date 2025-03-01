type SignalingMessage = {
  type: 'offer' | 'answer' | 'candidate';
  payload: any;
  from?: string;
  to?: string;
};

const createSignaling = () => {
  const url = 'ws://localhost:8080';  // シグナリングサーバーのURL
  let ws: WebSocket | null = null;
  let clientId: string | null = null;

  const connect = () => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('シグナリングサーバーに接続しました');
    };

    ws.onmessage = (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (e) {
        console.error('メッセージの解析に失敗:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket エラー:', error);
    };

    ws.onclose = () => {
      console.log('シグナリングサーバーから切断されました');
    };
  };

  const handleMessage = (message: SignalingMessage) => {
    switch (message.type) {
      case 'offer':
        // オファーを受信した時の処理
        break;
      case 'answer':
        // アンサーを受信した時の処理
        break;
      case 'candidate':
        // ICE candidateを受信した時の処理
        break;
      default:
        console.warn('未知のメッセージタイプ:', message);
    }
  };

  const send = (message: SignalingMessage) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket接続が確立されていません');
    }
  };

  return {
    connect,
    send
  };
};

export { createSignaling };
export type { SignalingMessage }; 