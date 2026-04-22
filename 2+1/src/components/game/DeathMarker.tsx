import * as THREE from "three";
import type { Vector4 } from "../../physics/vector";
import {
  DEATH_TAU_EFFECT_MAX,
  KILL_NOTIFICATION_RING_OPACITY,
  KILL_NOTIFICATION_SPHERE_OPACITY,
} from "./constants";
import {
  evaluateDeathWorldLine,
  pastLightConeIntersectionDeathWorldLine,
} from "./deathWorldLine";
import { useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { sharedGeometries } from "./threeCache";

// DEBUG-SELF-DEATH-MARKER (2026-04-22): 自機死亡 marker 非表示症状の切り分け用。
// 症状特定後にこの debug block 全体を削除する。per-key 500ms スロットル。
const _dbgLast: Record<string, number> = {};
const _dbg = (key: string, msg: string) => {
  const now = Date.now();
  if (now - (_dbgLast[key] ?? 0) < 500) return;
  _dbgLast[key] = now;
  console.debug(`[SELF-DEATH] ${msg}`);
};

/**
 * 死亡 marker (sphere + ring): 2026-04-22 統一アルゴリズム。
 *
 * 入力: (x_D, u_D) のみ。
 *   - x_D: 死亡時空点
 *   - u_D: 死亡時 4-velocity (γ, γv_x, γv_y, γv_z)
 *
 * 表示条件: 観測者過去光円錐と W_D(τ) = x_D + u_D·τ の交点 τ_0 が
 *   `τ_0 ∈ [0, DEATH_TAU_EFFECT_MAX]` の時のみ描画。それ以外 (未到達 / 打ち切り後) は
 *   return null。linear / Lorentzian fade は掛けない (on/off の flash)。
 *
 * 2 つの marker の anchor:
 *   - **Sphere** (死亡球): 死亡時空点 x_D に固定。他者も自分も **同じ** 時空点を指す。
 *     C pattern で display 並進、観測者進行で display.t = (x_D.t − observer.t) が負になり sink。
 *   - **Ring** (死亡リング): W_D(τ_0) = x_D + u_D·τ_0 に anchor。
 *     死者が死亡時 v_D で慣性運動していたら到達するはずの event を「光子が届いた瞬間の
 *     時空点」として記す。u_D=0 (停止死亡) なら x_D.xy 固定 + t 前進 (= 従来の
 *     observer.t − ρ 表現と一致)。
 *
 * Stage 1 (現): ring は C pattern で並進のみ。Stage 2 (後): `(x_D0, u_D)` 中心静止系で
 * ring を描いて世界系に boost (= 進行方向に潰れた楕円)。
 */
export const DeathMarker = ({
  xD,
  uD,
  color,
}: {
  xD: Vector4;
  uD: Vector4;
  color: THREE.Color;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();
  if (!observerPos) {
    // DEBUG-SELF-DEATH-MARKER
    _dbg(`dm-noobs-${xD.t.toFixed(1)}`, `DeathMarker: observerPos=null (xD.t=${xD.t.toFixed(2)})`);
    return null;
  }

  const tau0 = pastLightConeIntersectionDeathWorldLine(xD, uD, observerPos);
  // DEBUG-SELF-DEATH-MARKER
  _dbg(
    `dm-${xD.t.toFixed(1)}`,
    `DeathMarker obs.t=${observerPos.t.toFixed(2)} xD.t=${xD.t.toFixed(2)} ` +
      `dt=${(observerPos.t - xD.t).toFixed(3)} uD=(${uD.t.toFixed(2)},${uD.x.toFixed(2)},${uD.y.toFixed(2)}) ` +
      `tau0=${tau0?.toFixed(3) ?? "null"} window=[0,${DEATH_TAU_EFFECT_MAX}]`,
  );
  if (tau0 == null || tau0 < 0 || tau0 > DEATH_TAU_EFFECT_MAX) {
    _dbg(
      `dm-oow-${xD.t.toFixed(1)}`,
      `DeathMarker early-return: tau0=${tau0} out of [0, ${DEATH_TAU_EFFECT_MAX}]`,
    );
    return null;
  }

  // Sphere @ x_D (C pattern、観測者進行で沈む)。
  const sphereDp = transformEventForDisplay(xD, observerPos, observerBoost);

  // Ring @ W_D(τ_0) (C pattern、並進のみ)。
  const ringWorld = evaluateDeathWorldLine(xD, uD, tau0);
  const ringDp = transformEventForDisplay(ringWorld, observerPos, observerBoost);

  return (
    <>
      <mesh
        geometry={sharedGeometries.killSphere}
        position={[sphereDp.x, sphereDp.y, sphereDp.t]}
      >
        <meshBasicMaterial
          color={color}
          transparent
          depthWrite={false}
          opacity={KILL_NOTIFICATION_SPHERE_OPACITY}
        />
      </mesh>
      <mesh
        geometry={sharedGeometries.killRing}
        position={[ringDp.x, ringDp.y, ringDp.t]}
      >
        <meshBasicMaterial
          color={color}
          transparent
          depthWrite={false}
          opacity={KILL_NOTIFICATION_RING_OPACITY}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
};
