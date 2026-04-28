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
       *
       * `heading` / `alpha` are optional for backward compat during the
       * 2026-04-21 migration (plan `2026-04-21-phaseSpace-heading-accel.md`).
       * Old clients omit them; receivers default to identity quat / zero 4-accel.
       *
       * JP: 相対論的状態（4元位置 + 3元速度 + 姿勢 + 4元加速度）の更新。
       * heading / alpha は backward compat のため optional、欠落時は identity / zero。
       */
      type: "phaseSpace";
      /**
       * Sender peer id.
       * JP: 送信者の peer id。
       */
      senderId: string;
      position: { t: number; x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      heading?: { w: number; x: number; y: number; z: number };
      alpha?: { t: number; x: number; y: number; z: number };
    }
  | {
      /**
       * A list of currently connected peers.
       * JP: 現在接続されている peer id の一覧。
       */
      type: "peerList";
      peers: string[];
      joinRegistry?: string[];
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
       * Phase C1 damage event. Target-authoritative: only the victim's owner
       * (target self for humans, beacon holder for LH) broadcasts. Lethal hits
       * still emit a separate `kill` message after handleDamage detects death.
       *
       * JP: 被弾イベント。victim の owner が発信 (人間は自分、LH はビーコン保持者)。
       * 致命的 hit (energy < 0) のときは別途 `kill` も続けて送信される。
       */
      type: "hit";
      victimId: string;
      killerId: string;
      hitPos: { t: number; x: number; y: number; z: number };
      damage: number;
      /**
       * Laser direction 3-vector (unit, c=1). Used by receiver to build the
       * hit-debris scatter axis via spacetime 4-vector sum with victim's u.
       */
      laserDir: { x: number; y: number; z: number };
    }
  | {
      /**
       * Respawn command from host.
       * JP: ホストからのリスポーン指示。
       *
       * `u`: optional 4-velocity 空間成分 (= γ·v)。 stale 復帰の ballistic 経路で凍結時 u
       * を継承するために同梱。 死亡 → 復活の通常経路では省略 (= 受信側で u=0 静止)。
       */
      type: "respawn";
      playerId: string;
      position: { t: number; x: number; y: number; z: number };
      u?: { x: number; y: number; z: number };
    }
  | {
      /**
       * Heartbeat from host to clients.
       * Sent periodically so clients can detect host disconnection quickly,
       * without waiting for the slow WebRTC ICE timeout.
       *
       * `peerOrder` piggybacks the host's latest view of connected non-host
       * peers. Clients use it to keep `peerOrderRef` fresh (≤1s stale)
       * without depending on the rarer `peerList` broadcasts, so that when
       * the host dies all surviving clients run the migration election on
       * an identical list — preventing split-brain and dead-candidate waits.
       *
       * JP: ホスト→クライアントのハートビート。
       * ping に host 視点の最新 peerOrder を相乗りさせ、client 側の
       * peerOrderRef を ≤1s 精度で同期する。host 死亡直後の election が
       * 全 client で同一リストに対して走り、split 及び死 candidate 待機を防ぐ。
       */
      type: "ping";
      peerOrder?: string[];
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
    }
  | {
      /**
       * Redirect from beacon to actual host.
       * The beacon holds the room's discoverable ID (la-{roomName})
       * and tells new clients where the real host is.
       *
       * JP: ビーコンからのリダイレクト。
       * ビーコンはルーム発見用 ID を保持し、新クライアントに本当のホスト ID を通知。
       */
      type: "redirect";
      hostId: string;
    }
  | {
      /**
       * Full-state snapshot sent by the beacon holder (= host) to a newly
       * joined peer. Supersedes `syncTime` + `hostMigration` for new-joiner
       * initialization (Authority 解体 Stage F).
       *
       * Existing peers do NOT receive snapshot — their state is already
       * self-maintained from the event log (killLog / respawnLog).
       *
       * JP: beacon holder が新規 join peer 1 人に送る state 一式。
       * 既存 peer は受け取らない（event log から自己維持）。
       */
      type: "snapshot";
      /** Host の座標時間 (新 peer の OFFSET 計算に使用、元 syncTime.hostTime) */
      hostTime: number;
      scores: Record<string, number>;
      displayNames: Record<string, string>;
      /** killLog 全件 (GC 済みなので通常は短い) */
      killLog: Array<{
        victimId: string;
        killerId: string;
        hitPos: { t: number; x: number; y: number; z: number };
        wallTime: number;
        victimName: string;
        victimColor: string;
        firedForUi: boolean;
      }>;
      /** respawnLog 全件 (latest 1/player のみ) */
      respawnLog: Array<{
        playerId: string;
        position: { t: number; x: number; y: number; z: number };
        wallTime: number;
      }>;
      /** 各プレイヤー (自機以外) の完全 state */
      players: Array<{
        id: string;
        ownerId: string;
        color: string;
        displayName?: string;
        isDead: boolean;
        /**
         * Phase C1 (damage model): 被弾時に減算される共有プール。
         * 初期値 ENERGY_MAX=1.0、fire/thrust/damage で消費。LH は damage のみ消費 (回復なし)。
         * 旧バージョンとの互換のため optional (受信側は未定義時 ENERGY_MAX でフォールバック)。
         */
        energy?: number;
        /**
         * `heading` / `alpha` は 2026-04-21 migration で追加、旧 build との
         * backward compat のため optional。欠落時は identity / zero 補完。
         */
        phaseSpace: {
          pos: { t: number; x: number; y: number; z: number };
          u: { x: number; y: number; z: number };
          heading?: { w: number; x: number; y: number; z: number };
          alpha?: { t: number; x: number; y: number; z: number };
        };
        worldLineHistory: Array<{
          pos: { t: number; x: number; y: number; z: number };
          u: { x: number; y: number; z: number };
          heading?: { w: number; x: number; y: number; z: number };
          alpha?: { t: number; x: number; y: number; z: number };
        }>;
        worldLineOrigin: {
          pos: { t: number; x: number; y: number; z: number };
          u: { x: number; y: number; z: number };
          heading?: { w: number; x: number; y: number; z: number };
          alpha?: { t: number; x: number; y: number; z: number };
        } | null;
      }>;
    }
  | {
      /**
       * Pull-based snapshot retry from a newly joined client.
       * Sent when the client detects it has no state (players.get(myId) is
       * undefined) a few seconds after connecting — likely the host's
       * diff-triggered push lost a race (message handler registered late,
       * packet dropped, etc). Host responds with a fresh snapshot.
       *
       * JP: 新規 join client が state 未受信のまま数秒経過したときの pull。
       * host 側の push が race で落ちた場合の保険。host が snapshot で返答。
       */
      type: "snapshotRequest";
    };
