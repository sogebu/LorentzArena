import { Fragment, useMemo } from "react";
import * as THREE from "three";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import type { Vector4 } from "../../physics";
import { observableImageCells, requiredImageCellRadius } from "../../physics";
import { getVelocity4 } from "../../physics/vector";
import { pastLightConeIntersectionWorldLine } from "../../physics/worldLine";
import { buildApparentShapeMatrix } from "./apparentShape";
import {
  DEATH_TAU_MAX,
  LIGHT_CONE_HEIGHT,
  LIGHTHOUSE_COLOR,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_SIZE_OTHER,
} from "./constants";
import { DeathMarker } from "./DeathMarker";
import { useDisplayFrame } from "./DisplayFrameContext";
import { pastLightConeIntersectionDeathWorldLine } from "./deathWorldLine";
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
  body: new THREE.CylinderGeometry(0.3, 0.4, 1.0, 16, 1),
  bodyBand: new THREE.CylinderGeometry(0.405, 0.405, 0.06, 16, 1),
  balcony: new THREE.TorusGeometry(0.34, 0.04, 8, 24),
  lantern: new THREE.CylinderGeometry(0.22, 0.22, 0.3, 12, 1, true),
  lamp: new THREE.SphereGeometry(0.13, 16, 16),
  roof: new THREE.ConeGeometry(0.26, 0.22, 16),
  spire: new THREE.ConeGeometry(0.025, 0.1, 6),
};

// CylinderGeometry / ConeGeometry は default で +Y 軸沿い。world +Z (= +t) に
// 起こすため X 軸まわり π/2 回転。Torus は default で xy 平面 (法線 +Z) なので回転不要。
const ROT_Y_TO_Z: [number, number, number] = [Math.PI / 2, 0, 0];

// 塔全体高さ ~1.62 の約 10% を event 位置より下に沈めて「地面に埋まった土台」表現。
// anchorPos (past-cone 判定) はそのまま、視覚シフトのみ inner group で適用。
const LIGHTHOUSE_SINK = 0.16;

export const LighthouseRenderer = ({
  player,
}: {
  player: RelativisticPlayer;
}) => {
  const { displayMatrix, observerPos, observerBoost } = useDisplayFrame();

  const mainColor = useMemo(() => getThreeColor(LIGHTHOUSE_COLOR), []);
  const wallColor = useMemo(() => new THREE.Color("hsl(190, 22%, 86%)"), []);
  const trimColor = useMemo(() => new THREE.Color("hsl(190, 75%, 28%)"), []);
  const lampColor = useMemo(() => new THREE.Color("hsl(190, 100%, 92%)"), []);

  const wp = player.phaseSpace.pos;

  // Tower 描画 referent は 2 ケース、どちらでもなければ描画しない (M23 存在論 gate):
  //   (i) 生存 routing: past-cone ∩ live worldLine が存在 → anchor = intersection.pos, α = 1
  //   (ii) 死亡 routing: aliveIntersection null (= past-cone が worldLine 末端 x_D を通過)
  //        かつ τ_0 = past-cone ∩ W_D(τ) が fade 窓 [0, DEATH_TAU_MAX] 内 → anchor = x_D, α = fade
  // どちらでもない (respawn 光未到達 / 死亡 fade 完了) なら towerAnchor = null → 塔 group
  // 丸ごと非描画 (透明 mesh の draw call も出さない)。
  //
  // LH の worldLine は kill 時点で freeze (gameLoop が dead LH スキップ)、末端 = x_D。
  const uD = useMemo(
    () => getVelocity4(player.phaseSpace.u),
    [player.phaseSpace.u],
  );
  const torusHalfWidth = useTorusHalfWidth();

  // **PBC universal cover (物理的に正しい echo)**: 各 image cell の object は **観測者本人**
  // の過去光円錐上に乗る (= raw spatial 距離での intersection)。 各 image cell ごとに
  // imageObserver = `obs - 2L*(obsCell + cell)` を pastLightConeIntersectionWorldLine に渡して
  // raw 距離 (= torusHalfWidth = undefined) で intersection 計算 → intersection.pos に
  // +2L*(obsCell + cell) を加算して image cell 位置として表示。 これにより 1 周遠い image cell
  // は ~2L 古い timestamp で表示される (= echo として「過去光円錐に何度も当たる」 visual)。
  const cells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);
  const L = torusHalfWidth ?? 0;
  const obsCellX =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.x + L) / (2 * L))
      : 0;
  const obsCellY =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.y + L) / (2 * L))
      : 0;
  const sphereSize = PLAYER_MARKER_SIZE_OTHER;

  return (
    <>
      {cells.map((cell) => {
        const dx = 2 * L * (obsCellX + cell.kx);
        const dy = 2 * L * (obsCellY + cell.ky);
        const cellKey = `${cell.kx},${cell.ky}`;
        // image observer = 観測者を image cell の反対方向に shift (= raw worldLine から見ると
        // 観測者の image が遠ざかる、 raw 距離計算で正しい intersection が得られる)。
        const imageObserver: Vector4 | null = observerPos
          ? { ...observerPos, x: observerPos.x - dx, y: observerPos.y - dy }
          : null;
        const imageAliveIntersection = imageObserver
          ? pastLightConeIntersectionWorldLine(player.worldLine, imageObserver)
          : null;
        let imageTowerAnchor: Vector4 | null = null;
        let alpha = 1;
        if (imageAliveIntersection) {
          imageTowerAnchor = {
            ...imageAliveIntersection.pos,
            x: imageAliveIntersection.pos.x + dx,
            y: imageAliveIntersection.pos.y + dy,
          };
        } else if (player.isDead && imageObserver) {
          const tau0 = pastLightConeIntersectionDeathWorldLine(
            wp,
            uD,
            imageObserver,
          );
          if (tau0 != null && tau0 >= 0 && tau0 <= DEATH_TAU_MAX) {
            imageTowerAnchor = { ...wp, x: wp.x + dx, y: wp.y + dy };
            alpha = (DEATH_TAU_MAX - tau0) / DEATH_TAU_MAX;
          }
        }
        // 球マーカー (raw display position、 fold せず boost のみ): image cell ごとに
        // intersection が異なるので per-image。
        const pastConeSphereRaw = imageAliveIntersection
          ? transformEventForDisplay(
              imageAliveIntersection.pos,
              observerPos,
              observerBoost,
            )
          : null;
        // futureMostSphere = world-now (= phaseSpace.pos)、 image cell ごとに raw + offset。
        const futureMostSphereRaw = !player.isDead
          ? transformEventForDisplay(wp, observerPos, observerBoost)
          : null;
        return (
          <Fragment key={cellKey}>
            {imageTowerAnchor && (
              <group
                matrix={buildApparentShapeMatrix(
                  imageTowerAnchor,
                  player.phaseSpace.u,
                  player.phaseSpace.heading,
                  observerPos,
                  displayMatrix,
                )}
                matrixAutoUpdate={false}
              >
                <group position={[0, 0, -LIGHTHOUSE_SINK * 0.5]} scale={0.5}>
                  {/* Body: tapered cylinder, base at event */}
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 0.5]}
                    rotation={ROT_Y_TO_Z}
                    geometry={G.body}
                  >
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
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 0.2]}
                    rotation={ROT_Y_TO_Z}
                    geometry={G.bodyBand}
                  >
                    <meshStandardMaterial
                      color={trimColor}
                      emissive={trimColor}
                      emissiveIntensity={0.4}
                      transparent
                      depthWrite={false}
                      opacity={0.95 * alpha}
                    />
                  </mesh>
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 0.7]}
                    rotation={ROT_Y_TO_Z}
                    geometry={G.bodyBand}
                  >
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
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 1.0]}
                    geometry={G.balcony}
                  >
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
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 1.15]}
                    rotation={ROT_Y_TO_Z}
                    geometry={G.lantern}
                  >
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
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 1.15]}
                    geometry={G.lamp}
                  >
                    <meshBasicMaterial
                      color={lampColor}
                      transparent
                      depthWrite={false}
                      opacity={alpha}
                    />
                  </mesh>

                  {/* Roof cone */}
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 1.41]}
                    rotation={ROT_Y_TO_Z}
                    geometry={G.roof}
                  >
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
                  <mesh
                    renderOrder={-1}
                    position={[0, 0, 1.57]}
                    rotation={ROT_Y_TO_Z}
                    geometry={G.spire}
                  >
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

            {/* (A) 過去光円錐 ∩ 世界線マーカー — image cell offset 加算済み display position。 */}
            {pastConeSphereRaw && (
              <group
                position={[
                  pastConeSphereRaw.x + dx,
                  pastConeSphereRaw.y + dy,
                  pastConeSphereRaw.t,
                ]}
              >
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

            {/* (B) 世界線未来側末端 = world-now マーカー (image cell offset 加算済み)。 */}
            {futureMostSphereRaw && (
              <group
                position={[
                  futureMostSphereRaw.x + dx,
                  futureMostSphereRaw.y + dy,
                  futureMostSphereRaw.t,
                ]}
              >
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
          </Fragment>
        );
      })}
      {/* 死亡 marker (sphere + ring) — primary image のみ (= DeathMarker は内部で C pattern
        計算、 image 化は Phase D 後続 task)。 */}
      {player.isDead && <DeathMarker xD={wp} uD={uD} color={mainColor} />}
    </>
  );
};
