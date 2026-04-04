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
  {
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
       * Color assignment from host (ensures all clients see same colors).
       * JP: ホストからの色割り当て（全クライアントで色を統一）。
       */
      type: "playerColor";
      playerId: string;
      color: string;
    };
