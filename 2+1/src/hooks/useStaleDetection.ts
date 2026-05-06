import { useMemo, useRef } from "react";
import { isLighthouse } from "../components/game/lighthouse";
import type { RelativisticPlayer } from "../components/game/types";
import { useGameStore } from "../stores/game-store";

// Bug 11 Stage 8-B (= 2026-05-05 evening direction 対称性 完成版): phaseSpace
// 不到来の early signal 検知。 phaseSpace は 125Hz (= 8ms 間隔) で送信されるため
// 1.5 sec 不到来は 187 frame 連続 loss = 明確な異常。 layer 別最早 signal が
// BH 側に存在しない (= heartbeat / signaling layer は client 側 specific) という
// direction 非対称を埋める根本治療。
//
// false positive 評価:
// - 自分 tab hidden 中: rAF 停止 → useGameLoop の `checkStale` 自体呼ばれない、
//   wake で復帰時に lastUpdate 古い → markStale (= 正しい挙動、 sleep 中の peer
//   連絡途絶を検知)、 phaseSpace 受信で recoverStale、 churn 1 回
// - 通常 packet loss: 1-3 frame (~8-25ms) で 1.5 sec を超えない、 false positive 不発
// - bandwidth congestion: 通常 phaseSpace は priority high で送られるが、 仮に
//   1.5 sec 詰まっても markStale → 復活で recoverStale、 二段防衛 (5 sec wall threshold)
//   は不変
//
// 既存 5 sec wall threshold は eventual safety net として残す (= 完全停止の確認 +
// GC 候補化、 Stage 3 の logic と整合)。
const STALE_EARLY_THRESHOLD = 1500; // 1.5 seconds (= 187 frames @125Hz) → early markStale
const STALE_WALL_THRESHOLD = 5000; // 5 seconds with no phaseSpace update → eventual stale
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
  /**
   * Stale 判定済 peer の単一 source of truth。 Map<peerId, frozenAt wallTime>。
   *
   * - キー集合 = 「現在 stale な peer の集合」 (= 旧 `staleFrozenRef: Set<string>` の役割)
   * - 値 = 「いつ stale 化したか」 (= GC 閾値判定に使用、 旧 `staleFrozenAtRef: Map`)
   *
   * 旧版は Set + Map で同じキー集合を二重保持し、 ad-hoc delete が片方だけ消す事故を
   * 「drift prune ループ」 で self-heal していた (= M25 違反の絆創膏 sign)。 Map 単独
   * 化で構造的に drift 不可避化。
   */
  const staleFrozenAtRef = useRef<Map<string, number>>(new Map());
  const lastUpdateTimeRef = useRef<Map<string, number>>(new Map());
  const lastCoordTimeRef = useRef<
    Map<string, { wallTime: number; posT: number }>
  >(new Map());

  /**
   * Bug 14 完全治療 (2026-05-06 plan: bug14-global-active-time §2.3): peer の active
   * witness 専用 ref。 receiver は `msg.selfActive === true` の broadcast のみ更新する。
   * `useGameLoop` の `peerActive` check (= globalActive 判定) で唯一読まれる。
   *
   * 設計: 既存 `lastUpdateTimeRef` (= 任意 broadcast の wall_clock、 virtualPos /
   * stale 検知用に unconditional 更新) と分離。 `selfActive` で gate すると virtualPos
   * の `lastSync` 経路で overshoot を引き起こすため、 witness 用 ref を別建てして
   * lastUpdateTimeRef の semantic を不変に保つ。
   *
   * 旧 build (= `selfActive` field 不在の broadcast) からの message は msg.selfActive
   * が undefined → `?? true` fallback で active witness 扱い (= mixed build session で
   * 旧仕様互換、 全員新 build 揃った後 mutual amplification convergence 成立)。
   */
  const lastWitnessTimeRef = useRef<Map<string, number>>(new Map());

  /**
   * staleFrozenAtRef を変更した直後に zustand store の `staleFrozenIds` ミラーを同期する。
   * `buildSnapshot` 等の zustand-only コンテキスト (= PeerProvider 周期 broadcast、
   * RelativisticGame ad-hoc sendTo) から stale 集合を読むため。 詳細: game-store.ts
   * の `staleFrozenIds` docstring。
   *
   * **全 mutation 経路 (= checkStale add / recoverStale / cleanupPeer) で必ず呼ぶ**
   * → 旧版の「mutation は ref のみ、 mirror 同期は次 tick の drift detection に任せる」
   * 設計が drift 検知 patch (= M26 absorption sign) を必要としていたが、 mutation 即
   * sync で原理的に drift 不可避化。
   */
  const syncStoreMirror = () => {
    useGameStore
      .getState()
      .setStaleFrozenIds(new Set(staleFrozenAtRef.current.keys()));
  };

  /**
   * 各フレームで呼ぶ。freeze 候補を staleFrozenAtRef に追加し、Stage 3 で GC
   * 閾値を超えた frozen peer の ID を返す。呼び出し側 (useGameLoop) は返値の
   * 各 ID について `removePlayer` + `cleanupPeer` を実行する。
   *
   * `deadIds`: 現在死亡中の player ID 集合 (= `selectDeadPlayerIds(state)`)。
   * 死亡中 player は stale 検知から除外する (= 2026-05-04 isDead 二重管理解消、
   * 旧版は `player.isDead` field を直 read していたが field 撤廃で caller-pass に移行)。
   */
  const checkStale = (
    currentTime: number,
    players: Map<string, RelativisticPlayer>,
    myId: string,
    deadIds: ReadonlySet<string>,
  ): string[] => {
    const gcIds: string[] = [];
    let mutated = false;

    for (const [id, player] of players) {
      if (id === myId) continue;
      if (isLighthouse(id)) continue; // S-1: Lighthouse はホストが進行させるので stale 対象外

      // Stage 3: 既に frozen な peer は GC 閾値を check。freeze 後 STALE_GC_THRESHOLD
      // 経過で GC 候補として return。復帰 (recoverStale) があれば staleFrozenAtRef
      // からクリアされているので、ここでは時刻比較のみ。
      const frozenAt = staleFrozenAtRef.current.get(id);
      if (frozenAt !== undefined) {
        if (currentTime - frozenAt > STALE_GC_THRESHOLD) {
          gcIds.push(id);
        }
        continue;
      }

      if (deadIds.has(id)) continue;

      // (1a) Bug 11 Stage 8-B early signal: phaseSpace 1.5 sec 不到来で即時 markStale
      // (= direction 対称性、 BH 側で client A の disconnect を WebRTC layer 待たずに
      // app 層 timeout で即時検知)。 通常 125Hz 送信で 187 frame 連続 loss は異常、
      // false positive 評価は STALE_EARLY_THRESHOLD docstring 参照。
      const lastUpdate = lastUpdateTimeRef.current.get(id);
      if (lastUpdate && currentTime - lastUpdate > STALE_EARLY_THRESHOLD) {
        staleFrozenAtRef.current.set(id, currentTime);
        mutated = true;
        continue;
      }

      // (1b) Wall-clock eventual safety net: 5 sec 経っても更新無し → 完全停止確認、
      // GC 候補化。 通常は (1a) early threshold で先に markStale されているため
      // この path は 1.5-5 sec の間に lastUpdate が更新されたが再び止まったケース等
      // edge case で発火、 二段防衛として残す。 GC threshold (15 sec) は frozenAt から計測。
      if (lastUpdate && currentTime - lastUpdate > STALE_WALL_THRESHOLD) {
        staleFrozenAtRef.current.set(id, currentTime);
        mutated = true;
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
            staleFrozenAtRef.current.set(id, currentTime);
            mutated = true;
          }
        }
      }
    }

    if (mutated) syncStoreMirror();
    return gcIds;
  };

  /**
   * peer が再活性化したことを通知。 stale 集合からクリア + lastCoordTimeRef リセット
   * (= S-4: 即座再 stale 判定を防ぐため baseline をクリア、 次 phaseSpace 受信で再開)。
   * 冪等 (= 既に非 stale な peer に対しては no-op + sync skip)。
   *
   * 旧 ad-hoc 経路 (= messageHandler / RelativisticGame / useGameLoop §self-kill が
   * `staleFrozenRef.current.delete(id)` を直呼び) は本関数経由に統一済 (2026-05-04)。
   */
  const recoverStale = (playerId: string) => {
    const had = staleFrozenAtRef.current.delete(playerId);
    lastCoordTimeRef.current.delete(playerId);
    if (had) syncStoreMirror();
  };

  /**
   * peer の disconnect を **即時** stale 認定する (= `recoverStale` の対称形)。
   *
   * **動機**: `checkStale` の wall threshold (5 秒) と useGameLoop の Fix B cap
   * (`MAX_VIRTUAL_TAU_SEC = 2`) の間に **3 秒 unprotected window** が存在し、
   * peer が消えてから 2..5 秒の間 Rule B (因果律跳躍) が両側で永続発火 →
   * frozenWorldLines mount storm を起こす (= Bug 11 H1 の真因)。 disconnect
   * を検出した瞬間に `markStale` を呼べば窓を ms オーダーに圧縮できる。
   *
   * **caller**: WebRTC connection の close 検知 (= `RelativisticGame.tsx` の
   * connection drop loop で `onConnectionChange` diff から削除 peerId を抽出)。
   * heartbeat timeout 経路は **conn.close と並行して発火する**ため redundant、
   * 本 hook では呼ばない (= conn.close 単一経路で markStale)。
   *
   * **冪等**: 既に stale な peer に対しては no-op (= sync skip)。
   *
   * **思想 doc**: [`design/network-recovery.md`](../../design/network-recovery.md)
   * 軸 2 (per-peer view 軸) + 軸 3 H1 + §3.5 (3 秒 unprotected window の数学)。
   */
  const markStale = (playerId: string, currentTime?: number) => {
    if (staleFrozenAtRef.current.has(playerId)) return;
    staleFrozenAtRef.current.set(playerId, currentTime ?? Date.now());
    syncStoreMirror();
  };

  // 単一 peer の stale 関連 ref をまとめて purge。grace period 付き peer removal
  // (RelativisticGame の PEER_REMOVAL_GRACE_MS) で setTimeout 発火時、Stage 3 GC
  // 発火時の両方で使う。
  const cleanupPeer = (playerId: string) => {
    const had = staleFrozenAtRef.current.delete(playerId);
    lastUpdateTimeRef.current.delete(playerId);
    lastCoordTimeRef.current.delete(playerId);
    lastWitnessTimeRef.current.delete(playerId);
    if (had) syncStoreMirror();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: all values are stable refs or closures over refs — never change
  return useMemo(
    () => ({
      staleFrozenAtRef,
      lastUpdateTimeRef,
      lastCoordTimeRef,
      lastWitnessTimeRef,
      checkStale,
      recoverStale,
      markStale,
      cleanupPeer,
    }),
    [],
  );
}
