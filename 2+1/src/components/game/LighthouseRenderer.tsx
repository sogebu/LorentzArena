import { useMemo } from "react";
import * as THREE from "three";
import { getVelocity4 } from "../../physics/vector";
import { pastLightConeIntersectionWorldLine } from "../../physics/worldLine";
import {
  DEATH_TAU_MAX,
  LIGHTHOUSE_COLOR,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_SIZE_OTHER,
} from "./constants";
import { buildApparentShapeMatrix } from "./apparentShape";
import { pastLightConeIntersectionDeathWorldLine } from "./deathWorldLine";
import { DeathMarker } from "./DeathMarker";
import { useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { RelativisticPlayer } from "./types";

// 灯台 (Lighthouse) のプロシージャル 3D モデル。
//
// world 座標系で +Z (= +t = 未来) 方向に塔状ジオメトリを積み上げ、event 位置を
// 塔の足元に置く。D pattern (per-vertex Lorentz) で描画されるので、観測者が
// 動くと塔が傾く / 縮むという相対論的視覚効果が出る (灯台自身は静止しているが、
// 観測者の rest frame に移ると未来時刻方向の構造体が歪んで見える)。
//
// camera.up = (0, 0, 1) なので display 上では塔がまっすぐ上に立つ。
//
// 構成 (z = world t 方向、event を z=0 として):
//   z = 0.00 .. 1.00  body (taper、bottom 0.40 / top 0.30)
//   z = 0.20, 0.70    body 2 本のダーク帯
//   z = 1.00          balcony torus (xy 平面に水平)
//   z = 1.00 .. 1.30  lantern room (open cylinder、半透明)
//   z = 1.15          lamp emissive sphere (中心)
//   z = 1.30 .. 1.52  roof cone
//   z = 1.52 .. 1.62  spire
const G = {
  body: new THREE.CylinderGeometry(0.30, 0.40, 1.00, 16, 1),
  bodyBand: new THREE.CylinderGeometry(0.405, 0.405, 0.06, 16, 1),
  balcony: new THREE.TorusGeometry(0.34, 0.04, 8, 24),
  lantern: new THREE.CylinderGeometry(0.22, 0.22, 0.30, 12, 1, true),
  lamp: new THREE.SphereGeometry(0.13, 16, 16),
  roof: new THREE.ConeGeometry(0.26, 0.22, 16),
  spire: new THREE.ConeGeometry(0.025, 0.10, 6),
};

// CylinderGeometry / ConeGeometry は default で +Y 軸沿い。world +Z (= +t) に
// 起こすため X 軸まわり π/2 回転。Torus は default で xy 平面 (法線 +Z) なので回転不要。
const ROT_Y_TO_Z: [number, number, number] = [Math.PI / 2, 0, 0];

// 塔全体高さ ~1.62 の約 10% を event 位置より下に沈めて「地面に埋まった土台」表現。
// anchorPos (past-cone 判定) はそのまま、視覚シフトのみ inner group で適用。
const LIGHTHOUSE_SINK = 0.16;

export const LighthouseRenderer = ({ player }: { player: RelativisticPlayer }) => {
  const { displayMatrix, observerPos, observerBoost } = useDisplayFrame();

  const mainColor = useMemo(() => getThreeColor(LIGHTHOUSE_COLOR), []);
  const wallColor = useMemo(() => new THREE.Color("hsl(190, 22%, 86%)"), []);
  const trimColor = useMemo(() => new THREE.Color("hsl(190, 75%, 28%)"), []);
  const lampColor = useMemo(() => new THREE.Color("hsl(190, 100%, 92%)"), []);

  const wp = player.phaseSpace.pos;

  // 2026-04-22 統一アルゴリズム: 描画判定は「観測者の過去光円錐が live worldLine を
  // 交差するか否か」の 1 boolean に還元:
  //   - intersection != null → 生存 routing (past-cone ∩ worldLine を anchor)
  //   - intersection == null → 死亡 routing (x_D 固定 + α fade、死亡 event 観測済み)
  //
  // LH の worldLine は kill 時点で freeze (gameLoop が dead LH スキップ)、末端 = x_D。
  // past-cone が x_D 到達前は intersection が末端を指す (生存表示)、到達後は null 返却
  // (死亡表示)。α fade 値は τ_0 = past-cone ∩ W_D(τ) を使って `(τ_max − τ_0) / τ_max` を
  // `[0, 1]` に clamp → τ_max 後は自動的に 0 = 非表示。追加の窓チェック不要。
  const uD = useMemo(() => getVelocity4(player.phaseSpace.u), [player.phaseSpace.u]);
  const aliveIntersection = observerPos
    ? pastLightConeIntersectionWorldLine(player.worldLine, observerPos)
    : null;
  const isObservedDead = player.isDead && aliveIntersection == null;

  let alpha = 1;
  if (isObservedDead && observerPos) {
    const tau0 = pastLightConeIntersectionDeathWorldLine(wp, uD, observerPos);
    alpha =
      tau0 != null ? Math.max(0, (DEATH_TAU_MAX - tau0) / DEATH_TAU_MAX) : 0;
  }
  const towerAnchor = isObservedDead ? wp : (aliveIntersection?.pos ?? null);

  // 球マーカーは 2 種類の責務を分離して並存:
  //   (A) pastConeSpherePos: worldLine の過去光円錐交差点。観測者が「今まさに
  //       見ている」LH 位置で、tower base と同位置に載る。aliveIntersection null
  //       のフレーム (respawn 光未到達 / 死亡 fade 完了 / worldLine 空) は非表示。
  //   (B) futureMostSpherePos: worldLine の未来側末端 = `phaseSpace.pos` (= 世界
  //       時刻 now)。観測者からはまだ光が届いていない「現在」位置を示し、(A)
  //       との display gap が光速遅延の pedagogical 可視化となる。respawn した
  //       瞬間から光到達を待たず常時表示 (= 新しい世界点の獲得と同時にマーク開始)。
  //       gate は `!player.isDead` のみ — 死亡中は wp が x_D に freeze するので
  //       描くと未来情報 (死亡位置) が先行露出するため抑止。
  const pastConeSpherePos = aliveIntersection
    ? transformEventForDisplay(aliveIntersection.pos, observerPos, observerBoost)
    : null;
  const futureMostSpherePos = !player.isDead
    ? transformEventForDisplay(wp, observerPos, observerBoost)
    : null;
  const sphereSize = PLAYER_MARKER_SIZE_OTHER;

  return (
    <>
    {towerAnchor && (
    <group
      matrix={buildApparentShapeMatrix(
        towerAnchor,
        player.phaseSpace.u,
        player.phaseSpace.heading,
        observerPos,
        displayMatrix,
      )}
      matrixAutoUpdate={false}
    >
    <group position={[0, 0, -LIGHTHOUSE_SINK * 0.5]} scale={0.5}>
      {/* Body: tapered cylinder, base at event */}
      <mesh renderOrder={-1} position={[0, 0, 0.50]} rotation={ROT_Y_TO_Z} geometry={G.body}>
        <meshStandardMaterial
          color={wallColor}
          emissive={mainColor}
          emissiveIntensity={0.25}
          roughness={0.55}
          metalness={0.05}
          transparent
          depthWrite={false}
          opacity={0.95 * alpha}
        />
      </mesh>

      {/* Two horizontal bands */}
      <mesh renderOrder={-1} position={[0, 0, 0.20]} rotation={ROT_Y_TO_Z} geometry={G.bodyBand}>
        <meshStandardMaterial
          color={trimColor}
          emissive={trimColor}
          emissiveIntensity={0.4}
          transparent
          depthWrite={false}
          opacity={0.95 * alpha}
        />
      </mesh>
      <mesh renderOrder={-1} position={[0, 0, 0.70]} rotation={ROT_Y_TO_Z} geometry={G.bodyBand}>
        <meshStandardMaterial
          color={trimColor}
          emissive={trimColor}
          emissiveIntensity={0.4}
          transparent
          depthWrite={false}
          opacity={0.95 * alpha}
        />
      </mesh>

      {/* Balcony torus (sits flat in xy plane, encircling lantern base) */}
      <mesh renderOrder={-1} position={[0, 0, 1.00]} geometry={G.balcony}>
        <meshStandardMaterial
          color={trimColor}
          emissive={mainColor}
          emissiveIntensity={0.4}
          roughness={0.4}
          metalness={0.3}
          transparent
          depthWrite={false}
          opacity={0.95 * alpha}
        />
      </mesh>

      {/* Lantern room: open cylinder, semi-transparent so lamp is visible */}
      <mesh renderOrder={-1} position={[0, 0, 1.15]} rotation={ROT_Y_TO_Z} geometry={G.lantern}>
        <meshStandardMaterial
          color={mainColor}
          emissive={mainColor}
          emissiveIntensity={0.7}
          roughness={0.3}
          transparent
          depthWrite={false}
          opacity={0.55 * alpha}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Lamp: bright emissive sphere */}
      <mesh renderOrder={-1} position={[0, 0, 1.15]} geometry={G.lamp}>
        <meshBasicMaterial color={lampColor} transparent depthWrite={false} opacity={alpha} />
      </mesh>

      {/* Roof cone */}
      <mesh renderOrder={-1} position={[0, 0, 1.41]} rotation={ROT_Y_TO_Z} geometry={G.roof}>
        <meshStandardMaterial
          color={trimColor}
          emissive={mainColor}
          emissiveIntensity={0.4}
          roughness={0.5}
          metalness={0.2}
          transparent
          depthWrite={false}
          opacity={0.95 * alpha}
        />
      </mesh>

      {/* Spire */}
      <mesh renderOrder={-1} position={[0, 0, 1.57]} rotation={ROT_Y_TO_Z} geometry={G.spire}>
        <meshStandardMaterial
          color={trimColor}
          emissive={mainColor}
          emissiveIntensity={0.6}
          transparent
          depthWrite={false}
          opacity={alpha}
        />
      </mesh>
    </group>
    </group>
    )}

    {/* (A) 過去光円錐 ∩ 世界線マーカー (C pattern)。観測者が見ている LH 位置。 */}
    {pastConeSpherePos && (
      <group position={[pastConeSpherePos.x, pastConeSpherePos.y, pastConeSpherePos.t]}>
        <mesh
          renderOrder={-1}
          scale={[sphereSize, sphereSize, sphereSize]}
          geometry={sharedGeometries.playerSphere}
        >
          <meshStandardMaterial
            color={mainColor}
            emissive={mainColor}
            emissiveIntensity={0.4}
            roughness={0.3}
            metalness={0.1}
            transparent
            depthWrite={false}
            opacity={PLAYER_MARKER_MAIN_OPACITY_OTHER}
          />
        </mesh>
        <mesh
          renderOrder={-1}
          scale={[sphereSize * 1.8, sphereSize * 1.8, sphereSize * 1.8]}
          geometry={sharedGeometries.playerSphere}
        >
          <meshBasicMaterial
            color={mainColor}
            transparent
            depthWrite={false}
            opacity={PLAYER_MARKER_GLOW_OPACITY_OTHER}
          />
        </mesh>
      </group>
    )}

    {/* (B) 世界線未来側末端 = world-now マーカー (C pattern)。光速遅延の pedagogical
        可視化 (past-cone marker との display gap = 光が観測者に届くまでの距離)。 */}
    {futureMostSpherePos && (
      <group position={[futureMostSpherePos.x, futureMostSpherePos.y, futureMostSpherePos.t]}>
        <mesh
          renderOrder={-1}
          scale={[sphereSize, sphereSize, sphereSize]}
          geometry={sharedGeometries.playerSphere}
        >
          <meshStandardMaterial
            color={mainColor}
            emissive={mainColor}
            emissiveIntensity={0.4}
            roughness={0.3}
            metalness={0.1}
            transparent
            depthWrite={true}
            opacity={PLAYER_MARKER_MAIN_OPACITY_OTHER}
          />
        </mesh>
        <mesh
          renderOrder={-1}
          scale={[sphereSize * 1.8, sphereSize * 1.8, sphereSize * 1.8]}
          geometry={sharedGeometries.playerSphere}
        >
          <meshBasicMaterial
            color={mainColor}
            transparent
            depthWrite={false}
            opacity={PLAYER_MARKER_GLOW_OPACITY_OTHER}
          />
        </mesh>
      </group>
    )}

    {/* 死亡 marker (sphere + ring): (x_D, u_D) から τ_0 を内部計算、DEATH_TAU_EFFECT_MAX 窓で on/off。 */}
    {player.isDead && (
      <DeathMarker xD={wp} uD={uD} color={mainColor} />
    )}
    </>
  );
};
