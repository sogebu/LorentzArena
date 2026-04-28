import { useMemo, useRef } from "react";
import { isLighthouse } from "../components/game/lighthouse";
import type { RelativisticPlayer } from "../components/game/types";
import { useGameStore } from "../stores/game-store";

const STALE_WALL_THRESHOLD = 5000; // 5 seconds with no phaseSpace update → stale
const STALE_RATE_WINDOW = 3000; // 3 second window for rate calculation
const STALE_MIN_RATE = 0.1; // coordinate time must advance at least 10% of wall time
// Stage 3 (2026-04-21): freeze 後さらに GC_THRESHOLD ms 更新が無ければ players から
// 完全削除する。client (star topology で他 peer に直接接続していない peer) は自身の
// connection drop を検知できず、Stage 1.5 の「local 保護」が切断 peer を永久に存続
// させる (Bug X)。freeze(5s) + GC(15s) = 計 20s 無通信で removePlayer → 次 snapshot
// から対象 peer が外れて全 peer で eventual consistency が達成される。
// 値 15000 の根拠: migration (~2.5-5s) + 余裕、一時的 network blip (<10s) ではパージ
// せず、真に死んだ peer は 20s 以内に消える。BH は PEER_REMOVAL_GRACE_MS=3000 の
// 直接 connection drop 経路が先に走るので、実害的に stale GC に到達するのは client
// 観測の他 peer 残留ケース。
const STALE_GC_THRESHOLD = 15000;

export function useStaleDetection() {
  const staleFrozenRef = useRef<Set<string>>(new Set());
  const lastUpdateTimeRef = useRef<Map<string, number>>(new Map());
  const lastCoordTimeRef = useRef<
    Map<string, { wallTime: number; posT: number }>
  >(new Map());
  // Stage 3: freeze が発生した wallTime を記録、GC threshold 判定に使う。
  // staleFrozenRef と常に同じキー集合を保つ (add/delete を同期)。
  const staleFrozenAtRef = useRef<Map<string, number>>(new Map());

  /**
   * staleFrozenRef を変更した直後に zustand store の `staleFrozenIds` ミラーを同期する。
   * `buildSnapshot` 等の zustand-only コンテキスト (PeerProvider 周期 broadcast 等) から
   * stale 集合を読むため。 詳細: game-store.ts の `staleFrozenIds` docstring。
   */
  const syncStoreMirror = () => {
    useGameStore.getState().setStaleFrozenIds(new Set(staleFrozenRef.current));
  };

  /**
   * 各フレームで呼ぶ。freeze 候補を staleFrozenRef に追加し、Stage 3 で GC
   * 閾値を超えた frozen peer の ID を返す。呼び出し側 (useGameLoop) は返値の
   * 各 ID について `removePlayer` + `cleanupPeer` を実行する。
   */
  const checkStale = (
    currentTime: number,
    players: Map<string, RelativisticPlayer>,
    myId: string,
  ): string[] => {
    // Drift prune: 外部の ad-hoc `staleFrozenRef.current.delete(id)` call
    // (messageHandler §stale revival / respawn / kill、RelativisticGame §LH init、
    // useGameLoop §self-kill) は staleFrozenAtRef を clear しない。放置すると小さな
    // leak になる (GC check は staleFrozenRef 膜で guard するので機能的に無害だが、
    // 死んだ entry が残る)。毎 tick で O(n) で self-heal する。peer 数は小 (<10)
    // なので cost 無視できる。
    if (staleFrozenAtRef.current.size > staleFrozenRef.current.size) {
      for (const id of staleFrozenAtRef.current.keys()) {
        if (!staleFrozenRef.current.has(id)) {
          staleFrozenAtRef.current.delete(id);
        }
      }
    }

    const gcIds: string[] = [];
    for (const [id, player] of players) {
      if (id === myId) continue;
      if (isLighthouse(id)) continue; // S-1: Lighthouse はホストが進行させるので stale 対象外

      // Stage 3: 既に frozen な peer は GC 閾値を check。freeze 後 STALE_GC_THRESHOLD
      // 経過で GC 候補として return。復帰 (recoverStale) があれば staleFrozenRef +
      // staleFrozenAtRef 両方からクリアされているので、ここでは比較のみ。
      if (staleFrozenRef.current.has(id)) {
        const frozenAt = staleFrozenAtRef.current.get(id);
        if (
          frozenAt !== undefined &&
          currentTime - frozenAt > STALE_GC_THRESHOLD
        ) {
          gcIds.push(id);
        }
        continue;
      }

      if (player.isDead) continue;

      // (1) Wall-clock based: no phaseSpace update for 5 seconds
      const lastUpdate = lastUpdateTimeRef.current.get(id);
      if (lastUpdate && currentTime - lastUpdate > STALE_WALL_THRESHOLD) {
        staleFrozenRef.current.add(id);
        staleFrozenAtRef.current.set(id, currentTime);
        continue;
      }

      // (2) Coordinate time rate: phaseSpace arrives but coord time barely advances (tab throttle)
      const coordRecord = lastCoordTimeRef.current.get(id);
      if (coordRecord) {
        const wallElapsed = currentTime - coordRecord.wallTime;
        if (wallElapsed > STALE_RATE_WINDOW) {
          const coordElapsed = player.phaseSpace.pos.t - coordRecord.posT;
          const rate = coordElapsed / (wallElapsed / 1000);
          if (rate < STALE_MIN_RATE) {
            staleFrozenRef.current.add(id);
            staleFrozenAtRef.current.set(id, currentTime);
          }
        }
      }
    }
    // 本 tick で staleFrozenRef.current が変わったか、 外部の ad-hoc delete (messageHandler /
     // RelativisticGame / useGameLoop §self-kill が staleFrozenRef.current.delete を直接
     // 呼ぶ) で store mirror が drift していたら同期。 毎 tick の O(n) compare、 peer 数は
     // 小 (<10) なので cost 無視できる。
     const stored = useGameStore.getState().staleFrozenIds;
     const cur = staleFrozenRef.current;
     let drifted = cur.size !== stored.size;
     if (!drifted) {
       for (const id of cur) {
         if (!stored.has(id)) {
           drifted = true;
           break;
         }
       }
     }
     if (drifted) syncStoreMirror();
    return gcIds;
  };

  const recoverStale = (playerId: string) => {
    staleFrozenRef.current.delete(playerId);
    staleFrozenAtRef.current.delete(playerId);
    // S-4: リセットして即座再 stale を防止
    lastCoordTimeRef.current.delete(playerId);
    // store mirror は次の checkStale 呼び出しで drift 検出されて同期される。
    // ここで明示的に同期しないのは、 ad-hoc delete 経路 (messageHandler / RelativisticGame /
    // useGameLoop §self-kill が staleFrozenRef.current.delete を直接呼ぶ) と統一して
    // 「ref 変更後の同期は checkStale tick に任せる」 設計にしたいため。
  };

  // 単一 peer の stale 関連 ref をまとめて purge。grace period 付き peer removal
  // (RelativisticGame の PEER_REMOVAL_GRACE_MS) で setTimeout 発火時、Stage 3 GC
  // 発火時の両方で使う。
  const cleanupPeer = (playerId: string) => {
    staleFrozenRef.current.delete(playerId);
    staleFrozenAtRef.current.delete(playerId);
    lastUpdateTimeRef.current.delete(playerId);
    lastCoordTimeRef.current.delete(playerId);
    // store mirror は次 checkStale で同期。 上記 recoverStale と同じ理由。
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: all values are stable refs or closures over refs — never change
  return useMemo(
    () => ({
      staleFrozenRef,
      lastUpdateTimeRef,
      lastCoordTimeRef,
      checkStale,
      recoverStale,
      cleanupPeer,
    }),
    [],
  );
}
