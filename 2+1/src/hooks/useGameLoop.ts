import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { vector3Zero, type createPhaseSpace, type Vector3, type Vector4 } from "../physics";
import {
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
  MAX_LASERS,
  PROCESSED_LASERS_CLEANUP_THRESHOLD,
  RESPAWN_DELAY,
  SPAWN_EFFECT_DURATION,
} from "../components/game/constants";
import { createRespawnPosition } from "../components/game/respawnTime";
import { isLighthouse } from "../components/game/lighthouse";
import {
  processCamera,
  processPlayerPhysics,
  processLighthouseAI,
  processHitDetection,
  checkCausalFreeze,
  processLaserFiring,
} from "../components/game/gameLoop";
import {
  firePendingKillEvents,
  firePendingSpawnEvents,
} from "../components/game/causalEvents";
import type { Laser, RelativisticPlayer } from "../components/game/types";
import type { useStaleDetection } from "./useStaleDetection";
import type { useTouchInput } from "../components/game/touchInput";
import {
  gcLogs,
  selectDeadPlayerIds,
  selectInvincibleIds,
  selectIsDead,
  useGameStore,
} from "../stores/game-store";

// --- Types ---

type PeerManager = {
  getIsHost: () => boolean;
  getHostId: () => string | null;
  send: (msg: unknown) => void;
  sendTo: (id: string, msg: unknown) => void;
};

export interface GameLoopDeps {
  peerManager: PeerManager | null;
  myId: string | null;
  getPlayerColor: (id: string) => string;

  // Local UI setters (transient, kept local for perf)
  setFps: React.Dispatch<React.SetStateAction<number>>;
  setEnergy: React.Dispatch<React.SetStateAction<number>>;
  setIsFiring: React.Dispatch<React.SetStateAction<boolean>>;
  setDeathFlash: React.Dispatch<React.SetStateAction<boolean>>;

  // Per-frame local refs (shared with SceneContent)
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
    const sendToNetwork = (msg: unknown) => {
      if (peerManager.getIsBeaconHolder()) {
        peerManager.send(msg);
      } else {
        const hostId = peerManager.getBeaconHolderId();
        if (hostId) peerManager.sendTo(hostId, msg);
      }
    };

    const gameLoop = () => {
      if (document.hidden) {
        lastTimeRef.current = Date.now();
        return;
      }

      const currentTime = Date.now();
      const dTau = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;
      // Visibility 遷移直後や setInterval 一時停止の復帰で稀に elevated dt が
      // 混入する場合の防御。> 200 ms のティックは 1 フレーム捨てる (input/physics skip)。
      if (dTau > 0.2) return;

      const store = useGameStore.getState();

      // --- Detect myDeathEvent transitions for local ref resets ---
      const currentMyDeathEvent = store.myDeathEvent;
      if (prevMyDeathEventRef.current !== null && currentMyDeathEvent === null) {
        // non-null → null: self-respawn just happened → reset camera refs.
        // energy は applyRespawn が ENERGY_MAX にリセット済 (store 側で一元管理)。
        cameraYawRef.current = 0;
        cameraPitchRef.current = DEFAULT_CAMERA_PITCH;
      }
      // null → non-null: self-death。ghost phaseSpace は handleKill 内で
      // 死亡時 phaseSpace から初期化されているため、ここでの特別リセットは不要。
      prevMyDeathEventRef.current = currentMyDeathEvent;

      // Phase C1: tick 開始時に store から energy を読む (between-tick で
      // handleDamage / applyRespawn が変更した最新値)。tick 内では local
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
          const alive = prev.filter(
            (l) => l.emissionPos.t + l.range > cutoff,
          );
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

      // --- Camera ---
      const touch = touchInput.current;
      const isDeadForCamera = store.players.get(myId)?.isDead ?? false;
      const cam = processCamera(
        keysPressed.current,
        touch,
        dTau,
        { yaw: cameraYawRef.current, pitch: cameraPitchRef.current },
        isDeadForCamera,
      );
      cameraYawRef.current = cam.yaw;
      cameraPitchRef.current = cam.pitch;
      touch.yawDelta = 0;
      // pitch は touch で制御しない (processCamera 内の pitch 処理削除済み)。
      // pitchDelta を毎 tick リセットして蓄積を防ぐ。
      touch.pitchDelta = 0;

      // --- Causal events ---
      // Stage C: pending kill events は killLog.filter(!firedForUi) で derive。
      // 過去光円錐到達で firedForUi を立て、scores を加算する。
      const myPos = store.players.get(myId)?.phaseSpace.pos;
      if (myPos && store.killLog.some((e) => !e.firedForUi)) {
        const result = firePendingKillEvents(
          store.killLog,
          myPos,
          myId,
          store.scores,
        );
        if (result.firedIndices.length > 0) {
          const firedSet = new Set(result.firedIndices);
          const nextLog = store.killLog.map((e, i) =>
            firedSet.has(i) ? { ...e, firedForUi: true } : e,
          );
          useGameStore.setState({
            killLog: nextLog,
            scores: { ...result.newScores },
          });

          if (result.effects.deathFlash) {
            setDeathFlash(true);
            setTimeout(() => setDeathFlash(false), 600);
          }
          if (result.effects.killNotification) {
            useGameStore.setState({ killNotification: result.effects.killNotification });
            setTimeout(() => useGameStore.setState({ killNotification: null }), 1500);
          }
        }
      }

      if (myPos && store.pendingSpawnEvents.length > 0) {
        const result = firePendingSpawnEvents(
          store.pendingSpawnEvents,
          myPos,
          Date.now(),
          store.players,
        );
        if (result.firedSpawns.length > 0) {
          useGameStore.setState({ pendingSpawnEvents: result.remaining });
          useGameStore.getState().setSpawns((prev) => [...prev, ...result.firedSpawns]);
        }
      }

      // --- Laser firing + energy ---
      const isDead = store.players.get(myId)?.isDead ?? false;
      const wantsFire = !isDead && (keysPressed.current.has(" ") || touch.firing);
      const myPlayer = store.players.get(myId);

      if (myPlayer && !isDead) {
        const laserResult = processLaserFiring(
          myPlayer,
          myId,
          cameraYawRef.current,
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
      stale.checkStale(currentTime, store.players, myId);

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
            const physics = processPlayerPhysics(
              ghostMe,
              keysPressed.current,
              touch,
              cameraYawRef.current,
              dTau,
              otherPositions,
              energy,
            );
            energy = Math.max(0, energy - physics.thrustEnergyConsumed);
            thrustRequestedThisTick = physics.thrustRequested;
            thrustAccelerationThisTick = physics.thrustAcceleration;

            fresh.setMyDeathEvent({
              ...de,
              ghostPhaseSpace: physics.newPhaseSpace,
            });
            fresh.setPlayers((prev) => {
              const me = prev.get(myId);
              if (!me || !me.isDead) return prev;
              const next = new Map(prev);
              next.set(myId, { ...me, phaseSpace: physics.newPhaseSpace });
              return next;
            });
          }
        } else if (freshMe) {

          const frozen = checkCausalFreeze(
            fresh.players,
            myId,
            freshMe,
            stale.staleFrozenRef.current,
            causalFrozenRef.current,
          );
          causalFrozenRef.current = frozen;

          if (!frozen) {
            const otherPositions: Vector4[] = [];
            for (const [id, p] of fresh.players) {
              if (id !== myId) otherPositions.push(p.phaseSpace.pos);
            }
            const physics = processPlayerPhysics(
              freshMe,
              keysPressed.current,
              touch,
              cameraYawRef.current,
              dTau,
              otherPositions,
              energy,
            );
            energy = Math.max(0, energy - physics.thrustEnergyConsumed);
            thrustRequestedThisTick = physics.thrustRequested;
            thrustAccelerationThisTick = physics.thrustAcceleration;

            fresh.setPlayers((prev) => {
              const me = prev.get(myId);
              if (!me) return prev;
              // Guard: respawn が間に入って worldLine が変わっていたら skip
              if (me.worldLine !== freshMe.worldLine) return prev;
              const next = new Map(prev);
              next.set(myId, {
                ...me,
                phaseSpace: physics.newPhaseSpace,
                worldLine: physics.updatedWorldLine,
              });
              return next;
            });

            // Network send
            sendToNetwork({
              type: "phaseSpace" as const,
              senderId: myId,
              position: physics.newPhaseSpace.pos,
              velocity: physics.newPhaseSpace.u,
            });
          }
        }
      }

      // --- Energy recovery ---
      // fire も thrust もしていないときのみ回復。死亡中は respawn 時に満タンに
      // リセットされるので、ここでの回復は不要 (加算する意味がない)。
      const freshIsDead = useGameStore.getState().players.get(myId)?.isDead ?? true;
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
        const lhUpdates: Array<{ id: string; ps: ReturnType<typeof createPhaseSpace>; wl: ReturnType<typeof freshForLH.players.get> extends infer P ? P extends { worldLine: infer W } ? W : never : never }> = [];
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
          );

          lhUpdates.push({ id: lhId, ps: result.newPs, wl: result.newWl });
          sendToNetwork({
            type: "phaseSpace" as const,
            senderId: lhId,
            position: result.newPs.pos,
            velocity: result.newPs.u,
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
        );

        // Cleanup processedLasers
        const currentLaserIds = new Set(freshForHit.lasers.map((l) => l.id));
        for (const id of freshForHit.processedLasers) {
          if (!currentLaserIds.has(id)) freshForHit.processedLasers.delete(id);
        }
        if (freshForHit.processedLasers.size > PROCESSED_LASERS_CLEANUP_THRESHOLD) {
          freshForHit.processedLasers.clear();
        }

        if (hitResult.hits.length > 0) {
          for (const id of hitResult.hitLaserIds) {
            freshForHit.processedLasers.add(id);
          }

          for (const { victimId, killerId, hitPos, laserDir } of hitResult.hits) {
            // Phase C1: damage を先に適用 (i-frame / 既死 / 無敵 は handleDamage
            // が内部で弾く)。致命なら handleDamage 内で handleKill が呼ばれる。
            sendToNetwork({
              type: "hit" as const,
              victimId,
              killerId,
              hitPos,
              damage: HIT_DAMAGE,
              laserDir,
            });
            useGameStore
              .getState()
              .handleDamage(victimId, killerId, hitPos, HIT_DAMAGE, laserDir, myId);

            // 致命判定: handleDamage 後 selectIsDead で確認。lethal なら
            // S-2 stale クリア + kill event broadcast + LH respawn timer。
            const afterStore = useGameStore.getState();
            if (!selectIsDead(afterStore, victimId)) continue;

            stale.staleFrozenRef.current.delete(victimId);
            sendToNetwork({ type: "kill" as const, victimId, killerId, hitPos });

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
              const respawnPos = createRespawnPosition(currentStore.players, victimId);
              sendToNetwork({
                type: "respawn" as const,
                playerId: victimId,
                position: respawnPos,
              });
              currentStore.handleRespawn(victimId, respawnPos, myId, getPlayerColor);
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
      // 冪等性: handleRespawn が respawnLog に entry 追加 → selectIsDead が false に落ちる →
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

            const respawnPos = createRespawnPosition(pollState.players, victimId);
            sendToNetwork({
              type: "respawn" as const,
              playerId: victimId,
              position: respawnPos,
            });
            pollState.handleRespawn(victimId, respawnPos, myId, getPlayerColor);

            if (import.meta.env.DEV) {
              const after = useGameStore.getState();
              if (selectIsDead(after, victimId)) {
                console.warn(
                  "[respawn-poll] selectIsDead still true after handleRespawn for",
                  victimId,
                  "— per-tick respawn spam likely. Check handleRespawn/gcLogs/selectIsDead.",
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
        if (gc.killLog !== gcState.killLog || gc.respawnLog !== gcState.respawnLog) {
          useGameStore.setState({ killLog: gc.killLog, respawnLog: gc.respawnLog });
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
          const cutoff = earliestPlayerT - LIGHT_CONE_HEIGHT * GC_PAST_LCH_MULTIPLIER;
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
          // debris: 最未来点 = deathPos.t + (hit なら HIT_DEBRIS_MAX_LAMBDA、explosion なら DEBRIS_MAX_LAMBDA)
          const debris = gcState.debrisRecords;
          if (debris.length > 0) {
            const kept = debris.filter((d) => {
              const lambda = d.type === "hit" ? HIT_DEBRIS_MAX_LAMBDA : DEBRIS_MAX_LAMBDA;
              return d.deathPos.t + lambda >= cutoff;
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
