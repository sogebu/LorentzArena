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
       * (Legacy) Simple 2D position update.
       * JP: （互換用）単純な2D座標更新。
       */
      type: "position";
      x: number;
      y: number;
    }
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
    };
