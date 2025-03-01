type SignalingMessage = {
  type: "offer" | "answer" | "candidate" | "connected" | "peer_disconnected";
  payload: {
    clientId?: string;
    [key: string]: any;
  };
  from?: string;
  to?: string;
};

type SignalingEventMap = {
  connected: { clientId: string };
  peer_disconnected: { clientId: string };
  offer: RTCSessionDescriptionInit;
  answer: RTCSessionDescriptionInit;
  candidate: RTCIceCandidateInit;
};

const createSignaling = () => {
  const url = "ws://localhost:8080"; // シグナリングサーバーのURL
  let ws: WebSocket | null = null;
  let clientId: string | null = null;
  const eventHandlers = new Map<string, Function[]>();

  const connect = () => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("シグナリングサーバーに接続しました");
    };

    ws.onmessage = (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data);
        console.log("受信したメッセージ:", message);
        handleMessage(message);
      } catch (e) {
        console.error("メッセージの解析に失敗:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket エラー:", error);
    };

    ws.onclose = () => {
      console.log("シグナリングサーバーから切断されました");
      clientId = null;
    };
  };

  const handleMessage = (message: SignalingMessage) => {
    console.log("受信したメッセージ:", message);

    if (message.type === "connected" && "clientId" in message.payload) {
      clientId = message.payload.clientId;
    }

    const handlers = eventHandlers.get(message.type) || [];
    handlers.forEach((handler) => handler(message.payload));
  };

  const send = (message: SignalingMessage) => {
    if (ws?.readyState === WebSocket.OPEN) {
      console.log("送信するメッセージ:", message);
      if (clientId && message.to) {
        message.from = clientId;
      }
      ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket接続が確立されていません");
    }
  };

  const on = (type: string, handler: Function) => {
    const handlers = eventHandlers.get(type) || [];
    handlers.push(handler);
    eventHandlers.set(type, handlers);
  };

  return {
    connect,
    send,
    on,
    getClientId: () => clientId,
  };
};

export { createSignaling };
export type { SignalingMessage, SignalingEventMap };
