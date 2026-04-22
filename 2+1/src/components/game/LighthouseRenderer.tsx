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

  // 2026-04-22 統一アルゴリズム: 描画判定は「死亡 event 世界線分 [0, τ_max] が観測者
  // 過去光円錐に引っかかっているか否か」の 1 boolean に還元 (plans/死亡イベント.md §2-7)。
  //   - τ_0 ∈ [0, τ_max]         → 死亡 routing: x_D 固定 + α fade + DeathMarker
  //   - それ以外 (未到達 / 不在 / 通過後) → 生存 routing: past-cone ∩ player.worldLine
  //
  // 生存 routing の anchor には `pastLightConeIntersectionWorldLine` を使う。非 LH player と
  // 同じ唯一の source of truth:
  //   - 生存中: past-cone ∩ 現在世界線
  //   - 死亡 pre-cone (τ_0 < 0): past-cone ∩ pre-death 世界線 (worldLine は kill 時点で freeze)
  //   - 死亡 post-fade (τ_0 > τ_max): worldLine 末端超過で null → 非描画
  //   - spawn 光未到達: history[0] より過去で null → 非描画
  const uD = useMemo(() => getVelocity4(player.phaseSpace.u), [player.phaseSpace.u]);
  const tau0 =
    player.isDead && observerPos
      ? pastLightConeIntersectionDeathWorldLine(wp, uD, observerPos)
      : null;
  const useDeathRouting = tau0 != null && tau0 >= 0 && tau0 <= DEATH_TAU_MAX;

  const aliveIntersection = observerPos
    ? pastLightConeIntersectionWorldLine(player.worldLine, observerPos)
    : null;

  const alpha = useDeathRouting ? (DEATH_TAU_MAX - tau0!) / DEATH_TAU_MAX : 1;
  const towerAnchor = useDeathRouting ? wp : (aliveIntersection?.pos ?? null);

  // 現在世界時刻位置の球マーカー: 死亡 routing 中は非表示 (塔 fade + DeathMarker が担う)、
  // それ以外は wp の display 並進で表示 (alive: 世界時刻 now、dead-pre-cone: x_D)。
  const showSphere = !useDeathRouting;
  const dpNow = transformEventForDisplay(wp, observerPos, observerBoost);
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

    {/* 現在世界時刻位置の球マーカー (C pattern)。死亡中は非表示。 */}
    {showSphere && (
      <group position={[dpNow.x, dpNow.y, dpNow.t]}>
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

    {/* 死亡 marker (sphere + ring): (x_D, u_D) から τ_0 を内部計算、DEATH_TAU_EFFECT_MAX 窓で on/off。 */}
    {player.isDead && (
      <DeathMarker xD={wp} uD={uD} color={mainColor} />
    )}
    </>
  );
};
