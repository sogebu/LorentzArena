import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

const CLIENTS_TABLE_NAME = 'RTCSignalingClients';
const MESSAGES_TABLE_NAME = 'RTCSignalingMessages';

export const app = new Hono();
app.use('/*', cors());

function generateClientId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// クライアント接続
app.post('/api/connect', async (c) => {
  const clientId = generateClientId();
  const client: Client = {
    id: clientId,
    lastActive: Date.now(),
  };

  await docClient.send(
    new PutCommand({
      TableName: CLIENTS_TABLE_NAME,
      Item: client,
    }),
  );

  return c.json({
    type: 'connected',
    payload: { clientId },
  });
});

// 接続中のクライアント一覧を取得
app.get('/api/clients', async (c) => {
  const clientId = c.req.query('clientId');
  if (!clientId) {
    return c.json({ error: 'clientId is required' }, 400);
  }

  // クライアントの存在確認
  const client = await docClient.send(
    new GetCommand({
      TableName: CLIENTS_TABLE_NAME,
      Key: { id: clientId },
    }),
  );

  if (!client.Item) {
    return c.json({ error: 'Client not found' }, 404);
  }

  // クライアントの最終アクティブ時間を更新
  await docClient.send(
    new PutCommand({
      TableName: CLIENTS_TABLE_NAME,
      Item: {
        id: clientId,
        lastActive: Date.now(),
      },
    }),
  );

  // 自分以外の接続中のクライアントID一覧を取得
  const result = await docClient.send(
    new ScanCommand({
      TableName: CLIENTS_TABLE_NAME,
      ProjectionExpression: 'id',
      FilterExpression: 'id <> :clientId',
      ExpressionAttributeValues: {
        ':clientId': clientId,
      },
    }),
  );

  const clientList = (result.Items as { id: string }[]).map((item) => item.id);

  return c.json({
    clients: clientList,
  });
});

// メッセージの送信
app.post('/api/messages', async (c) => {
  const body = await c.req.json();

  if (!body.from || !body.to) {
    return c.json({ error: 'from and to are required' }, 400);
  }

  // 送信先のクライアントが存在するか確認
  const recipient = await docClient.send(
    new GetCommand({
      TableName: CLIENTS_TABLE_NAME,
      Key: { id: body.to },
    }),
  );

  if (!recipient.Item) {
    return c.json({ error: 'Recipient client not found' }, 404);
  }

  const message: Message = {
    ...body,
    timestamp: Date.now(),
  };

  await docClient.send(
    new PutCommand({
      TableName: MESSAGES_TABLE_NAME,
      Item: message,
    }),
  );

  return c.json({ success: true });
});

// メッセージの取得（ポーリング用）
app.get('/api/messages', async (c) => {
  const clientId = c.req.query('clientId');
  if (!clientId) {
    return c.json({ error: 'clientId is required' }, 400);
  }

  const client = await docClient.send(
    new GetCommand({
      TableName: CLIENTS_TABLE_NAME,
      Key: { id: clientId },
    }),
  );

  if (!client.Item) {
    return c.json({ error: 'Client not found' }, 404);
  }

  // クライアントの最終アクティブ時間を更新
  await docClient.send(
    new PutCommand({
      TableName: CLIENTS_TABLE_NAME,
      Item: {
        id: clientId,
        lastActive: Date.now(),
      },
    }),
  );

  // このクライアント宛てのメッセージを取得
  const result = await docClient.send(
    new QueryCommand({
      TableName: MESSAGES_TABLE_NAME,
      KeyConditionExpression: '#to = :to',
      ExpressionAttributeNames: {
        '#to': 'to',
      },
      ExpressionAttributeValues: {
        ':to': clientId,
      },
    }),
  );

  const messages = result.Items as Message[];

  // 取得したメッセージを削除
  if (messages.length > 0) {
    await Promise.all(
      messages.map((message) =>
        docClient.send(
          new DeleteCommand({
            TableName: MESSAGES_TABLE_NAME,
            Key: {
              to: message.to,
              timestamp: message.timestamp,
            },
          }),
        ),
      ),
    );
  }

  return c.json(messages);
});

// クライアント切断
app.delete('/api/connect/:clientId', async (c) => {
  const clientId = c.req.param('clientId');

  // クライアントの削除
  await docClient.send(
    new DeleteCommand({
      TableName: CLIENTS_TABLE_NAME,
      Key: { id: clientId },
    }),
  );

  // クライアント宛ての未読メッセージを削除
  const result = await docClient.send(
    new QueryCommand({
      TableName: MESSAGES_TABLE_NAME,
      KeyConditionExpression: '#to = :to',
      ExpressionAttributeNames: {
        '#to': 'to',
      },
      ExpressionAttributeValues: {
        ':to': clientId,
      },
    }),
  );

  if (result.Items && result.Items.length > 0) {
    await Promise.all(
      (result.Items as Message[]).map((message) =>
        docClient.send(
          new DeleteCommand({
            TableName: MESSAGES_TABLE_NAME,
            Key: {
              to: message.to,
              timestamp: message.timestamp,
            },
          }),
        ),
      ),
    );
  }

  return c.json({ success: true });
});
