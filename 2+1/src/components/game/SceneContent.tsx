import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import {
  futureLightConeIntersectionWorldLine,
  getVelocity4,
  lorentzBoost,
  observableImageCells,
  pastLightConeIntersectionWorldLine,
  requiredImageCellRadius,
  type Vector3,
  type Vector4,
} from "../../physics";
import { selectDeadPlayerIds, useGameStore } from "../../stores/game-store";
import { ArenaRenderer } from "./ArenaRenderer";
import {
  AIM_ARROW_BASE_OPACITY,
  AIM_ARROW_OPACITY_STEP,
  ARENA_HALF_WIDTH,
  ARENA_RADIUS,
  CAMERA_DISTANCE_ORTHOGRAPHIC,
  CAMERA_DISTANCE_PERSPECTIVE,
  CAMERA_DISTANCE_PLC_SLICE,
  CAMERA_YAW_FOLLOW_TAU,
  PLC_SLICE_PITCH,
  FUTURE_CONE_LASER_TRIANGLE_OPACITY,
  FUTURE_CONE_WORLDLINE_RING_OPACITY,
  FUTURE_CONE_WORLDLINE_SPHERE_OPACITY,
  LASER_PAST_CONE_MARKER_COLOR,
  LH_INNER_HIDE_RADIUS,
  LIGHT_CONE_HEIGHT,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_SIZE_OTHER,
  SHIP_WORLDLINE_HIDE_RADIUS,
} from "./constants";
import { DeadShipRenderer } from "./DeadShipRenderer";
import { DeathMarker } from "./DeathMarker";
import { DebrisRenderer } from "./DebrisRenderer";
import { buildMeshMatrix, DisplayFrameProvider } from "./DisplayFrameContext";
import {
  buildDisplayMatrix,
  transformEventForDisplay,
} from "./displayTransform";
import { GameLights } from "./GameLights";
import { HeadingMarkerRenderer } from "./HeadingMarkerRenderer";
import { JellyfishShipRenderer } from "./JellyfishShipRenderer";
import { LaserBatchRenderer } from "./LaserBatchRenderer";
import { LightConeRenderer } from "./LightConeRenderer";
import { LighthouseRenderer } from "./LighthouseRenderer";
import {
  futureLightConeIntersectionLaser,
  pastLightConeIntersectionLaser,
} from "./laserPhysics";
import { isLighthouse } from "./lighthouse";
import { OtherShipRenderer } from "./OtherShipRenderer";
import { RocketShipRenderer } from "./RocketShipRenderer";
import { SelfShipRenderer } from "./SelfShipRenderer";
import { SpawnRenderer } from "./SpawnRenderer";
import { StardustRenderer } from "./StardustRenderer";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { Laser } from "./types";
import { WorldLineRenderer } from "./WorldLineRenderer";

/**
 * 交点 `eventPos` (world frame) における光円錐接平面の **world frame rotation matrix** を返す。
 * 三角形ジオメトリは local xy 平面、tip=+x、法線=+z。観測者 `obsPos` と event の world 相対位置
 * から接平面を導出するので過去/未来両方、rest frame 表示中でも世界系表示でも同じ式で動く。
 *
 * 数式: Δ = event - observer。ρ = |Δ_xy|、n = (Δx, Δy, -Δt) / √(ρ² + Δt²)。
 * laser direction を接平面に射影して u、v = n × u。
 */
const computeConeTangentWorldRotation = (
  eventPos: { x: number; y: number; t: number },
  obsPos: { x: number; y: number; t: number },
  laserDir: { x: number; y: number; z: number },
): THREE.Matrix4 | null => {
  const dx = eventPos.x - obsPos.x;
  const dy = eventPos.y - obsPos.y;
  const dt = eventPos.t - obsPos.t;
  const rho2 = dx * dx + dy * dy;
  if (rho2 < 1e-12) return null;
  const denom = Math.sqrt(rho2 + dt * dt); // ρ√2 on the cone
  if (denom < 1e-12) return null;
  const nx = dx / denom;
  const ny = dy / denom;
  const nt = -dt / denom;
  // Project laser direction onto the tangent plane (laser has no t-component)
  const ldotN = laserDir.x * nx + laserDir.y * ny;
  let ux = laserDir.x - ldotN * nx;
  let uy = laserDir.y - ldotN * ny;
  let ut = -ldotN * nt;
  const ulen = Math.sqrt(ux * ux + uy * uy + ut * ut);
  if (ulen < 1e-9) return null;
  ux /= ulen;
  uy /= ulen;
  ut /= ulen;
  // v = n × u
  const vx = ny * ut - nt * uy;
  const vy = nt * ux - nx * ut;
  const vt = nx * uy - ny * ux;
  // Local (x, y, z) → world (u, v, n). Three.js maps local z ↔ world t.
  return new THREE.Matrix4().set(
    ux,
    vx,
    nx,
    0,
    uy,
    vy,
    ny,
    0,
    ut,
    vt,
    nt,
    0,
    0,
    0,
    0,
    1,
  );
};

export type SceneContentProps = {
  myId: string | null;
  showInRestFrame: boolean;
  useOrthographic: boolean;
  /** PLC スライス mode 全般 (= 過去光円錐 spatial slice の x-y 平面 view、 旧名 plc3d だが
   *  2026-05-07 から 2D / 3D 両方を含む semantics に拡張)。 true なら時空図描画を bypass、
   *  z=0 の x-y 平面で flatten 済 ship model を描画。 plcMode が camera 視点を分ける。 */
  plc3d: boolean;
  /** PLC mode の camera 視点。 "3d" = 斜め俯瞰 perspective (PLC_SLICE_PITCH=π/8)、
   *  "2d" = 真上 orthographic (= top-down map view)。 plc3d=false (= 時空図 mode) では無視。 */
  plcMode: "2d" | "3d";
  /** heading の唯一の source of truth。SelfShipRenderer の砲塔 / HeadingMarkerRenderer 等で参照。 */
  headingYawRef: React.RefObject<number>;
  /** camera yaw の source of truth。useGameLoop が controlScheme 別に正しい値を書く:
   *   legacy_classic → heading と同期 / legacy_shooter → 独立 / modern → 0 固定。
   *  camera 計算 / Radar はこれを直接読む。 */
  cameraYawRef: React.RefObject<number>;
  cameraPitchRef: React.RefObject<number>;
  thrustAccelRef: React.RefObject<Vector3>;
  isFiring: boolean;
};

// 3Dシーンコンテンツコンポーネント
export const SceneContent = ({
  myId,
  showInRestFrame,
  useOrthographic,
  plc3d,
  plcMode,
  headingYawRef,
  cameraYawRef,
  cameraPitchRef,
  thrustAccelRef,
  isFiring,
}: SceneContentProps) => {
  // --- Firing start time (for sequential arrow animation) ---
  const firingStartRef = useRef<number>(0);
  if (isFiring && firingStartRef.current === 0)
    firingStartRef.current = Date.now();
  if (!isFiring) firingStartRef.current = 0;

  // jellyfish 武装触手の砲指向 (45° 下) に渡す。React state の isFiring を ref にミラー
  // して、useFrame 内で同期取得できるように。
  const firingRef = useRef<boolean>(isFiring);
  firingRef.current = isFiring;

  // 表示 camera yaw (= 3D camera 位置 / lookAt 計算でだけ使う、 lag 入り版)。
  // 論理 yaw `cameraYawRef.current` (= physics / Radar / CenterCompass / heading sync の
  // source of truth) に対し、 useFrame で指数 lerp で追従する。 null は未 seed (初回フレーム
  // で論理 yaw に snap して swing 防止)。 詳細は CAMERA_YAW_FOLLOW_TAU の JSDoc。
  const displayedCameraYawRef = useRef<number | null>(null);

  // --- Store selectors ---
  const players = useGameStore((s) => s.players);
  const lasers = useGameStore((s) => s.lasers);
  const spawns = useGameStore((s) => s.spawns);
  const frozenWorldLines = useGameStore((s) => s.frozenWorldLines);
  const debrisRecords = useGameStore((s) => s.debrisRecords);
  // 3D kill marker (sphere + ring) は DeathMarker (統一アルゴリズム) が担当。store の
  // killNotification は HUD (Overlays) の text notification 用途のみ、この scene では参照しない。
  // myGhostPhaseSpace = 自機 ghost camera の動的 phaseSpace (dead self で myPlayer.phaseSpace
  // を swap)。 旧 myDeathEvent (= 静的 meta + 動的 ghost の複合) を 2026-05-04 plan で分解、
  // 静的 meta は player.phaseSpace から derive、 動的 ghost のみ explicit。
  const myGhostPhaseSpace = useGameStore((s) => s.myGhostPhaseSpace);
  // 2026-05-04 isDead 二重管理解消: `RelativisticPlayer.isDead` field 撤廃で derive
  // subscribe に移行。 deadIds は killLog/respawnLog から useMemo で 1 derive、
  // hot path / 複数 isDead check の loop で deadIds.has(id) を使い回す。
  const killLog = useGameStore((s) => s.killLog);
  const respawnLog = useGameStore((s) => s.respawnLog);
  const deadIds = useMemo(
    () => selectDeadPlayerIds({ killLog, respawnLog }),
    [killLog, respawnLog],
  );
  const myIsDead = myId ? deadIds.has(myId) : false;

  const playerList = useMemo(() => Array.from(players.values()), [players]);
  // myPlayer: 観測者 frame を組み立てるための "effective" player。
  //   生存中: players.get(myId) そのまま。
  //   死亡中: phaseSpace を `myGhostPhaseSpace` に swap (ghost は自由飛行する観測者、
  //     `players[myId].phaseSpace` は死亡時刻で凍結 = 他者 snapshot と同じ値)。この swap で
  //     camera / past-cone / Radar 等すべての observer 計算が ghost を追う。
  const rawMyPlayer = useMemo(
    () => (myId ? (players.get(myId) ?? null) : null),
    [players, myId],
  );
  const myPlayer = useMemo(
    () =>
      rawMyPlayer && myIsDead && myGhostPhaseSpace
        ? { ...rawMyPlayer, phaseSpace: myGhostPhaseSpace }
        : rawMyPlayer,
    [rawMyPlayer, myIsDead, myGhostPhaseSpace],
  );
  const observerPos = myPlayer?.phaseSpace.pos ?? null;
  const observerU = useMemo(
    () =>
      myPlayer
        ? { x: myPlayer.phaseSpace.u.x, y: myPlayer.phaseSpace.u.y }
        : null,
    [myPlayer],
  );
  const observerBoost = useMemo(
    () =>
      showInRestFrame && myPlayer ? lorentzBoost(myPlayer.phaseSpace.u) : null,
    [showInRestFrame, myPlayer],
  );
  // Laser past-cone marker の共通 silver color (2026-04-21 odakin 指定)。
  const pastConeMarkerColor = useMemo(
    () => getThreeColor(LASER_PAST_CONE_MARKER_COLOR),
    [],
  );
  // カメラ yaw は cameraYawRef を直読。useGameLoop が controlScheme 別に正しい値を書く:
  //   legacy_classic → heading と同期 (camera が heading に追従、旧挙動)
  //   legacy_shooter → 独立 (Shift+矢印 / mobile touch swipe で旋回、 default 0)
  //   modern        → 0 固定 (world basis、camera は回らない)
  const viewMode = useGameStore((s) => s.viewMode);
  const controlScheme = useGameStore((s) => s.controlScheme);
  const torusHalfWidth = useTorusHalfWidth();

  // **PBC universal cover**: 自機本体 (Self/Rocket/Jellyfish) を `(2R+1)²` image cell に複製
  // 描画。 各 image cell ごとに player.phaseSpace.pos に `2L * (obsCell + cell.offset)` 加算
  // した synthetic player を ship renderer に渡す。 自機本体は observerPos = phaseSpace.pos
  // なので primary cell は display 原点、 隣接 image は 2L*offset 離れた位置に出る (=
  // 「universal cover の自分の copy」 が周囲 8 image に echo)。
  const selfShipCells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);
  const selfL = torusHalfWidth ?? 0;
  const selfObsCellX =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.x + selfL) / (2 * selfL))
      : 0;
  const selfObsCellY =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.y + selfL) / (2 * selfL))
      : 0;
  useFrame(({ camera }, delta) => {
    if (!myPlayer) return;
    const playerPos = transformEventForDisplay(
      myPlayer.phaseSpace.pos,
      observerPos,
      observerBoost,
      torusHalfWidth,
    );
    const targetX = playerPos.x;
    const targetY = playerPos.y;
    const targetT = playerPos.t;

    // 論理 yaw に lag 込みで追従する表示 yaw を更新。 wrap は atan2(sin, cos) で吸収
    // (-π/+π 境界跨ぎでも最短回り)。 初回は snap して起動時の swing を防ぐ。
    const targetYaw = cameraYawRef.current;
    if (displayedCameraYawRef.current === null) {
      displayedCameraYawRef.current = targetYaw;
    } else {
      const d = targetYaw - displayedCameraYawRef.current;
      const wrappedDelta = Math.atan2(Math.sin(d), Math.cos(d));
      const alpha = 1 - Math.exp(-delta / CAMERA_YAW_FOLLOW_TAU);
      displayedCameraYawRef.current += wrappedDelta * alpha;
    }
    const yaw = displayedCameraYawRef.current;
    if (plc3d) {
      if (plcMode === "2d") {
        // PLC 2D: 真上 orthographic、 camera は targetXY の真上 (= 高 z)、 lookAt = target、
        // up = (cos yaw, sin yaw, 0) で heading-up rotation を持たせる。 camera は ortho で
        // zoom 経由のスケール、 distance は遠 +z でも projection 不変。
        camera.position.set(targetX, targetY, targetT + 50);
        camera.lookAt(targetX, targetY, targetT);
        camera.up.set(Math.cos(yaw), Math.sin(yaw), 0);
        return;
      }
      // PLC 3D mode: x-y 平面 (z=0) を斜め俯瞰、 camera up = +z (時間軸)。
      // 通常 spacetime 図と異なり pitch/distance は固定値、 cameraPitchRef は無視。
      camera.position.set(
        targetX +
          CAMERA_DISTANCE_PLC_SLICE *
            Math.cos(PLC_SLICE_PITCH) *
            Math.cos(yaw + Math.PI),
        targetY +
          CAMERA_DISTANCE_PLC_SLICE *
            Math.cos(PLC_SLICE_PITCH) *
            Math.sin(yaw + Math.PI),
        targetT + CAMERA_DISTANCE_PLC_SLICE * Math.sin(PLC_SLICE_PITCH),
      );
      camera.lookAt(targetX, targetY, targetT);
      camera.up.set(0, 0, 1);
      return;
    }

    const pitch = cameraPitchRef.current;
    const distance = useOrthographic
      ? CAMERA_DISTANCE_ORTHOGRAPHIC
      : CAMERA_DISTANCE_PERSPECTIVE;
    const camX = targetX + distance * Math.cos(pitch) * Math.cos(yaw + Math.PI);
    const camY = targetY + distance * Math.cos(pitch) * Math.sin(yaw + Math.PI);
    const camT = targetT + distance * Math.sin(pitch);

    camera.position.set(camX, camY, camT);
    camera.lookAt(targetX, targetY, targetT);
    camera.up.set(0, 0, 1);
  });

  // 他プレイヤーの observable marker を 2 種類の責務に分離して並存:
  //   (A) worldLinePastConePoints: past-cone ∩ worldLine (観測者が今見ている位置)。
  //       ship (OtherShipRenderer) と同位置、sphere の小さな halo で補強。
  //       gate: aliveIntersection != null — 観測者が光を受信済のフレームのみ表示。
  //   (B) worldLineFuturePoints: worldLine 未来側末端 = `phaseSpace.pos` (world-now)。
  //       **神の視点** の pedagogical marker (光速遅延を視覚化)。観測者が物理的に
  //       見える/見えないに関わらず、player が新しい世界点を獲得した瞬間から
  //       常時マーク。未来光円錐と同じ omniscient view カテゴリ。
  //       gate: `!player.isDead` のみ — 死亡中 (幽霊期間) は player がこの世に
  //       居ないので描くものが無い (wp は過去の x_D event を指すだけで「現在の
  //       位置」ではない)。存在論的に除外、情報隠蔽ではない。
  const worldLineMarkerEntries = useMemo(() => {
    const pastCone: {
      key: string;
      playerId: string;
      color: string;
      pos: Vector4;
    }[] = [];
    const future: {
      key: string;
      playerId: string;
      color: string;
      pos: Vector4;
    }[] = [];
    if (!observerPos) return { pastCone, future };
    for (const player of playerList) {
      if (player.id === myId) continue;
      if (isLighthouse(player.id)) continue;
      // (B) future-most: omniscient view の世界線末端 marker。 死亡 player は world-now が
      // 存在しない (= 凍結) ため skip。 isDead は神視点の存在論的 gate (因果律無関係)。
      if (!deadIds.has(player.id)) {
        future.push({
          key: `future-pt-${player.id}`,
          playerId: player.id,
          color: player.color,
          pos: player.phaseSpace.pos,
        });
      }
      // (A) past-cone: 観測者が **今見てる** 位置の causal marker。 死亡 player でも
      // past cone が worldLine 末端まで到達してない間は引き続き表示する。 isDead で
      // 即 skip すると 「相手が死んだ瞬間に kill event 到達前に描画消える」 因果律違反
      // bug (2026-05-02 odakin 報告)。 OtherShipRenderer の本体描画も同じ gate (=
      // pastLightConeIntersectionWorldLine 結果非 null) で動くので、 marker と本体が
      // 同期して光速遅延ぶん表示される。
      const intersection = pastLightConeIntersectionWorldLine(
        player.worldLine,
        observerPos,
        torusHalfWidth,
      );
      if (!intersection) continue;
      pastCone.push({
        key: `past-cone-pt-${player.id}`,
        playerId: player.id,
        color: player.color,
        pos: intersection.pos,
      });
    }
    return { pastCone, future };
  }, [playerList, myId, observerPos, torusHalfWidth, deadIds]);
  const worldLinePastConePoints = worldLineMarkerEntries.pastCone;
  const worldLineFuturePoints = worldLineMarkerEntries.future;

  const laserIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    return lasers
      .map((laser) => {
        const intersection = pastLightConeIntersectionLaser(
          laser,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return { laser, pos: intersection }; // world frame
      })
      .filter(
        (value): value is { laser: Laser; pos: Vector4 } => value !== null,
      );
  }, [lasers, myPlayer, myId]);

  // Future light cone intersections with lasers
  const laserFutureIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    return lasers
      .map((laser) => {
        const intersection = futureLightConeIntersectionLaser(
          laser,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return { laser, pos: intersection }; // world frame
      })
      .filter(
        (value): value is { laser: Laser; pos: Vector4 } => value !== null,
      );
  }, [lasers, myPlayer, myId]);

  // Future light cone intersections: where a signal from the observer would reach each player
  const futureLightConeIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    const results: { playerId: string; color: string; pos: Vector4 }[] = [];
    for (const player of playerList) {
      if (player.id === myId) continue;
      const intersection = futureLightConeIntersectionWorldLine(
        player.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: player.id,
          color: player.color,
          pos: intersection.pos, // world frame
        });
      }
    }
    return results;
  }, [myPlayer, myId, playerList]);

  const displayMatrix = useMemo(
    () => buildDisplayMatrix(observerPos, observerBoost),
    [observerPos, observerBoost],
  );

  // 光源位置: 各灯台の過去光円錐交差点 (= LighthouseRenderer が塔を置く位置) の
  // 各 LH の past-cone 交差点を光源として渡す。**死亡観測済み** (= past-cone が worldLine
  // 末端 = x_D を超えて intersection が null) の LH は除外 → 全 LH が死亡観測済みなら []
  // (= 真の消灯)。観測者未設定 (pre-game) も [] (= 暗黙)、game 開始まで game scene は暗い。
  const lightPositions = useMemo<readonly [number, number, number][]>(() => {
    if (!observerPos) return [];
    const positions: [number, number, number][] = [];
    for (const player of playerList) {
      if (!isLighthouse(player.id)) continue;
      const intersection = pastLightConeIntersectionWorldLine(
        player.worldLine,
        observerPos,
        torusHalfWidth,
      );
      if (!intersection) continue; // 死亡 event を観測済み → 光源消灯
      const dp = transformEventForDisplay(
        intersection.pos,
        observerPos,
        observerBoost,
        torusHalfWidth,
      );
      positions.push([dp.x, dp.y, dp.t]);
    }
    return positions;
  }, [playerList, observerPos, observerBoost, torusHalfWidth]);

  if (plc3d) {
    // 自機 / 参照リング anchor (rest frame では origin=(0,0)、 world frame では observer 世界座標)。
    const selfX = observerPos?.x ?? 0;
    const selfY = observerPos?.y ?? 0;

    return (
      <DisplayFrameProvider
        observerU={observerU}
        observerBoost={observerBoost}
        observerPos={observerPos}
        displayMatrix={displayMatrix}
        torusHalfWidth={torusHalfWidth}
        flattenT={true}
      >
        <GameLights positions={lightPositions} />

        {/* 参照リング (自機中心の距離ガイド 5/10/15/20 ls)。 緑系で control 強さを控えめに。 */}
        <group position={[selfX, selfY, 0]}>
          {[5, 10, 15, 20].map((r) => (
            <mesh key={r}>
              <ringGeometry args={[r - 0.06, r + 0.06, 64]} />
              <meshBasicMaterial
                color="#1a3a1a"
                transparent
                opacity={0.6}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
        </group>

        {/* アリーナ境界: open_cylinder mode = 半径 ARENA_RADIUS の円、 torus mode =
            半幅 ARENA_HALF_WIDTH の正方形 (= boundary 位置を可視化)。 spacetime mode の
            ArenaRenderer (cylinder + 縦線) は 4D 構造なので PLC では flat 1 line で代替。 */}
        {torusHalfWidth === undefined ? (
          <mesh position={[0, 0, 0]}>
            <ringGeometry
              args={[ARENA_RADIUS - 0.18, ARENA_RADIUS + 0.18, 128]}
            />
            <meshBasicMaterial
              color="hsl(180, 40%, 70%)"
              transparent
              opacity={0.5}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ) : (
          <lineLoop position={[0, 0, 0]}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[
                  new Float32Array([
                    -ARENA_HALF_WIDTH, -ARENA_HALF_WIDTH, 0,
                    ARENA_HALF_WIDTH, -ARENA_HALF_WIDTH, 0,
                    ARENA_HALF_WIDTH, ARENA_HALF_WIDTH, 0,
                    -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH, 0,
                  ]),
                  3,
                ]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color="hsl(180, 40%, 70%)"
              transparent
              opacity={0.5}
            />
          </lineLoop>
        )}

        {/* プレイヤー描画 (時空 mode と同じ flatMap、 flattenT=true で各 renderer が
            anchor の z (= display t) を 0 に置換 → ship 3D 形状を保ちつつ z=0 平面に立つ。
            LH は内部で flat top-down icon に切替、 DeathMarker / DeadShipRenderer も
            flattenT 対応済。 4D 構造系 (LightConeRenderer / WorldLineRenderer / future-cone /
            laser triangle / 接平面三角形 / spacetime laser segment) は PLC 分岐に出さない
            ことで両立。 詳細: DisplayFrameValue.flattenT JSDoc。 */}
        {playerList.flatMap((player) => {
          const key = `player-${player.id}`;
          if (isLighthouse(player.id)) {
            return [<LighthouseRenderer key={key} player={player} />];
          }

          const isMe = player.id === myId;
          const items: React.JSX.Element[] = [];

          if (isMe && !deadIds.has(player.id)) {
            for (const cell of selfShipCells) {
              const dx = 2 * selfL * (selfObsCellX + cell.kx);
              const dy = 2 * selfL * (selfObsCellY + cell.ky);
              const cellKey = `${key}-${cell.kx},${cell.ky}`;
              const imageObserver = observerPos
                ? { ...observerPos, x: observerPos.x - dx, y: observerPos.y - dy }
                : null;
              const intersection = imageObserver
                ? pastLightConeIntersectionWorldLine(
                    player.worldLine,
                    imageObserver,
                  )
                : null;
              if (!intersection) continue;
              const offsetPlayer = {
                ...player,
                phaseSpace: {
                  ...player.phaseSpace,
                  pos: {
                    ...intersection.pos,
                    x: intersection.pos.x + dx,
                    y: intersection.pos.y + dy,
                  },
                  heading: intersection.heading,
                },
              };
              if (viewMode === "shooter") {
                items.push(
                  <RocketShipRenderer
                    key={cellKey}
                    player={offsetPlayer}
                    thrustAccelRef={thrustAccelRef}
                    observerPos={observerPos}
                    observerBoost={observerBoost}
                    cameraYawRef={headingYawRef}
                    alpha4={player.phaseSpace.alpha}
                  />,
                );
              } else if (viewMode === "jellyfish") {
                items.push(
                  <JellyfishShipRenderer
                    key={cellKey}
                    player={offsetPlayer}
                    thrustAccelRef={thrustAccelRef}
                    observerPos={observerPos}
                    observerBoost={observerBoost}
                    cameraYawRef={headingYawRef}
                    alpha4={player.phaseSpace.alpha}
                    firingRef={firingRef}
                  />,
                );
              } else {
                items.push(
                  <SelfShipRenderer
                    key={cellKey}
                    player={offsetPlayer}
                    thrustAccelRef={thrustAccelRef}
                    observerPos={observerPos}
                    observerBoost={observerBoost}
                    cannonStyle="laser"
                    cameraYawRef={headingYawRef}
                    alpha4={player.phaseSpace.alpha}
                    controlScheme={controlScheme}
                  />,
                );
              }
            }
            // legacy_classic は本体ごと heading 回転で aim 方向が出るので line を出さない
            // (spacetime branch の判断と同じ)。
            if (controlScheme !== "legacy_classic") {
              items.push(
                <HeadingMarkerRenderer
                  key={`${key}-heading`}
                  player={player}
                  cameraYawRef={headingYawRef}
                />,
              );
            }
          } else if (!isMe) {
            // 他機: OtherShipRenderer 内部で PBC 9 image 化済 + flattenT で z=0 に着地。
            items.push(<OtherShipRenderer key={key} player={player} />);
          }

          if (deadIds.has(player.id)) {
            const xD = player.phaseSpace.pos;
            const uD = getVelocity4(player.phaseSpace.u);
            const headingD = player.phaseSpace.heading;
            const deadColor = getThreeColor(player.color);
            items.push(
              <DeadShipRenderer
                key={`${key}-dead-ship`}
                xD={xD}
                uD={uD}
                headingD={headingD}
                color={player.color}
                playerId={player.id}
                viewMode={player.viewMode}
              />,
              <DeathMarker
                key={`${key}-death-marker`}
                xD={xD}
                uD={uD}
                color={deadColor}
              />,
            );
          }

          return items;
        })}

        {/* 神視点 world-now dot (= 各 player の phaseSpace.pos.xy)。 ship (= past-cone 位置) との
            xy gap で「光の伝達遅延」 を pedagogical 可視化。 spacetime branch の
            worldLineFuturePoints と同じ意図、 PLC 用に z=0 + 透明度を抑えた dim 表示。 */}
        {worldLineFuturePoints.map(({ key, color: colorText, pos }) => {
          const c = getThreeColor(colorText);
          const dp = transformEventForDisplay(
            pos,
            observerPos,
            observerBoost,
            torusHalfWidth,
          );
          const size = PLAYER_MARKER_SIZE_OTHER;
          return (
            <group key={key} position={[dp.x, dp.y, 0]}>
              <mesh
                scale={[size, size, size]}
                geometry={sharedGeometries.playerSphere}
              >
                <meshBasicMaterial
                  color={c}
                  transparent
                  opacity={0.35}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        })}

        {/* デブリ (= flattenT で 4D segment 描画 skip + marker のみ z=0 に着地)。 */}
        {myPlayer && (
          <DebrisRenderer debrisRecords={debrisRecords} myPlayer={myPlayer} />
        )}

        {/* レーザー世界線 xy 射影 (= 各 laser の emission → tip 4D 線分を xy 平面に投影、
            z=0 のうっすら線)。 spacetime mode の `LaserBatchRenderer` (= per-vertex Lorentz
            な 4D laser 線) を PLC では time 成分を捨てて 2D 線分で表示。 透明度は spacetime の
            laser line より低めに設定して「うっすら」 表示 (= odakin 指示 2026-05-07: 「時空
            モードよりさらに薄く」)。 LaserBatchRenderer は per-vertex shader で displayMatrix
            適用が前提なので PLC の plain xy 射影には流用せず、 ここで個別 line として描画。 */}
        {lasers.map((laser) => {
          const start = transformEventForDisplay(
            laser.emissionPos,
            observerPos,
            observerBoost,
          );
          const tipWorld = {
            t: laser.emissionPos.t + laser.range,
            x: laser.emissionPos.x + laser.direction.x * laser.range,
            y: laser.emissionPos.y + laser.direction.y * laser.range,
            z: 0,
          };
          const tip = transformEventForDisplay(
            tipWorld,
            observerPos,
            observerBoost,
          );
          return (
            <line key={`plc3d-laser-line-${laser.id}`}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[
                    new Float32Array([start.x, start.y, 0, tip.x, tip.y, 0]),
                    3,
                  ]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={getThreeColor(laser.color)}
                transparent
                opacity={0.18}
                depthWrite={false}
                toneMapped={false}
              />
            </line>
          );
        })}

        {/* レーザー未来光円錐交点マーカー (= 自分が今 fire したら photon は将来この event で
            laser 世界線に到達する、 = laser ∩ 観測者 future-cone)。 spacetime mode では cone
            tangent plane に貼った三角形 (= laserFutureIntersections + computeConeTangentWorldRotation
            + scale [1.5, 1.5, 1.5] + opacity FUTURE_CONE_LASER_TRIANGLE_OPACITY=0.2 + laser 色)。
            PLC 平面では時間軸が無いので**平面内 yaw のみ**に縮約 (past-cone 三角形 と同パターン)。
            past-cone 三角形 (silver、 scale [3,3,1]) との pair として:
              - past-cone: silver、 scale [3,3,1] で大きく明示 (= 「観測者がいま見ている laser 位置」)
              - future-cone: **laser 本体色、 scale [2,2,1] で少し小さく、 opacity 0.12** (=
                spacetime の 0.2 × 0.6 で「さらに薄く」 odakin 指示適合)
            形状は **黄金三角形** を保持 (= uniform xy scale で頂角 36° を崩さない)。 laser 色は
            past-cone marker の silver と差別化、 「これは laser 本体と関連の future event」 を識別。 */}
        {laserFutureIntersections.map(({ laser, pos }) => {
          const dp = transformEventForDisplay(pos, observerPos, observerBoost);
          const dirLen2 =
            laser.direction.x * laser.direction.x +
            laser.direction.y * laser.direction.y;
          if (dirLen2 < 1e-12) return null;
          const aimYaw = Math.atan2(laser.direction.y, laser.direction.x);
          const flatDir = new THREE.Vector3(
            Math.cos(aimYaw),
            Math.sin(aimYaw),
            0,
          );
          const xAxis = new THREE.Vector3(1, 0, 0);
          const quat = new THREE.Quaternion().setFromUnitVectors(
            xAxis,
            flatDir,
          );
          return (
            <mesh
              key={`plc3d-laser-future-${laser.id}`}
              position={[dp.x, dp.y, 0]}
              quaternion={quat}
              geometry={sharedGeometries.laserIntersectionTriangle}
              scale={[2, 2, 1]}
            >
              <meshBasicMaterial
                color={getThreeColor(laser.color)}
                transparent
                opacity={FUTURE_CONE_LASER_TRIANGLE_OPACITY * 0.6}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          );
        })}

        {/* レーザー past 光円錐交点 (= observer 過去光円錐 ∩ laser worldline)。 spacetime
            mode の三角形マーカー (= 円錐接平面上の銀色ビーム三角形) を PLC 平面に投影:
            anchor (dp.xy) を z=0 に置き、 三角形の local +x を laser 進行方向 (xy 投影) に揃える。
            spacetime mode は `computeConeTangentWorldRotation` で円錐接平面に貼り付くが、
            PLC slice は時間軸が無いので**平面内 yaw 回転だけ**に縮約 (laser 方向は world-frame
            xy 角を採用、 boost 後の rest-frame 角と低 γ では ≈ 等価で 2D Radar の表示と同じ
            扱い)。
            **scale**: spacetime mode は `[6, 1, 1]` でビーム感を強調 (= 円錐接平面 tilt の
            foreshortening で「過剰 stretch」 が緩和されてビームらしく見える)。 PLC は flat
            俯瞰なので foreshortening が効かず、 同じ `[6,1,1]` だと頂角 6° の極細スパイクに
            なって geometry 本来の黄金三角形 (= 頂角 36°、 acute golden triangle) が崩れる。
            そのため PLC のみ uniform `[3, 3, 1]` で黄金比 (脚:底辺 = φ:1) を保つ「chunky 黄金」
            表示にする (= 2026-04-19 旧 spacetime の `[3,3,3]` chunky と同じ思想)。 silver tint /
            加算合成は spacetime と揃える。 */}
        {laserIntersections.map(({ laser, pos }) => {
          const dp = transformEventForDisplay(pos, observerPos, observerBoost);
          // laser 進行方向 xy → 角度 (world-frame、 Radar L206-246 と同パターン)。
          const dirLen2 =
            laser.direction.x * laser.direction.x +
            laser.direction.y * laser.direction.y;
          if (dirLen2 < 1e-12) return null;
          const aimYaw = Math.atan2(laser.direction.y, laser.direction.x);
          // 三角形 geometry の local +x が laser 方向に向くように xy 平面内 yaw 回転。
          // local +x → (cos θ, sin θ, 0)、 local +y → (-sin θ, cos θ, 0)。 quat は
          // setFromUnitVectors(+x, dir) で十分 (z 軸回転に縮約される)。
          const flatDir = new THREE.Vector3(
            Math.cos(aimYaw),
            Math.sin(aimYaw),
            0,
          );
          const xAxis = new THREE.Vector3(1, 0, 0);
          const quat = new THREE.Quaternion().setFromUnitVectors(
            xAxis,
            flatDir,
          );
          // 2026-05-16 odakin 指示: silver base に発射者 (laser owner) 色を lerp で
          // 混ぜ、 marker から発射者識別を視認可能化。 spacetime 三角形 (= line 1086+) は
          // 中立 silver 維持 (= odakin 指定が PLC のみ)。
          // 比率 0.5 (= 当初 0.25 は silver lightness 高 + additive blending で発射者色
          // wash out → odakin「自機の色が足されてるの分からない」 5/16、 2x で再 deploy)。
          const tinted = new THREE.Color()
            .copy(pastConeMarkerColor)
            .lerp(getThreeColor(laser.color), 0.5);
          return (
            <mesh
              key={`plc3d-laser-${laser.id}`}
              position={[dp.x, dp.y, 0]}
              quaternion={quat}
              geometry={sharedGeometries.laserIntersectionTriangle}
              scale={[3, 3, 1]}
            >
              <meshBasicMaterial
                color={tinted}
                side={THREE.DoubleSide}
                toneMapped={false}
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          );
        })}

        {/* aim arrow (= 射撃中 1-3 本の sequential 矢印) は PLC では非表示。
            spacetime mode の aim arrow は「過去光円錐の母線 (= heading + -z)/√2 に沿って
            光が後ろに流れていく」 様子の pedagogical 表現で、 PLC slice (= z=0 平面) には
            時間軸が無いので「光円錐の母線を下に下る」 という visual 自体が意味を持たない
            (odakin 指示 2026-05-07: 「光円錐上を下に下がってく形で撃つわけではない」)。
            自機 heading は HeadingMarkerRenderer (= xy 平面上の方向線) で別途示すので
            aim 標識として不足はしない。 */}

        {/* (リ)スポーンエフェクト (= 2026-05-07 odakin 「PLC スライスモードにも入れよう」)。
            SpawnRenderer は flattenT を読んで PLC mode 時に xy 平面上の波紋表現に切替 (= 5
            リングを z=0 の同 xy で異 radius、 光柱は skip)。 spawn は spacetime / PLC 共通
            の zustand state なので、 ここで map するだけで両 mode 同時動作。 */}
        {spawns.map((spawn) => (
          <SpawnRenderer key={spawn.id} spawn={spawn} />
        ))}
      </DisplayFrameProvider>
    );
  }

  return (
    <DisplayFrameProvider
      observerU={observerU}
      observerBoost={observerBoost}
      observerPos={observerPos}
      displayMatrix={displayMatrix}
      torusHalfWidth={torusHalfWidth}
    >
      <GameLights positions={lightPositions} />

      {/* 時空星屑 (4D event cloud、world-frame 静止、periodic boundary で無限供給) */}
      <StardustRenderer />

      {/* アリーナ円柱 (視覚ガイド、world-frame 静止、過去光円錐交線ハイライト) */}
      <ArenaRenderer />

      {/* 凍結世界線（世界オブジェクト）を描画。観測者過去光円錐との交差点周辺を hide
          (DeathMarker / 塔等との被り解消)。LH の凍結世界線は LH 専用半径で狭く隠す。
          key は entry stable id (= types.ts FrozenWorldLine.id docstring 参照) で、
          配列 cycling (= 容量 truncate で先頭削除 + 末尾追加) で「同 entry が配列上の
          位置を変える」 場合も同 React mount を維持し、 WorldLineRenderer の TubeGeometry
          rebuild storm を抑止する。 旧 key (= `frozen-${i}-${first.pos.t}`) は cycling で
          mount/unmount 連発 → main thread saturation → setInterval Violation → rAF starve
          → Bug 10 (= 全世界凍結) の真因残存分だった (2026-05-04)。 */}
      {frozenWorldLines.map((fw) => (
        <WorldLineRenderer
          key={`frozen-${fw.id}`}
          worldLine={fw.worldLine}
          color={fw.color}
          observerPos={observerPos}
          observerBoost={observerBoost}
          innerHideRadius={
            isLighthouse(fw.playerId)
              ? LH_INNER_HIDE_RADIUS
              : SHIP_WORLDLINE_HIDE_RADIUS
          }
        />
      ))}

      {/* 生存プレイヤーの現在の世界線を描画。観測者過去光円錐との交差点周辺を hide。
          LH は機体より細いので狭い半径 (LH_INNER_HIDE_RADIUS) で隠す。 */}
      {playerList.map((player) => (
        <WorldLineRenderer
          key={`worldline-${player.id}`}
          worldLine={player.worldLine}
          color={player.color}
          observerPos={observerPos}
          observerBoost={observerBoost}
          innerHideRadius={
            isLighthouse(player.id)
              ? LH_INNER_HIDE_RADIUS
              : SHIP_WORLDLINE_HIDE_RADIUS
          }
        />
      ))}

      {/* 各プレイヤーのマーカー。
          Lighthouse: 専用の塔モデル (LighthouseRenderer、past-cone anchor + death fade)。
          自機 (人間) 生存中: SelfShipRenderer (六角 hull + 4 RCS + 懸架砲、deadpan SF)。
          他機 (人間) 生存中: OtherShipRenderer (SelfShipRenderer 流用、past-cone 交点に
            ship 3D model を配置、heading/alpha は worldLine 各 sample から補間取得)。
          他機 (人間) 死亡中 + 自機死亡中: DeadShipRenderer (ship モデル @ x_D、opacity
            `(τ_max − τ_0) / τ_max` で fade) + DeathMarker (sphere @ x_D + ring @ W_D(τ_0)、
            τ_0 < DEATH_TAU_EFFECT_MAX のみ)。2026-04-22 統一アルゴリズム。 */}
      {playerList.flatMap((player) => {
        const key = `player-${player.id}`;
        if (isLighthouse(player.id)) {
          return [<LighthouseRenderer key={key} player={player} />];
        }

        const isMe = player.id === myId;
        const items: React.JSX.Element[] = [];

        // 生存中の ship 描画 (alive / pre-death window で past-cone ∩ worldline を持つ間)。
        // 他機は OtherShipRenderer が自己 null (past-cone が worldLine 末端超過で null)
        // を返すので無条件配置 OK。自機は自身の position = observerPos なので past-cone
        // 概念が効かない → isDead で除外 + SelfShipRenderer 直描画。
        if (isMe && !deadIds.has(player.id)) {
          // **PBC universal cover (image observer past-cone pattern)**: 全 player (= self /
          // other / lighthouse) で **統一**の物理的に正しい echo 計算。 各 image cell ごとに
          //   imageObserver = obs - 2L*(obsCell + cell.offset)
          // で pastLightConeIntersectionWorldLine(player.worldLine, imageObserver) を呼び、
          // intersection.pos に +2L*(obsCell + cell.offset) を加算して image cell 位置として
          // 表示。 primary image (= cell (0,0)): intersection ≈ worldLine 末端 = 現在自分。
          // 隣接 image (= cell (±1, 0) etc): worldLine の 2L spatial 過去 vertex (= 過去の自分)
          // → +2L で primary 隣接位置に echo 表示。 worldLine 履歴が短いと隣接 cell の
          // intersection が null (= 物理的に正しい 「echo まだ届いてない」 挙動)。
          for (const cell of selfShipCells) {
            const dx = 2 * selfL * (selfObsCellX + cell.kx);
            const dy = 2 * selfL * (selfObsCellY + cell.ky);
            const cellKey = `${key}-${cell.kx},${cell.ky}`;
            const imageObserver = observerPos
              ? { ...observerPos, x: observerPos.x - dx, y: observerPos.y - dy }
              : null;
            const intersection = imageObserver
              ? pastLightConeIntersectionWorldLine(
                  player.worldLine,
                  imageObserver,
                )
              : null;
            // 自機の場合、 primary cell (dx=dy=0) は image observer = obs で intersection が
            // 必ず worldLine 末端 ≈ phaseSpace.pos になる。 隣接 cell は worldLine 履歴が
            // 不足してると null → 描画 skip (= 物理的に「観測者本人の過去光円錐に echo まだ届いてない」)。
            if (!intersection) continue;
            const offsetPlayer = {
              ...player,
              phaseSpace: {
                ...player.phaseSpace,
                pos: {
                  ...intersection.pos,
                  x: intersection.pos.x + dx,
                  y: intersection.pos.y + dy,
                },
                heading: intersection.heading,
              },
            };
            // viewMode で 3 種類の自機レンダラを dispatch
            if (viewMode === "shooter") {
              items.push(
                <RocketShipRenderer
                  key={cellKey}
                  player={offsetPlayer}
                  thrustAccelRef={thrustAccelRef}
                  observerPos={observerPos}
                  observerBoost={observerBoost}
                  cameraYawRef={headingYawRef}
                  alpha4={player.phaseSpace.alpha}
                />,
              );
            } else if (viewMode === "jellyfish") {
              items.push(
                <JellyfishShipRenderer
                  key={cellKey}
                  player={offsetPlayer}
                  thrustAccelRef={thrustAccelRef}
                  observerPos={observerPos}
                  observerBoost={observerBoost}
                  cameraYawRef={headingYawRef}
                  alpha4={player.phaseSpace.alpha}
                  firingRef={firingRef}
                />,
              );
            } else {
              items.push(
                <SelfShipRenderer
                  key={cellKey}
                  player={offsetPlayer}
                  thrustAccelRef={thrustAccelRef}
                  observerPos={observerPos}
                  observerBoost={observerBoost}
                  cannonStyle="laser"
                  cameraYawRef={headingYawRef}
                  alpha4={player.phaseSpace.alpha}
                  controlScheme={controlScheme}
                />,
              );
            }
          }
          // heading 線は primary image のみ (= 自機の aim 方向、 echo 化すると過剰)
          if (controlScheme !== "legacy_classic") {
            items.push(
              <HeadingMarkerRenderer
                key={`${key}-heading`}
                player={player}
                cameraYawRef={headingYawRef}
              />,
            );
          }
        } else if (!isMe) {
          // OtherShipRenderer 内部で 9 image 化済 (= player を渡すだけ)
          items.push(<OtherShipRenderer key={key} player={player} />);
        }

        // 死亡 event 描画 (spec: plans/死亡イベント.md §3-§7)。DeadShipRenderer と
        // DeathMarker は (x_D, u_D) から内部で τ_0 = past-cone ∩ W_D(τ) を計算し、
        // 自分の表示窓 (ship: [0, τ_max]、marker: [0, τ_max_effect]) の外では自身で null 返す。
        // SceneContent 側での τ_0 routing は不要。
        if (deadIds.has(player.id)) {
          const xD = player.phaseSpace.pos;
          const uD = getVelocity4(player.phaseSpace.u);
          const headingD = player.phaseSpace.heading;
          const deadColor = getThreeColor(player.color);
          items.push(
            <DeadShipRenderer
              key={`${key}-dead-ship`}
              xD={xD}
              uD={uD}
              headingD={headingD}
              color={player.color}
              playerId={player.id}
              viewMode={player.viewMode}
            />,
            <DeathMarker
              key={`${key}-death-marker`}
              xD={xD}
              uD={uD}
              color={deadColor}
            />,
          );
        }

        return items;
      })}

      {/* 自機 exhaust + acceleration arrow は SelfShipRenderer の 8 RCS nozzle に
          吸収・廃止 (2026-04-19、deadpan SF design)。コンポーネント定義
          (ExhaustCone / AccelerationArrow) は将来的に他機 exhaust v2 (broadcast α^μ)
          で再利用される可能性があり一時的に残置。 */}

      {/* 自機光円錐 (プレイヤーごとに自分のみ描画、固定色)。rim は ARENA_RADIUS の円柱側面
          まで延伸 (ρ(θ) 依存)、ray が円柱を外す方向は LIGHT_CONE_HEIGHT にフォールバック。
          geometry / in-place update / shader 適用の詳細は LightConeRenderer 内 JSDoc 参照。 */}
      {myPlayer && <LightConeRenderer observerPos={myPlayer.phaseSpace.pos} />}

      {/* レーザー過去光円錐交差マーカー（円錐接平面に貼り付いた三角形、tip=laser.direction の接平面射影）
          色は 2026-04-21 odakin 指定で universal `LASER_PAST_CONE_MARKER_COLOR` (silver) ベース、
          2026-05-16 から発射者色 lerp(0.5) tint (= odakin「時空図だと色が見えない」 観察で PLC と
          同じ tint に揃える、 spacetime/PLC marker の見え方を一致)。
          player / laser 色は kill log + beam 本体で識別されるが、 marker tint で発射者を視認しやすく。*/}
      {observerPos &&
        laserIntersections.map(({ laser, pos }) => {
          const rot = computeConeTangentWorldRotation(
            pos,
            observerPos,
            laser.direction,
          );
          if (!rot) return null;
          const m = buildMeshMatrix(pos, displayMatrix);
          m.multiply(rot);
          // 2026-05-16: silver + 発射者色 lerp(0.5) (= PLC 三角形と同 tint、 SceneContent §PLC
          // 注記参照)。
          const tinted = new THREE.Color()
            .copy(pastConeMarkerColor)
            .lerp(getThreeColor(laser.color), 0.5);
          return (
            <mesh
              key={`laser-intersection-${laser.id}`}
              geometry={sharedGeometries.laserIntersectionTriangle}
              matrix={m}
              matrixAutoUpdate={false}
              // 2026-04-19: 旧 [3,3,3] (chunky 三角) を [6,1,1] に変更。geometry の +x が
              // laser 接平面射影方向なので x scale = laser 方向の長さ、y scale = 横幅。
              // x を伸ばし y を細くすることで「ビーム」感を出す。
              scale={[6, 1, 1]}
            >
              {/* toneMapped=false で色を明るく出す + additive で背景に光が乗る (ビーム感) */}
              <meshBasicMaterial
                color={tinted}
                side={THREE.DoubleSide}
                toneMapped={false}
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          );
        })}

      {/* 未来光円錐交差マーカー（接平面に貼り付いた三角形、うっすら表示） */}
      {observerPos &&
        laserFutureIntersections.map(({ laser, pos }) => {
          const c = getThreeColor(laser.color);
          const rot = computeConeTangentWorldRotation(
            pos,
            observerPos,
            laser.direction,
          );
          if (!rot) return null;
          const m = buildMeshMatrix(pos, displayMatrix);
          m.multiply(rot);
          return (
            <group
              key={`laser-future-${laser.id}`}
              matrix={m}
              matrixAutoUpdate={false}
            >
              <mesh
                geometry={sharedGeometries.laserIntersectionTriangle}
                scale={[1.5, 1.5, 1.5]}
              >
                <meshBasicMaterial
                  color={c}
                  transparent
                  opacity={FUTURE_CONE_LASER_TRIANGLE_OPACITY}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        })}
      {futureLightConeIntersections.map(
        ({ playerId, color: colorText, pos }) => {
          const c = getThreeColor(colorText);
          const dp = transformEventForDisplay(
            pos,
            observerPos,
            observerBoost,
            torusHalfWidth,
          );
          const ringMatrix = buildMeshMatrix(pos, displayMatrix);
          ringMatrix.multiply(new THREE.Matrix4().makeScale(0.8, 0.8, 0.8));
          return (
            <group key={`future-${playerId}`}>
              <mesh
                geometry={sharedGeometries.intersectionSphere}
                position={[dp.x, dp.y, dp.t]}
                scale={[0.6, 0.6, 0.6]}
              >
                <meshBasicMaterial
                  color={c}
                  transparent
                  opacity={FUTURE_CONE_WORLDLINE_SPHERE_OPACITY}
                  depthWrite={false}
                />
              </mesh>
              <mesh
                geometry={sharedGeometries.intersectionRing}
                matrix={ringMatrix}
                matrixAutoUpdate={false}
              >
                <meshBasicMaterial
                  color={c}
                  transparent
                  opacity={FUTURE_CONE_WORLDLINE_RING_OPACITY}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        },
      )}

      {/* (A) 他プレイヤー世界線 **過去光円錐交差点** に dot + glow halo。観測者が
          「今まさに見ている」他機位置に anchor (ship と同位置)。aliveIntersection
          null のフレーム (respawn 光未到達 / worldLine 空) は出さない。 */}
      {worldLinePastConePoints.map(({ key, color: colorText, pos }) => {
        const c = getThreeColor(colorText);
        const dp = transformEventForDisplay(
          pos,
          observerPos,
          observerBoost,
          torusHalfWidth,
        );
        const size = PLAYER_MARKER_SIZE_OTHER;
        return (
          <group key={key} position={[dp.x, dp.y, dp.t]}>
            <mesh
              scale={[size, size, size]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshStandardMaterial
                color={c}
                emissive={c}
                emissiveIntensity={0.4}
                roughness={0.3}
                metalness={0.1}
                transparent
                depthWrite={true}
                opacity={PLAYER_MARKER_MAIN_OPACITY_OTHER}
              />
            </mesh>
            <mesh
              scale={[size * 1.8, size * 1.8, size * 1.8]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshBasicMaterial
                color={c}
                transparent
                depthWrite={false}
                opacity={PLAYER_MARKER_GLOW_OPACITY_OTHER}
              />
            </mesh>
          </group>
        );
      })}

      {/* (B) 他プレイヤー世界線 **未来側末端 = world-now** dot + glow halo。
          ship (past-cone 交点) との display gap = 光速遅延の pedagogical 可視化。
          同じ aliveIntersection gate を通るので pre-past-cone の先行露出は無し。
          サイズは 3d1831d 以前の old OtherPlayerRenderer alive sphere と同寸
          (`playerSphere` × `PLAYER_MARKER_SIZE_OTHER` = 0.5 × 0.2 = effective radius 0.1)。 */}
      {worldLineFuturePoints.map(({ key, color: colorText, pos }) => {
        const c = getThreeColor(colorText);
        const dp = transformEventForDisplay(
          pos,
          observerPos,
          observerBoost,
          torusHalfWidth,
        );
        const size = PLAYER_MARKER_SIZE_OTHER;
        return (
          <group key={key} position={[dp.x, dp.y, dp.t]}>
            <mesh
              scale={[size, size, size]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshStandardMaterial
                color={c}
                emissive={c}
                emissiveIntensity={0.4}
                roughness={0.3}
                metalness={0.1}
                transparent
                depthWrite={true}
                opacity={PLAYER_MARKER_MAIN_OPACITY_OTHER}
              />
            </mesh>
            <mesh
              scale={[size * 1.8, size * 1.8, size * 1.8]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshBasicMaterial
                color={c}
                transparent
                depthWrite={false}
                opacity={PLAYER_MARKER_GLOW_OPACITY_OTHER}
              />
            </mesh>
          </group>
        );
      })}

      {/* レーザー描画（バッチ, 頂点 world / matrix = displayMatrix） */}
      <LaserBatchRenderer lasers={lasers} />

      {/* レーザー方向マーカー（自機のみ、トリガー中） */}
      {isFiring &&
        myPlayer &&
        myId &&
        (() => {
          // 自機の最新レーザーから方向取得
          let latestLaser: (typeof lasers)[0] | null = null;
          for (const l of lasers) {
            if (l.playerId !== myId) continue;
            if (!latestLaser || l.emissionPos.t > latestLaser.emissionPos.t)
              latestLaser = l;
          }
          if (!latestLaser) return null;
          const dir = latestLaser.direction;
          if (dir.x * dir.x + dir.y * dir.y < 0.000001) return null;
          const aimYaw = Math.atan2(dir.y, dir.x);
          const s2 = Math.SQRT1_2;
          const cy = Math.cos(aimYaw),
            sy = Math.sin(aimYaw);
          const pastDir = new THREE.Vector3(cy, sy, -1).normalize();
          const rotMatrix = new THREE.Matrix4().set(
            -sy,
            -cy * s2,
            cy * s2,
            0,
            cy,
            -sy * s2,
            sy * s2,
            0,
            0,
            s2,
            s2,
            0,
            0,
            0,
            0,
            1,
          );
          const quat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);
          const pos = transformEventForDisplay(
            myPlayer.phaseSpace.pos,
            observerPos,
            observerBoost,
            torusHalfWidth,
          );
          // Aim arrow 色は player 色ではなく laser past-cone marker と同じ silver に統一
          // (odakin 指定: 「射撃中」text / marker と同系統で視覚統合)
          const c = pastConeMarkerColor;
          const spacing = 1.2; // 矢印の全長 (tip 0.75 + base 0.45) と一致させ tip↔base を接合
          // 0s→1個, 0.05s→2個, 0.1s→3個（ループなし、トリガー押し始めから）
          const elapsed = Date.now() - firingStartRef.current;
          const visibleCount = Math.min(3, Math.floor(elapsed / 50) + 1);
          return [1, 2, 3].map((i) => {
            if (i > visibleCount) return null;
            const opacity =
              AIM_ARROW_BASE_OPACITY - (i - 1) * AIM_ARROW_OPACITY_STEP;
            return (
              <mesh
                key={`aim-arrow-${i}`}
                position={[
                  pos.x + pastDir.x * spacing * i,
                  pos.y + pastDir.y * spacing * i,
                  pos.t + pastDir.z * spacing * i,
                ]}
                quaternion={quat}
                geometry={sharedGeometries.laserArrow}
              >
                <meshBasicMaterial
                  color={c}
                  transparent
                  opacity={opacity}
                  side={THREE.DoubleSide}
                />
              </mesh>
            );
          });
        })()}

      {/* デブリの世界線とマーカー（世界オブジェクト） */}
      {myPlayer && (
        <DebrisRenderer debrisRecords={debrisRecords} myPlayer={myPlayer} />
      )}

      {/* 時空星屑（個別点のクラウド） */}
      <StardustRenderer />

      {/* 死亡 marker (sphere + ring) は DeathMarker (LighthouseRenderer / SceneContent 死者
          routing から call、2026-04-22 統一アルゴリズム) が担当。killNotification store state
          は UI HUD (Overlays の text notification) のみに使用。 */}

      {/* スポーンエフェクト */}
      {spawns.map((spawn) => (
        <SpawnRenderer key={spawn.id} spawn={spawn} />
      ))}
    </DisplayFrameProvider>
  );
};
