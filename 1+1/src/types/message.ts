/**
 * Network messages exchanged via PeerJS (WebRTC data channels).
 *
 * English:
 *   - Messages are small JSON payloads.
 *   - Keep them versioned/compatible if you plan to deploy clients separately.
 *
 * 日本語:
 *   - 通信は小さな JSON メッセージで行います。
 *   - 別々にデプロイする場合は後方互換（バージョニング）を意識すると安全です。
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
      position: { t: number; x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
    }
  | {
      /**
       * A list of currently connected peers.
       *
       * English: In the root app we use this to build a mesh.
       * 日本語: root アプリではメッシュ接続を組むために使います。
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
    };
