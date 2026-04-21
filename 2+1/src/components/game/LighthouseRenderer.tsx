import { useMemo } from "react";
import * as THREE from "three";
import {
  LIGHTHOUSE_COLOR,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_SIZE_OTHER,
} from "./constants";
import { buildApparentShapeMatrix } from "./apparentShape";
import { DeathMarker } from "./DeathMarker";
import { useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { computePastConeDisplayState } from "./pastConeDisplay";
import { getLatestSpawnT } from "./respawnTime";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { RelativisticPlayer } from "./types";
import { useGameStore } from "../../stores/game-store";

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
  // spawn / respawn 時刻は respawnLog 最新 entry から取得 (gap-reset で
  // worldLine.history[0] が上書きされても spawnT が変動しないように)。詳細:
  // `respawnTime.ts §getLatestSpawnT` の JSDoc。
  const respawnLog = useGameStore((s) => s.respawnLog);
  const spawnT = getLatestSpawnT(respawnLog, player);

  // Past-cone anchor / visibility / fade は `computePastConeDisplayState` で共通化
  // (他プレイヤーの死亡 fade と同じロジック、詳細は utility の JSDoc 参照)。
  const { anchorPos, visible, alpha, deathMarkerAlpha } = computePastConeDisplayState(
    wp,
    spawnT,
    player.isDead,
    observerPos,
  );

  // 現在世界時刻位置の球マーカー (C pattern: display 並進のみ、他プレイヤー sphere と同じ表現)。
  // 塔の past-cone visibility とは独立: 生存中は常に表示 (リスポーン直後で塔がまだ
  // 観測者の過去光円錐に入っていない期間でも「現在世界時刻」位置は即座に表示する)。
  // 死亡中は非表示 (塔の沈み + フェードで位置が伝わるため)。
  const showSphere = !player.isDead;
  const dpNow = transformEventForDisplay(wp, observerPos, observerBoost);
  const sphereSize = PLAYER_MARKER_SIZE_OTHER;

  return (
    <>
    {visible && (
    <group
      matrix={buildApparentShapeMatrix(
        anchorPos,
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

    {/* 死亡 marker (sphere + ring): LH も OtherPlayer と同様に扱う (死亡光子到達 fade)。 */}
    {player.isDead && (
      <DeathMarker deathEventPos={wp} alpha={deathMarkerAlpha} color={mainColor} />
    )}
    </>
  );
};
