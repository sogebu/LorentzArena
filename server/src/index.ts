import { type WebSocket, WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });

type Client = {
  id: string;
  ws: WebSocket;
};

const clients = new Map<string, Client>();

function generateClientId(): string {
  return Math.random().toString(36).substring(2, 15);
}

wss.on("connection", (ws: WebSocket) => {
  const clientId = generateClientId();
  const client: Client = { id: clientId, ws };
  clients.set(clientId, client);

  console.log(`クライアント接続: ${clientId}`);

  // 接続したクライアントにIDを送信
  ws.send(
    JSON.stringify({
      type: "connected",
      payload: { clientId },
    }),
  );

  ws.on("message", (rawMessage: string) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      console.log("受信メッセージ:", message);

      // 特定のクライアントへの送信
      if (message.to) {
        const targetClient = clients.get(message.to);
        if (targetClient) {
          message.from = clientId;
          targetClient.ws.send(JSON.stringify(message));
        }
      }
      // ブロードキャスト（送信元以外の全クライアントへ）
      else {
        for (const [_, c] of clients) {
          if (c.id !== clientId) {
            message.from = clientId;
            c.ws.send(JSON.stringify(message));
          }
        }
      }
    } catch (e) {
      console.error("メッセージ処理エラー:", e);
    }
  });

  ws.on("close", () => {
    console.log(`クライアント切断: ${clientId}`);
    clients.delete(clientId);

    // 他のクライアントに切断を通知
    for (const [_, c] of clients) {
      if (c.id !== clientId) {
        c.ws.send(
          JSON.stringify({
            type: "peer_disconnected",
            payload: { clientId },
          }),
        );
      }
    }
  });
});

console.log("シグナリングサーバー起動: ws://localhost:8080");
