/**
 * Network messages exchanged via PeerJS (WebRTC data channels).
 *
 * English:
 *   - 2+1 app uses a host-relay model: clients send to host, host forwards to others.
 *   - Messages are JSON and should be kept reasonably small.
 *
 * 日本語:
 *   - 2+1 アプリはホスト中継型: クライアント→ホスト、ホストが他の参加者へ転送。
 *   - メッセージは JSON。大きくしすぎないのが吉です。
 */
export type Message =
  | {
      /**
       * Relativistic state update: 4-position and 3-velocity.
       * JP: 相対論的状態（4元位置 + 3元速度）の更新。
       */
      type: "phaseSpace";
      /**
       * Sender peer id.
       * JP: 送信者の peer id。
       */
      senderId: string;
      position: { t: number; x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
    }
  | {
      /**
       * A list of currently connected peers.
       * JP: 現在接続されている peer id の一覧。
       */
      type: "peerList";
      peers: string[];
    }
  | {
      /**
       * Request a peer list from the host.
       * JP: ホストに peerList を要求する。
       */
      type: "requestPeerList";
    }
  | {
      /**
       * Time synchronization from host to newly connected client.
       * JP: ホストから新規クライアントへの世界系時刻同期。
       */
      type: "syncTime";
      hostTime: number;
      scores?: Record<string, number>;
      displayName?: string;
    }
  | {
      /**
       * Laser shot event.
       *
       * English: emitted by a player and forwarded by the host.
       * 日本語: プレイヤーが発射し、ホストが中継するイベント。
       */
      type: "laser";
      id: string;
      playerId: string;
      emissionPos: { t: number; x: number; y: number; z: number };
      direction: { x: number; y: number; z: number };
      range: number;
      color: string;
    }
  | {
      /**
       * Kill notification from host.
       * JP: ホストからのキル通知。
       */
      type: "kill";
      victimId: string;
      killerId: string;
      hitPos: { t: number; x: number; y: number; z: number };
    }
  | {
      /**
       * Respawn command from host.
       * JP: ホストからのリスポーン指示。
       */
      type: "respawn";
      playerId: string;
      position: { t: number; x: number; y: number; z: number };
    }
  | {
      /**
       * Score update from host.
       * JP: ホストからのスコア更新。
       */
      type: "score";
      scores: Record<string, number>;
    }
  | {
      /**
       * Heartbeat from host to clients.
       * Sent periodically so clients can detect host disconnection quickly,
       * without waiting for the slow WebRTC ICE timeout.
       *
       * JP: ホストからクライアントへのハートビート。
       * WebRTC の ICE タイムアウト（30秒以上）を待たずにホスト切断を検知するために使用。
       */
      type: "ping";
    }
  | {
      /**
       * Host migration: new host announces itself and transfers game state.
       * Sent by the newly elected host to all clients after the previous host disconnects.
       *
       * JP: ホストマイグレーション: 新ホストがゲーム状態を引き継いで全クライアントに通知。
       * 前ホスト切断後、選出された新ホストが送信。
       */
      type: "hostMigration";
      newHostId: string;
      scores: Record<string, number>;
      deadPlayers: Array<{ playerId: string; deathTime: number }>;
      displayNames?: Record<string, string>;
    }
  | {
      /**
       * Player introduction: display name announcement.
       * Sent once on connection. Host relays to all peers.
       *
       * JP: プレイヤー自己紹介: 表示名の通知。
       * 接続時に 1 回送信。ホストが全ピアにリレー。
       */
      type: "intro";
      senderId: string;
      displayName: string;
    };
