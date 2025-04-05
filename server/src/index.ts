import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Client = {
  id: string;
  lastActive: number;
};

type Message = {
  type: string;
  payload: Record<string, unknown>;
  from: string;
  to: string;
  timestamp: number;
};

const app = new Hono()
app.use('/*', cors())

const clients = new Map<string, Client>();
const messagesByClient = new Map<string, Message[]>();

function generateClientId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// クライアント接続
app.post('/api/connect', (c) => {
  const clientId = generateClientId();
  const client: Client = { 
    id: clientId, 
    lastActive: Date.now() 
  };
  clients.set(clientId, client);

  return c.json({
    type: 'connected',
    payload: { clientId }
  });
});

// 接続中のクライアント一覧を取得
app.get('/api/clients', (c) => {
  const clientId = c.req.query('clientId');
  if (!clientId) {
    return c.json({ error: 'clientId is required' }, 400);
  }

  const client = clients.get(clientId);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  // クライアントの最終アクティブ時間を更新
  client.lastActive = Date.now();

  // 自分以外の接続中のクライアントID一覧を返す
  const clientList = Array.from(clients.keys()).filter(id => id !== clientId);
  
  return c.json({
    clients: clientList
  });
});

// メッセージの送信
app.post('/api/messages', async (c) => {
  const body = await c.req.json();
  
  // from と to が必須であることを確認
  if (!body.from || !body.to) {
    return c.json({ error: 'from and to are required' }, 400);
  }
  
  // 送信先のクライアントが存在するか確認
  if (!clients.has(body.to)) {
    return c.json({ error: 'Recipient client not found' }, 404);
  }
  
  const message: Message = {
    ...body,
    timestamp: Date.now()
  };
  
  // 送信先のクライアントのメッセージキューに追加
  if (!messagesByClient.has(message.to)) {
    messagesByClient.set(message.to, []);
  }
  messagesByClient.get(message.to)?.push(message);
  
  return c.json({ success: true });
});

// メッセージの取得（ポーリング用）
app.get('/api/messages', (c) => {
  const clientId = c.req.query('clientId');
  if (!clientId) {
    return c.json({ error: 'clientId is required' }, 400);
  }

  const client = clients.get(clientId);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  // クライアントの最終アクティブ時間を更新
  client.lastActive = Date.now();

  // このクライアント宛てのメッセージを取得
  const clientMessages = messagesByClient.get(clientId) || [];
  
  // メッセージを取得したら、クライアントのメッセージキューをクリア
  messagesByClient.set(clientId, []);

  return c.json(clientMessages);
});

// クライアント切断
app.delete('/api/connect/:clientId', (c) => {
  const clientId = c.req.param('clientId');
  clients.delete(clientId);
  messagesByClient.delete(clientId);

  return c.json({ success: true });
});

// 定期的に非アクティブなクライアントを削除
setInterval(() => {
  const now = Date.now();
  for (const [id, client] of clients.entries()) {
    if (now - client.lastActive > 30000) { // 30秒以上アクティブでない場合
      clients.delete(id);
      messagesByClient.delete(id);
    }
  }
}, 10000);

const port = 8080;
console.log(`サーバー起動: http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});
