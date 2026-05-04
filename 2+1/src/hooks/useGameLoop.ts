import {
  type MutableRefObject,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import {
  firePendingKillEvents,
  firePendingSpawnEvents,
} from "../components/game/causalEvents";
import {
  ARENA_HALF_WIDTH,
  DEBRIS_GC_GAMMA_BOUND,
  DEBRIS_MAX_LAMBDA,
  DEFAULT_CAMERA_PITCH,
  ENERGY_MAX,
  ENERGY_PER_SHOT,
  ENERGY_RECOVERY_RATE,
  GAME_LOOP_INTERVAL,
  GC_PAST_LCH_MULTIPLIER,
  HIT_DAMAGE,
  HIT_DEBRIS_MAX_LAMBDA,
  LASER_RANGE,
  LIGHT_CONE_HEIGHT,
  LIGHTHOUSE_HIT_DAMAGE,
  MAX_LASERS,
  MAX_WORLDLINE_HISTORY,
  PROCESSED_LASERS_CLEANUP_THRESHOLD,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
} from "../components/game/constants";
import { causalityJumpLambda } from "../components/game/causalityRules";
import {
  checkCausalFreeze,
  processCamera,
  processHitDetection,
  processLaserFiring,
  processLighthouseAI,
  processPlayerPhysics,
} from "../components/game/gameLoop";
import { isLighthouse } from "../components/game/lighthouse";
import { createRespawnPosition } from "../components/game/respawnTime";
import type { useTouchInput } from "../components/game/touchInput";
import type { Laser, RelativisticPlayer } from "../components/game/types";
import { virtualPos } from "../components/game/virtualWorldLine";
import {
  isLargeJump,
  pushFrozenWorldLine,
} from "../components/game/worldLineGap";
import type { NetworkManager } from "../contexts/PeerProvider";
import {
  appendWorldLine,
  type createPhaseSpace,
  createWorldLine,
  displayPos,
  gamma,
  type Vector3,
  type Vector4,
  vector3Zero,
  yawToQuat,
} from "../physics";
import {
  gcLogs,
  selectDeadPlayerIds,
  selectInvincibleIds,
  selectIsDead,
  useGameStore,
} from "../stores/game-store";
import type { Message } from "../types/message";
import type { useStaleDetection } from "./useStaleDetection";

// --- Types ---

export interface GameLoopDeps {
  peerManager: NetworkManager | null;
  myId: string | null;
  getPlayerColor: (id: string) => string;

  // Local UI setters (transient, kept local for perf)
  setFps: React.Dispatch<React.SetStateAction<number>>;
  setEnergy: React.Dispatch<React.SetStateAction<number>>;
  setIsFiring: React.Dispatch<React.SetStateAction<boolean>>;
  setDeathFlash: React.Dispatch<React.SetStateAction<boolean>>;

  // Per-frame local refs (shared with SceneContent)
  // headingYawRef: heading の source of truth。classic では矢印で連続旋回、shooter では
  //   WASD screen-relative の atan2 + camera basis で決まる。phaseSpace.heading に毎 tick 同期。
  // cameraYawRef: shooter mode の camera yaw offset。矢印キーで連続旋回 (camera が機体周りで回る)。
  //   shooter の WASD interpretation の basis にも使う (= screen-relative が camera 追従)。
  //   classic mode では未使用 (camera = headingYawRef)。
  headingYawRef: MutableRefObject<number>;
  cameraYawRef: MutableRefObject<number>;
  cameraPitchRef: MutableRefObject<number>;
  /** 自機の最新 thrust 加速度 (world coords、friction 除外)。
   *  exhaust 描画用、毎 tick 更新。死亡中・frozen・非入力時はゼロベクトル。 */
  thrustAccelRef: MutableRefObject<Vector3>;

  // Owned by RelativisticGame (useRef). Used here for non-self (LH) respawn
  // setTimeout that we add on hit detection and clear on effect teardown.
  respawnTimeoutsRef: RefObject<Set<ReturnType<typeof setTimeout>>>;

  // Input (refs, stable references)
  keysPressed: RefObject<Set<string>>;
  touchInput: ReturnType<typeof useTouchInput>;

  // Stale detection (standalone hook)
  stale: ReturnType<typeof useStaleDetection>;
}

// --- Hook ---

/**
 * Dependency stability analysis:
 * - Store: read via useGameStore.getState() — always fresh, O(1)
 * - Refs: stable object, read via .current — always fresh
 * - React setState: React guarantees stable reference
 * - peerManager/myId: can transition null → value — must be in deps
 */
export function useGameLoop({
  peerManager,
  myId,
  getPlayerColor,
  setFps,
  setEnergy,
  setIsFiring,
  setDeathFlash,
  headingYawRef,
  cameraYawRef,
  cameraPitchRef,
  thrustAccelRef,
  respawnTimeoutsRef,
  keysPressed,
  touchInput,
  stale,
}: GameLoopDeps): void {
  const lastTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Internal refs (previously in RelativisticGame, now local to the game loop)
  const causalFrozenRef = useRef<boolean>(false);
  const lastLaserTimeRef = useRef<number>(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  // Phase C1: energy は store.players[myId].energy に移行。handleDamage と
  // 共有プールになるため、ローカル ref は持たない (between-tick でのみ store が
  // 変更されるので tick 開始時に読んで末尾に commit する方式)。

  // Track myDeathEvent transitions (for camera/energy reset on respawn)
  const prevMyDeathEventRef = useRef<unknown>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: see stability analysis above — all other deps are refs or stable callbacks
  useEffect(() => {
    if (!peerManager || !myId) return;

    /** Send a message to the network: host broadcasts, client sends to host. */
    const sendToNetwork = (msg: Message) => {
      if (peerManager.getIsBeaconHolder()) {
        peerManager.send(msg);
      } else {
        const hostId = peerManager.getBeaconHolderId();
        if (hostId) peerManager.sendTo(hostId, msg);
      }
    };

    const gameLoop = () => {
      // hidden 中は game loop を skip。 lastTimeRef は **毎 throttle tick で current に更新**
      // して復帰時の dτ を最後の throttle tick 以降の小値に抑える (= 旧実装は lastTimeRef
      // を fresh 化せず復帰時 dτ が hidden 全体 = 巨大値になり ballistic catchup branch が
      // 必要だった)。 復帰後の convoy 合流は Stage 5 の Rule B が毎 tick 評価で処理する
      // (= λ_exit max まで forward jump、 大 λ なら worldLine 凍結 + 新セグメント)。
      // 詳細: plans/2026-05-02-causality-symmetric-jump.md §6 Stage 6 +
      // design/state-ui.md:156。
      if (document.hidden) {
        lastTimeRef.current = Date.now();
        return;
      }

      const currentTime = Date.now();
      const dTau = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;

      const store = useGameStore.getState();

      // --- Detect myDeathEvent transitions for local ref resets ---
      const currentMyDeathEvent = store.myDeathEvent;
      if (
        prevMyDeathEventRef.current !== null &&
        currentMyDeathEvent === null
      ) {
        // non-null → null: self-respawn just happened → reset camera refs.
        // energy は handleSpawn が ENERGY_MAX にリセット済 (store 側で一元管理)。
        headingYawRef.current = 0;
        cameraYawRef.current = 0;
        cameraPitchRef.current = DEFAULT_CAMERA_PITCH;
      }
      // null → non-null: self-death。ghost phaseSpace は handleKill 内で
      // 死亡時 phaseSpace から初期化されているため、ここでの特別リセットは不要。
      prevMyDeathEventRef.current = currentMyDeathEvent;

      // Phase C1: tick 開始時に store から energy を読む (between-tick で
      // handleDamage / handleSpawn が変更した最新値)。tick 内では local
      // `energy` を通じて計算し、末尾で commit する。
      let energy = store.players.get(myId)?.energy ?? ENERGY_MAX;

      // --- Cleanup ---
      store.setSpawns((prev) => {
        const alive = prev.filter(
          (e) => currentTime - e.startTime < SPAWN_EFFECT_DURATION,
        );
        return alive.length === prev.length ? prev : alive;
      });

      const myT = store.players.get(myId)?.phaseSpace.pos.t;
      if (myT !== undefined && store.lasers.length > 0) {
        const cutoff = myT - LASER_RANGE * 2;
        store.setLasers((prev) => {
          const alive = prev.filter((l) => l.emissionPos.t + l.range > cutoff);
          return alive.length === prev.length ? prev : alive;
        });
      }

      // --- FPS ---
      const now = performance.now();
      fpsRef.current.frameCount++;
      const elapsed = now - fpsRef.current.lastTime;
      if (elapsed >= 1000) {
        setFps(Math.round((fpsRef.current.frameCount * 1000) / elapsed));
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }

      // --- Camera / 矢印キーによる yaw 操作 ---
      // controlScheme で yaw 回転先が変わる:
      //   legacy_classic: 矢印 ←/→ → headingYawRef、camera は heading 追従 (cameraYawRef = headingYawRef)
      //   legacy_shooter: 矢印 ←/→ → cameraYawRef のみ (camera が機体周りを回る)、heading は WASD 即時スナップ
      //   modern:        矢印 ←/→ → headingYawRef、camera は world basis 固定 (cameraYawRef = 0)
      const touch = touchInput.current;
      const isDeadForCamera = store.players.get(myId)?.isDead ?? false;
      const controlScheme = store.controlScheme;
      const yawSourceBefore =
        controlScheme === "legacy_shooter"
          ? cameraYawRef.current
          : headingYawRef.current;
      const cam = processCamera(
        keysPressed.current,
        touch,
        dTau,
        { yaw: yawSourceBefore, pitch: cameraPitchRef.current },
        isDeadForCamera,
      );
      cameraPitchRef.current = cam.pitch;
      if (controlScheme === "legacy_classic") {
        headingYawRef.current = cam.yaw;
        cameraYawRef.current = cam.yaw; // camera = heading 同期
      } else if (controlScheme === "legacy_shooter") {
        cameraYawRef.current = cam.yaw;
        // heading は WASD で processPlayerPhysics 内で更新される
      } else {
        // modern
        headingYawRef.current = cam.yaw;
        cameraYawRef.current = 0;
      }
      touch.yawDelta = 0;
      // pitch は touch で制御しない (processCamera 内の pitch 処理削除済み)。
      // pitchDelta を毎 tick リセットして蓄積を防ぐ。
      touch.pitchDelta = 0;

      // --- Causal events ---
      // **PBC wrap pattern**: causalEvents は内部で observer / event を `displayPos` で
      // (0,0) cell に折り畳み、 観測者周りの `(2R+1)²` image cells loop で past cone 判定。
      // 観測者本人 cell image (= cell.kx=0, cell.ky=0) が必ず最短距離で primary fire
      // (score 加算 / death flash / kill notification trigger)。 隣接 image fire は echo
      // のみ。 観測者跨ぎ越し問題は wrap で原理的に発生しない (= obsCell 計算不要)。
      // 詳細: causalEvents.ts の docstring。
      const myPos = store.players.get(myId)?.phaseSpace.pos;
      const causalTorusHalfWidth =
        store.boundaryMode === "torus" ? ARENA_HALF_WIDTH : undefined;
      if (myPos && store.killLog.some((e) => !e.firedForUi)) {
        const result = firePendingKillEvents(
          store.killLog,
          myPos,
          myId,
          store.scores,
          causalTorusHalfWidth,
          LIGHT_CONE_HEIGHT,
        );
        if (result.firedIndices.length > 0) {
          const firedSet = new Set(result.firedIndices);
          // R に応じた total image cells 数を計算。 open_cylinder mode は R=0 → 1 cell
          // (= primary のみ) で従来挙動と等価。
          const totalCells =
            causalTorusHalfWidth === undefined
              ? 1
              : (() => {
                  const R = Math.ceil(
                    LIGHT_CONE_HEIGHT / (2 * causalTorusHalfWidth),
                  );
                  return (2 * R + 1) ** 2;
                })();
          const nextLog = store.killLog.map((e, i) => {
            if (!firedSet.has(i)) return e;
            const merged =
              result.firedImageCellsByIndex.get(i) ?? e.firedImageCells;
            return {
              ...e,
              firedImageCells: merged,
              firedForUi: merged.length >= totalCells,
            };
          });
          useGameStore.setState({
            killLog: nextLog,
            scores: { ...result.newScores },
          });

          if (result.effects.deathFlash) {
            setDeathFlash(true);
            setTimeout(() => setDeathFlash(false), 600);
          }
          if (result.effects.killNotification) {
            useGameStore.setState({
              killNotification: result.effects.killNotification,
            });
            setTimeout(
              () => useGameStore.setState({ killNotification: null }),
              1500,
            );
          }
        }
      }

      if (myPos && store.pendingSpawnEvents.length > 0) {
        const result = firePendingSpawnEvents(
          store.pendingSpawnEvents,
          myPos,
          Date.now(),
          store.players,
          causalTorusHalfWidth,
          LIGHT_CONE_HEIGHT,
        );
        if (result.firedSpawns.length > 0) {
          useGameStore.setState({ pendingSpawnEvents: result.remaining });
          useGameStore
            .getState()
            .setSpawns((prev) => [...prev, ...result.firedSpawns]);
        }
      }

      // --- Laser firing + energy ---
      const isDead = store.players.get(myId)?.isDead ?? false;
      const wantsFire =
        !isDead && (keysPressed.current.has(" ") || touch.firing);
      const myPlayer = store.players.get(myId);

      if (myPlayer && !isDead) {
        const laserResult = processLaserFiring(
          myPlayer,
          myId,
          headingYawRef.current,
          currentTime,
          energy,
          lastLaserTimeRef.current,
          wantsFire,
        );

        if (laserResult.laser) {
          lastLaserTimeRef.current = currentTime;
          energy = laserResult.newEnergy;

          store.setLasers((prev) => {
            const updated = [...prev, laserResult.laser as Laser];
            return updated.length > MAX_LASERS
              ? updated.slice(updated.length - MAX_LASERS)
              : updated;
          });

          sendToNetwork({ type: "laser" as const, ...laserResult.laser });
        }
      }

      // Energy recovery は physics (thrust 消費) 後に回す。ここでは setIsFiring だけ先に反映。
      setIsFiring(wantsFire && energy >= ENERGY_PER_SHOT);

      // S-5: stale 検知は死亡中も走らせる（他プレイヤーの stale を検知するため）
      // Stage 3 (2026-04-21): freeze 後 STALE_GC_THRESHOLD 経過した peer を
      // players から完全削除する。client は他 peer への直接 connection が無く
      // (star topology)、RelativisticGame の PEER_REMOVAL_GRACE_MS 経路が発動
      // しないため、Stage 1.5 peer-contributive snapshot の local 保護が切断
      // peer を永久存続させていた (Bug X resurrection)。freeze(5s) + GC(15s) =
      // 計 20s 無通信で removePlayer → 次 snapshot から対象が外れて全 peer が
      // eventual consistency に収束する。cleanupPeer で stale ref 一式 purge。
      const gcIds = stale.checkStale(currentTime, store.players, myId);
      if (gcIds.length > 0) {
        for (const id of gcIds) {
          store.removePlayer(id);
          stale.cleanupPeer(id);
        }
      }

      // --- Ghost or physics ---
      // Re-read fresh state to avoid stale worldLine after respawn
      let thrustRequestedThisTick = false;
      // exhaust 描画用: この tick の thrust 加速度 (物理が走らない経路では 0 のまま)。
      let thrustAccelerationThisTick: Vector3 = vector3Zero();
      {
        const fresh = useGameStore.getState();
        const freshMe = fresh.players.get(myId);
        const freshDead = freshMe?.isDead ?? true;

        if (freshDead) {
          // 死亡中は causality freeze の概念が N/A (= ghost は物理実体ではない)。
          // 生存中に立てた frozen 状態がそのまま残ると overlay が ghost 中も出続けるので
          // ここで reset。 ref も合わせて reset し、 復活直後の checkCausalFreeze で
          // hysteresis baseline が古い状態に依存しないようにする。
          if (causalFrozenRef.current) {
            causalFrozenRef.current = false;
            fresh.setCausallyFrozen(false);
          }
          // ghost 中: 生存時物理 (processPlayerPhysics) を流用して ghost phaseSpace
          // を動的更新する。thrust/heading/friction/energy はすべて生存時と同一挙動。
          // ローカルのみ更新・ネットワーク非送信、worldLine 更新もしない。
          // (DESIGN.md §スポーン座標時刻 原則 3 および §物理 ghost 物理統合)
          const de = fresh.myDeathEvent;
          if (de && freshMe) {
            const ghostMe: RelativisticPlayer = {
              ...freshMe,
              phaseSpace: de.ghostPhaseSpace,
            };
            const otherPositions: Vector4[] = [];
            for (const [id, p] of fresh.players) {
              if (id !== myId) otherPositions.push(p.phaseSpace.pos);
            }
            // Ghost は燃料制約なし: availableEnergy に Infinity を渡してフル加速を常に許可、
            // 実 energy は consume しない (死亡中は energy 消費の game-play 意味が無いため)。
            const physics = processPlayerPhysics(
              ghostMe,
              keysPressed.current,
              touch,
              headingYawRef.current,
              dTau,
              otherPositions,
              Number.POSITIVE_INFINITY,
              fresh.controlScheme,
              cameraYawRef.current,
            );
            thrustRequestedThisTick = physics.thrustRequested;
            thrustAccelerationThisTick = physics.thrustAcceleration;
            // screen-relative では入力で yaw が即時更新される → headingYawRef に反映。
            // body-relative では newYaw === yaw (引数) なので no-op。
            headingYawRef.current = physics.newYaw;

            // 自機 heading は現カメラ yaw を source of truth とする。
            // physics.newPhaseSpace.heading は前 tick の値が preserve されているので、
            // ここで現 yaw に上書き (alpha は physics 側で既に world 4-accel に設定済)。
            const ghostPs = {
              ...physics.newPhaseSpace,
              heading: yawToQuat(headingYawRef.current),
            };
            // 2026-04-22: dead player は自分の ghost 位置を世界に announce しない。
            // 従って `players[myId].phaseSpace` は死亡時刻で凍結されたまま (他者 snapshot
            // と同じ値)、観測者 (ghost) frame の phaseSpace は myDeathEvent.ghostPhaseSpace
            // のみが保持する。SceneContent / Radar / HUD 等は dead self の観測時に
            // `myDeathEvent.ghostPhaseSpace` を読む (SceneContent の effective myPlayer swap 参照)。
            fresh.setMyDeathEvent({ ...de, ghostPhaseSpace: ghostPs });
          }
        } else if (freshMe) {
          const frozen = checkCausalFreeze(
            fresh.players,
            myId,
            freshMe,
            fresh.killLog,
            causalFrozenRef.current,
            fresh.boundaryMode === "torus" ? ARENA_HALF_WIDTH : undefined,
            stale.lastUpdateTimeRef.current,
            currentTime,
          );
          // 状態変化時のみ store update (= UI overlay subscriber が re-render)。
          // ref と store の二重保持: ref はホットパス毎 tick 読み出しを軽くするため、
          // store は overlay 用の reactive 通知のため。
          if (causalFrozenRef.current !== frozen) {
            fresh.setCausallyFrozen(frozen);
          }
          causalFrozenRef.current = frozen;

          // Rule A は physics を skip させるが、 Rule B は frozen 状態からの脱出経路として
          // 常に評価する (plan §7.4)。 frozen + λ=0 のときだけ完全 skip + 既存挙動維持。
          let newPs = freshMe.phaseSpace;
          let updatedWorldLine = freshMe.worldLine;
          let didPhysics = false;
          const otherPositions: Vector4[] = [];
          for (const [id, p] of fresh.players) {
            if (id !== myId) otherPositions.push(p.phaseSpace.pos);
          }

          if (!frozen) {
            const physics = processPlayerPhysics(
              freshMe,
              keysPressed.current,
              touch,
              headingYawRef.current,
              dTau,
              otherPositions,
              energy,
              fresh.controlScheme,
              cameraYawRef.current,
            );
            energy = Math.max(0, energy - physics.thrustEnergyConsumed);
            thrustRequestedThisTick = physics.thrustRequested;
            thrustAccelerationThisTick = physics.thrustAcceleration;
            // screen-relative で入力により yaw が更新されたら反映 (= heading 同期)。
            headingYawRef.current = physics.newYaw;

            // 自機 heading = 現カメラ yaw (source of truth)。physics.newPhaseSpace は
            // 前 tick の heading を preserve しているので上書き。
            // worldLine history にも同じ heading で格納したいが、physics.updatedWorldLine
            // は既に appendWorldLine 済 (前 heading 入り)。renderer 側は latest phaseSpace
            // を読むので実害は小さい (履歴 replay 精度のみ影響、角速度無しの現仕様で顕在化せず)。
            newPs = {
              ...physics.newPhaseSpace,
              heading: yawToQuat(headingYawRef.current),
            };
            updatedWorldLine = physics.updatedWorldLine;
            didPhysics = true;
          }

          // Fix (2026-05-04 plan: virtualpos-lastsync-rca §3 Fix A): host 自身が処理する
          // LH の lastUpdateTimeRef を毎 tick currentTime に update。 LH state は
          // processLighthouseAI で毎 tick 確定しているのに、 lastUpdateTimeRef は
          // remote broadcast 起点でのみ set される semantic 矛盾で、 host migration 後 /
          // 自機 host 中は LH の lastSync が古いまま virtualPos が線形発散して self の
          // Rule B が暴走する root bug の修正。 LH 限定で十分: (1) processLighthouseAI 側
          // の peer = 自機 評価では myId の lastUpdateTimeRef が未設定 → currentTime
          // fallback で tau=0 健全、 (2) 通常 player は self-authoritative pattern で本人
          // client が物理計算 + broadcast → host 集中処理 peer は LH のみ。
          if (peerManager?.getIsBeaconHolder()) {
            for (const [pId] of fresh.players) {
              if (isLighthouse(pId)) {
                stale.lastUpdateTimeRef.current.set(pId, currentTime);
              }
            }
          }

          // Rule B (= 因果律対称ジャンプ): peer の virtualPos を計算し、 自機が peer の
          // 過去 cone 内にいれば u^μ 方向に λ だけ advance。 plan §7.4 に従い frozen でも
          // 評価 (= jump で frozen 状態から脱出するため)。
          //
          // alive / stale を統一処理 (= virtualPos の inertial 延長)、 dead は asymmetric
          // hotfix で除外 (= 詳細は内部 if (p.isDead) continue 注記)。 Rule B 内部で
          // dt ≤ 0 / spacelike を skip するため不要 peer (= future / spacelike) は自動除外。
          // PBC torus は peer の virtual pos を自機中心の最小画像 cell に shift。
          const torusHalfWidthForRuleB =
            fresh.boundaryMode === "torus" ? ARENA_HALF_WIDTH : undefined;
          const peerVirtualPositions: { pos: Vector4 }[] = [];
          for (const [pId, p] of fresh.players) {
            if (pId === myId) continue;
            // dead skip (= 2026-05-02 hotfix、 plan §6 Stage 7 の「dead 包含」 案を実機検証で
            // 撤回): dead-me の virtualPos が alive other を不当に freeze させる regression が
            // 判明したため Rule A (checkCausalFreeze) と同様 Rule B でも dead を除外。 死後
            // inertial の数学概念は spawn time 計算 (= computeSpawnCoordTime) に局所化、 走行中の
            // causality 判定では除外する asymmetric 採用。
            if (p.isDead) continue;
            const lastSync =
              stale.lastUpdateTimeRef.current.get(pId) ?? currentTime;
            const vPos = virtualPos(p, lastSync, currentTime);
            const peerEffective =
              torusHalfWidthForRuleB !== undefined
                ? displayPos(vPos, newPs.pos, torusHalfWidthForRuleB)
                : vPos;
            peerVirtualPositions.push({ pos: peerEffective });
          }
          const lambda = causalityJumpLambda(
            newPs.pos,
            newPs.u,
            peerVirtualPositions,
          );

          if (lambda > 0) {
            const g = gamma(newPs.u);
            const adjustedPs = {
              ...newPs,
              pos: {
                t: newPs.pos.t + lambda * g,
                x: newPs.pos.x + lambda * newPs.u.x,
                y: newPs.pos.y + lambda * newPs.u.y,
                z: 0,
              },
            };
            newPs = adjustedPs;
            if (isLargeJump(lambda)) {
              // 大ジャンプ: 旧 worldLine を frozenWorldLines に保存し、 新セグメントを 1 点
              // から開始 (= CatmullRomCurve3 が「滑らかな嘘」 で gap 補間しないようにする)。
              fresh.setFrozenWorldLines((prev) =>
                pushFrozenWorldLine(prev, freshMe),
              );
              updatedWorldLine = appendWorldLine(
                createWorldLine(MAX_WORLDLINE_HISTORY),
                adjustedPs,
              );
              // UI: 「因果律跳躍」 brief flash overlay の trigger (= counter 増分を Overlay
              // が subscribe して 1.2s flash)。 凍結 (continuous state) と対称な
              // instantaneous event 通知。 小ジャンプ (= worldLine 連続) では出さない
              // (= visible discontinuity がある時だけ user 通知)。
              fresh.incrementCausalityJump();
            } else {
              // 微小 correction: freshMe.worldLine から再 append (= physics の updatedWorldLine
              // は pre-Rule-B 点を含むため捨てて、 adjusted な finalPs で正規化)。
              updatedWorldLine = appendWorldLine(
                freshMe.worldLine,
                adjustedPs,
                otherPositions,
              );
            }
          }

          if (didPhysics || lambda > 0) {
            fresh.setPlayers((prev) => {
              const me = prev.get(myId);
              if (!me) return prev;
              if (me.worldLine !== freshMe.worldLine) return prev;
              const next = new Map(prev);
              next.set(myId, {
                ...me,
                phaseSpace: newPs,
                worldLine: updatedWorldLine,
              });
              return next;
            });

            // Network send
            sendToNetwork({
              type: "phaseSpace" as const,
              senderId: myId,
              position: newPs.pos,
              velocity: newPs.u,
              heading: newPs.heading,
              alpha: newPs.alpha,
            });
          }
        }
      }

      // --- Energy recovery ---
      // fire も thrust もしていないときのみ回復。死亡中は respawn 時に満タンに
      // リセットされるので、ここでの回復は不要 (加算する意味がない)。
      const freshIsDead =
        useGameStore.getState().players.get(myId)?.isDead ?? true;
      if (!wantsFire && !thrustRequestedThisTick && !freshIsDead) {
        energy = Math.min(ENERGY_MAX, energy + ENERGY_RECOVERY_RATE * dTau);
      }

      // Phase C1: 末尾で energy を store に commit。handleDamage は between-tick
      // のみ発火するので、この書き込みが damage を上書きする心配は無い。
      const storeNow = useGameStore.getState();
      const meNow = storeNow.players.get(myId);
      if (meNow && meNow.energy !== energy) {
        storeNow.setPlayerEnergy(myId, energy);
      }
      setEnergy(energy);

      // 自機 thrust 加速度を ref に反映 (exhaust 描画用)。
      thrustAccelRef.current = thrustAccelerationThisTick;

      // --- Stage E: Lighthouse AI (owner-based, authority 構造から切り離し) ---
      // host-ness ではなく owner-ness で分岐。LH.ownerId === myId な peer が AI を回す。
      {
        const freshForLH = useGameStore.getState();
        const lhUpdates: Array<{
          id: string;
          ps: ReturnType<typeof createPhaseSpace>;
          wl: ReturnType<typeof freshForLH.players.get> extends infer P
            ? P extends { worldLine: infer W }
              ? W
              : never
            : never;
        }> = [];
        const lhLasers: Laser[] = [];

        for (const [lhId, lh] of freshForLH.players) {
          if (lh.ownerId !== myId) continue;
          if (!isLighthouse(lhId)) continue; // metadata: この owner filter 下で AI を回すのは LH のみ
          if (lh.isDead) continue;
          // 死亡中 LH は純粋な placeholder (他人間 ghost と対称的に死亡時刻で固定)。
          // tick 不要、phaseSpace の pos.t は死亡時刻のまま。詳細: DESIGN.md §スポーン座標時刻。

          const result = processLighthouseAI(
            freshForLH.players,
            lhId,
            lh,
            dTau,
            currentTime,
            freshForLH.lighthouseLastFireTime,
            freshForLH.lighthouseSpawnTime,
            freshForLH.killLog,
            stale.lastUpdateTimeRef.current,
            freshForLH.boundaryMode === "torus" ? ARENA_HALF_WIDTH : undefined,
          );

          lhUpdates.push({ id: lhId, ps: result.newPs, wl: result.newWl });
          sendToNetwork({
            type: "phaseSpace" as const,
            senderId: lhId,
            position: result.newPs.pos,
            velocity: result.newPs.u,
            heading: result.newPs.heading,
            alpha: result.newPs.alpha,
          });

          if (result.laser) {
            freshForLH.lighthouseLastFireTime.set(lhId, currentTime);
            lhLasers.push(result.laser);
            sendToNetwork({ type: "laser" as const, ...result.laser });
          }
        }

        // Batch apply all lighthouse state updates
        if (lhUpdates.length > 0) {
          freshForLH.setPlayers((prev) => {
            const next = new Map(prev);
            for (const { id, ps, wl } of lhUpdates) {
              const existing = next.get(id);
              if (existing) {
                next.set(id, { ...existing, phaseSpace: ps, worldLine: wl });
              }
            }
            return next;
          });
        }
        if (lhLasers.length > 0) {
          freshForLH.setLasers((prev) => {
            const updated = [...prev, ...lhLasers];
            return updated.length > MAX_LASERS
              ? updated.slice(updated.length - MAX_LASERS)
              : updated;
          });
        }
      }

      // --- Target-authoritative hit detection (Stage B) ---
      // 全 peer が自分の owner player の kill を判定する。
      // - 人間: 自分だけ
      // - host (= beacon holder): 自分 + Lighthouse (LH.ownerId = host myId)
      {
        const freshForHit = useGameStore.getState();
        // Stage C: dead / invincible は log から derive (O(log) だが log は
        // GC で小さく保たれる)。per-frame のコストは無視できる。
        const invincibleIds = selectInvincibleIds(freshForHit, currentTime);
        const deadIds = selectDeadPlayerIds(freshForHit);

        const hitResult = processHitDetection(
          freshForHit.players,
          freshForHit.lasers,
          myId,
          freshForHit.processedLasers,
          deadIds,
          invincibleIds,
          freshForHit.boundaryMode === "torus" ? ARENA_HALF_WIDTH : undefined,
        );

        // Cleanup processedLasers
        const currentLaserIds = new Set(freshForHit.lasers.map((l) => l.id));
        for (const id of freshForHit.processedLasers) {
          if (!currentLaserIds.has(id)) freshForHit.processedLasers.delete(id);
        }
        if (
          freshForHit.processedLasers.size > PROCESSED_LASERS_CLEANUP_THRESHOLD
        ) {
          freshForHit.processedLasers.clear();
        }

        if (hitResult.hits.length > 0) {
          for (const id of hitResult.hitLaserIds) {
            freshForHit.processedLasers.add(id);
          }

          for (const {
            victimId,
            killerId,
            hitPos,
            laserDir,
          } of hitResult.hits) {
            // Phase C1: damage を先に適用 (i-frame / 既死 / 無敵 は handleDamage
            // が内部で弾く)。致命なら handleDamage 内で handleKill が呼ばれる。
            // 灯台は専用 damage (= LIGHTHOUSE_HIT_DAMAGE = 0.2) で 6 発死、energy 回復なし、
            // respawn 無敵なし。post-hit i-frame (500ms) は 2026-04-19 から人間と共通。
            const damage = isLighthouse(victimId)
              ? LIGHTHOUSE_HIT_DAMAGE
              : HIT_DAMAGE;
            sendToNetwork({
              type: "hit" as const,
              victimId,
              killerId,
              hitPos,
              damage,
              laserDir,
            });
            useGameStore
              .getState()
              .handleDamage(victimId, killerId, hitPos, damage, laserDir, myId);

            // 致命判定: handleDamage 後 selectIsDead で確認。lethal なら
            // S-2 stale クリア + kill event broadcast + LH respawn timer。
            const afterStore = useGameStore.getState();
            if (!selectIsDead(afterStore, victimId)) continue;

            stale.staleFrozenRef.current.delete(victimId);
            sendToNetwork({
              type: "kill" as const,
              victimId,
              killerId,
              hitPos,
            });

            // 自機の respawn は owner poll (下の block) で駆動 (killLog.wallTime ベース)。
            // setTimeout 方式は useEffect cleanup ([peerManager, myId] 差し替え) で消失し、
            // モバイル visibility hidden 後の再接続で DEAD 永続する脆弱性があった。
            if (victimId === myId) continue;

            // 非自機 victim (= 自分が owner の LH) には setTimeout を仕込む (sub-tick 精度)。
            // poll 経由で同 tick fire する race を避けるため、callback 内で
            // selectIsDead guard を挟む。
            const timerId = setTimeout(() => {
              respawnTimeoutsRef.current.delete(timerId);
              const currentStore = useGameStore.getState();
              if (!selectIsDead(currentStore, victimId)) return; // poll 先行 or 別経路で respawn 済
              const respawnPos = createRespawnPosition(
                currentStore.players,
                currentStore.killLog,
                stale.lastUpdateTimeRef.current,
                Date.now(),
                victimId,
              );
              sendToNetwork({
                type: "respawn" as const,
                playerId: victimId,
                position: respawnPos,
              });
              const existingColor =
                currentStore.players.get(victimId)?.color ??
                getPlayerColor(victimId);
              currentStore.handleSpawn(
                victimId,
                respawnPos,
                myId,
                existingColor,
              );
            }, RESPAWN_DELAY);
            respawnTimeoutsRef.current.add(timerId);
          }
        }
      }

      // --- Owner respawn poll (killLog.wallTime based) ---
      // setTimeout に依存せず、毎 tick killLog から死亡中 owner の最新 kill.wallTime を読み、
      // RESPAWN_DELAY 経過済みなら respawn を送信。owner = 自機 (myId) + 自分が ownerId の
      // LH (= beacon holder なら全 LH)。useEffect cleanup / 再マウントで setTimeout が消えても、
      // state (log) が source of truth なので DEAD 永続化しない。
      //
      // 対応シナリオ (2026-04-18):
      // - 自機: モバイル visibility hidden → HOST_HIDDEN_GRACE 経過で beacon holder 再構築、
      //   peerManager 差し替えで respawnTimeoutsRef.clear() される
      // - LH: solo 環境 (= 唯一の peer) で beacon holder が hidden→visible し Phase 1 経由で
      //   再取得するケース。旧 `useBeaconMigration` の LH setTimeout rebuild に依存していたが、
      //   同日の refactor で tick poll に一本化 (DESIGN.md §migration 権威は assumeHostRole に集約)
      //
      // 冪等性: handleSpawn が respawnLog に entry 追加 → selectIsDead が false に落ちる →
      // 次 tick で poll が skip。dev build では assert で壊れていないか確認。
      {
        const pollState = useGameStore.getState();
        const ownedDeadIds: string[] = [];
        if (selectIsDead(pollState, myId)) ownedDeadIds.push(myId);
        for (const [id, player] of pollState.players) {
          if (!isLighthouse(id)) continue;
          if (player.ownerId !== myId) continue;
          if (selectIsDead(pollState, id)) ownedDeadIds.push(id);
        }

        if (ownedDeadIds.length > 0) {
          const latestKillTime = new Map<string, number>();
          for (const e of pollState.killLog) {
            const prev = latestKillTime.get(e.victimId);
            if (prev === undefined || e.wallTime > prev) {
              latestKillTime.set(e.victimId, e.wallTime);
            }
          }
          for (const victimId of ownedDeadIds) {
            const deathTime = latestKillTime.get(victimId);
            if (deathTime === undefined) continue; // selectIsDead true なら必ず entry あるはず
            if (deathTime + RESPAWN_DELAY > currentTime) continue;

            const respawnPos = createRespawnPosition(
              pollState.players,
              pollState.killLog,
              stale.lastUpdateTimeRef.current,
              Date.now(),
              victimId,
            );
            sendToNetwork({
              type: "respawn" as const,
              playerId: victimId,
              position: respawnPos,
            });
            const existingColor =
              pollState.players.get(victimId)?.color ??
              getPlayerColor(victimId);
            pollState.handleSpawn(victimId, respawnPos, myId, existingColor);

            if (import.meta.env.DEV) {
              const after = useGameStore.getState();
              if (selectIsDead(after, victimId)) {
                console.warn(
                  "[respawn-poll] selectIsDead still true after handleSpawn for",
                  victimId,
                  "— per-tick respawn spam likely. Check handleSpawn/gcLogs/selectIsDead.",
                );
              }
            }
          }
        }
      }

      // --- Stage C-4: GC (pair 成立 kill 除去、respawn は latest のみ残す) ---
      {
        const gcState = useGameStore.getState();
        const gc = gcLogs(gcState.killLog, gcState.respawnLog);
        if (
          gc.killLog !== gcState.killLog ||
          gc.respawnLog !== gcState.respawnLog
        ) {
          useGameStore.setState({
            killLog: gc.killLog,
            respawnLog: gc.respawnLog,
          });
        }
      }

      // --- Temporal GC: laser / frozen worldline / debris の最未来点が
      //     全プレイヤー最早時刻より LCH × GC_PAST_LCH_MULTIPLIER 以上過去なら削除。
      //     time fade で実質不可視の領域 (fade ≈ 0.04 @ 5×LCH) を刈り、
      //     交差計算 / tube 再生成 / InstancedMesh 更新の per-frame 線形コスト削減。
      {
        const gcState = useGameStore.getState();
        let earliestPlayerT = Number.POSITIVE_INFINITY;
        for (const p of gcState.players.values()) {
          const t = p.phaseSpace.pos.t;
          if (t < earliestPlayerT) earliestPlayerT = t;
        }
        if (Number.isFinite(earliestPlayerT)) {
          const cutoff =
            earliestPlayerT - LIGHT_CONE_HEIGHT * GC_PAST_LCH_MULTIPLIER;
          // laser: 最未来点 = emissionPos.t + range
          const lasers = gcState.lasers;
          if (lasers.length > 0) {
            const kept = lasers.filter(
              (l) => l.emissionPos.t + l.range >= cutoff,
            );
            if (kept.length !== lasers.length) {
              gcState.setLasers(() => kept);
            }
          }
          // frozen worldline: 最未来点 = history[last].t (= 死亡時刻)
          const frozen = gcState.frozenWorldLines;
          if (frozen.length > 0) {
            const kept = frozen.filter((fw) => {
              const h = fw.worldLine.history;
              if (h.length === 0) return false;
              return h[h.length - 1].pos.t >= cutoff;
            });
            if (kept.length !== frozen.length) {
              gcState.setFrozenWorldLines(() => kept);
            }
          }
          // debris: 最未来点 = deathPos.t + ut * λ_max。 ut は particle 毎に異なる
          // (= 4-velocity 空間成分から give) ので、 GC は安全側 conservative bound
          // `λ_max * DEBRIS_GC_GAMMA_BOUND` (= 高速 particle の最大 coord time advance
          // 想定) で見積もる。 落としすぎ防止 (= visible なものを GC) 優先。
          const debris = gcState.debrisRecords;
          if (debris.length > 0) {
            const kept = debris.filter((d) => {
              const lambda =
                d.type === "hit" ? HIT_DEBRIS_MAX_LAMBDA : DEBRIS_MAX_LAMBDA;
              return d.deathPos.t + lambda * DEBRIS_GC_GAMMA_BOUND >= cutoff;
            });
            if (kept.length !== debris.length) {
              gcState.setDebrisRecords(() => kept);
            }
          }
        }
      }
    };

    intervalRef.current = setInterval(gameLoop, GAME_LOOP_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      for (const id of respawnTimeoutsRef.current) {
        clearTimeout(id);
      }
      respawnTimeoutsRef.current.clear();
    };
  }, [peerManager, myId]);
}
