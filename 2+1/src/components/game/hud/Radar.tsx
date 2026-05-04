import { useEffect, useRef } from "react";
import {
  createVector4,
  lorentzBoost,
  multiplyVector4Matrix4,
  pastLightConeIntersectionWorldLine,
  subVector4Torus,
} from "../../../physics";
import { useTorusHalfWidth } from "../../../hooks/useTorusHalfWidth";
import { useGameStore } from "../../../stores/game-store";
import { ARENA_RADIUS } from "../constants";
import { pastLightConeIntersectionLaser } from "../laserPhysics";
import { isLighthouse } from "../lighthouse";
import { isTouchDevice } from "./utils";

const RADAR_SIZE_PC = 180;
const RADAR_SIZE_MOBILE = 140;
// 近距離を大きく見せるためズーム。arena 円周ははみ出す (clip される)。
const RADAR_VIEW_RADIUS = ARENA_RADIUS * 0.7;
const RADAR_VIEW_RADIUS_FULLSCREEN = ARENA_RADIUS * 1.6;
const SELF_DOT_RADIUS = 3;
const PLAYER_DOT_RADIUS = 3.5;
const LIGHTHOUSE_DOT_RADIUS = 5;
const FROZEN_DOT_RADIUS = 2.5;
// 黄金 gnomon (acute): 頂角 36°、脚:底辺 = φ:1 (threeCache.ts の laserIntersectionTriangle
// と同比)。高さ h = 半底辺 · √(4φ + 3)。radar 側は screen px で表現。
const PHI = (1 + Math.sqrt(5)) / 2;
const LASER_TRI_LEN = 7.5; // 三角形の tip → 底辺までの screen px
const LASER_TRI_HALF_W = LASER_TRI_LEN / Math.sqrt(4 * PHI + 3); // 底辺の半幅 px
const ARENA_SAMPLES = 64; // 過去光円錐 ∩ arena boundary の描画サンプル数

/**
 * 画面左下の円形トップダウン・レーダー。正射影 xy 面を **heading-up** で回転
 * (= `cameraYaw` 方向がレーダー上方)。プロットするのは他機 / 灯台 / 凍結世界線 /
 * レーザーの **過去光円錐交点** (= 今「見えている」時空点)。world-frame の
 * 正射影図を radar 座標に回転してミニマップにする (main view の orthographic
 * モードと座標系は同じ、yaw 回転だけ追加)。
 *
 * Canvas 2D、`requestAnimationFrame` で毎フレーム再描画。state 購読は
 * `useGameStore.getState()` で直接読む (state 変化での re-render は不要、
 * RAF 側で新しい値を拾う)。devicePixelRatio で retina crisp。toggle off 時は
 * component 自体がアンマウントされる。
 */
export const Radar = ({
  myId,
  cameraYawRef,
  fullscreen = false,
}: {
  myId: string | null;
  cameraYawRef: React.RefObject<number>;
  fullscreen?: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smallSize = isTouchDevice ? RADAR_SIZE_MOBILE : RADAR_SIZE_PC;
  const size = fullscreen
    ? Math.min(window.innerWidth, window.innerHeight)
    : smallSize;
  const torusHalfWidth = useTorusHalfWidth();
  // useEffect closure 内で raf 経由で読むため ref に持たせる (毎 frame 最新値が要る)
  const torusHalfWidthRef = useRef<number | undefined>(torusHalfWidth);
  torusHalfWidthRef.current = torusHalfWidth;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const radius = size / 2;

    let raf = 0;
    const draw = () => {
      const state = useGameStore.getState();
      const players = state.players;
      const lasers = state.lasers;
      const frozenWorldLines = state.frozenWorldLines;
      const rawMyPlayer = myId ? players.get(myId) : null;
      // 死亡中は myGhostPhaseSpace で observer frame を構築 (= player.phaseSpace は
      // 死亡時刻で凍結されているため)。 SceneContent / HUD / CenterCompass と同じ
      // swap pattern。 詳細: 2026-05-04 plan: mydeathevent-decomposition。
      const myPlayer =
        rawMyPlayer?.isDead && state.myGhostPhaseSpace
          ? { ...rawMyPlayer, phaseSpace: state.myGhostPhaseSpace }
          : rawMyPlayer;

      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;

      // 円形背景 (完全不透明 — 3D シーンを完全上書き)
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fill();

      if (myPlayer) {
        const viewRadius = fullscreen ? RADAR_VIEW_RADIUS_FULLSCREEN : RADAR_VIEW_RADIUS;
        const scale = radius / viewRadius;
        const obsPos = myPlayer.phaseSpace.pos;
        const obsU = myPlayer.phaseSpace.u;
        // 観測者の静止系への Lorentz boost。past-cone 上の event を rest-frame 空間
        // 座標に変換してから描画する (radar は「観測者の静止系・真上 orthographic」)。
        const boost = lorentzBoost(obsU);
        // heading-up 回転: rest-frame xy → radar 基底。rotation angle α = π/2 − yaw
        // (yaw 方向が canvas 上方向 = math +y、さらに canvas は y 下向きで最終反転)。
        // cos(π/2 − yaw) = sin(yaw)、sin(π/2 − yaw) = cos(yaw)。
        const yaw = cameraYawRef.current;
        const cosA = Math.sin(yaw);
        const sinA = Math.cos(yaw);
        // World 4-event (t, x, y, 0) を観測者静止系の空間 delta に落とす。
        // torus mode では (x, y) を最短画像 delta で取る (= 反対側の相手も radar 内に収まる)。
        const halfW = torusHalfWidthRef.current;
        const boostEvent = (
          t: number,
          x: number,
          y: number,
        ): [number, number] => {
          const delta = subVector4Torus(createVector4(t, x, y, 0), obsPos, halfW);
          const r = multiplyVector4Matrix4(boost, delta);
          return [r.x, r.y];
        };
        const projectRest = (
          restX: number,
          restY: number,
        ): [number, number] => {
          const rx = restX * cosA - restY * sinA;
          const ry = restX * sinA + restY * cosA;
          return [cx + rx * scale, cy - ry * scale];
        };
        const projectEvent = (
          t: number,
          x: number,
          y: number,
        ): [number, number] => {
          const [rx, ry] = boostEvent(t, x, y);
          return projectRest(rx, ry);
        };

        // 円形内にクリップ
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
        ctx.clip();

        // Arena 円周: 観測者過去光円錐 ∩ {world 座標で半径 ARENA_RADIUS} の locus を
        // 角度サンプリングで。rest-frame では一般に歪む (Lorentz 収縮 + 光円錐) ので
        // 正円ではない。ごく薄く。
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= ARENA_SAMPLES; i++) {
          const theta = (i / ARENA_SAMPLES) * Math.PI * 2;
          const ex = ARENA_RADIUS * Math.cos(theta);
          const ey = ARENA_RADIUS * Math.sin(theta);
          const et = obsPos.t - Math.hypot(ex - obsPos.x, ey - obsPos.y);
          const [sx, sy] = projectEvent(et, ex, ey);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // 他機 (人間 + 灯台) past-cone 交点
        for (const player of players.values()) {
          if (player.id === myId) continue;
          const ix = pastLightConeIntersectionWorldLine(
            player.worldLine,
            obsPos,
            halfW,
          );
          if (!ix) continue;
          const isLH = isLighthouse(player.id);
          const r = isLH ? LIGHTHOUSE_DOT_RADIUS : PLAYER_DOT_RADIUS;
          const [sx, sy] = projectEvent(ix.pos.t, ix.pos.x, ix.pos.y);
          ctx.fillStyle = player.color;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
          if (isLH) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // 凍結世界線 (死体) past-cone 交点 — 薄く
        for (const fw of frozenWorldLines) {
          if (isLighthouse(fw.playerId)) continue;
          const ix = pastLightConeIntersectionWorldLine(fw.worldLine, obsPos, halfW);
          if (!ix) continue;
          const [sx, sy] = projectEvent(ix.pos.t, ix.pos.x, ix.pos.y);
          ctx.fillStyle = fw.color;
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.arc(sx, sy, FROZEN_DOT_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // レーザー past-cone 交点 (飛翔中の光子位置) を進行方向へ向けた小三角形で。
        // rest-frame では photon direction は aberration (光行差) で変わる: 4-momentum
        // (1, dhat_world) を boost して rest-frame 3-direction を得る。
        for (const laser of lasers) {
          const ix = pastLightConeIntersectionLaser(laser, obsPos);
          if (!ix) continue;
          const photonRest = multiplyVector4Matrix4(
            boost,
            createVector4(
              1,
              laser.direction.x,
              laser.direction.y,
              laser.direction.z,
            ),
          );
          const pxy = Math.hypot(photonRest.x, photonRest.y);
          if (pxy < 1e-6) continue;
          const rndx = photonRest.x / pxy;
          const rndy = photonRest.y / pxy;
          // heading-up 回転 (α = π/2 − yaw)。canvas y は下向きなので最終反転。
          const rdx = rndx * cosA - rndy * sinA;
          const rdy = rndx * sinA + rndy * cosA;
          const sdx = rdx;
          const sdy = -rdy;
          // 重心を past-cone 交点に一致させる (threeCache.laserIntersectionTriangle と
          // 同じ配置: tip = +2h/3、base = −h/3)。
          const [centerX, centerY] = projectEvent(ix.t, ix.x, ix.y);
          const tipX = centerX + sdx * ((2 / 3) * LASER_TRI_LEN);
          const tipY = centerY + sdy * ((2 / 3) * LASER_TRI_LEN);
          const baseCX = centerX - sdx * ((1 / 3) * LASER_TRI_LEN);
          const baseCY = centerY - sdy * ((1 / 3) * LASER_TRI_LEN);
          const pSx = -sdy;
          const pSy = sdx;
          ctx.fillStyle = laser.color;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(baseCX + pSx * LASER_TRI_HALF_W, baseCY + pSy * LASER_TRI_HALF_W);
          ctx.lineTo(baseCX - pSx * LASER_TRI_HALF_W, baseCY - pSy * LASER_TRI_HALF_W);
          ctx.closePath();
          ctx.fill();
        }

        // Arena 中心 (= 原点) past-cone 交点。 自機の現在地から見た「中心方向」 を可視化、
        // 「遠くに行って戻れない」 onboarding 問題対策 (EXPLORING.md §「遠くに行って
        // 戻れない」 問題 1b、 2026-05-02 odakin 自律実装)。 観測者の過去光円錐と
        // worldline {(t, 0, 0): t ∈ ℝ} の交点 = `(obs.t − |obs.xy|, 0, 0)`。 torus mode は
        // subVector4Torus で最短画像 origin に折り畳まれるので「最寄り image cell の中心」
        // が表示される。 自機本体 (中心) との重なり対策で半径小、 視認性は cross "+" で補強。
        {
          const originDist = Math.hypot(obsPos.x, obsPos.y);
          const originT = obsPos.t - originDist;
          const [oSx, oSy] = projectEvent(originT, 0, 0);
          ctx.fillStyle = "rgba(220, 220, 220, 0.85)";
          ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(oSx, oSy, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // cross "+" で「中心」 感を補強 (= 単純な dot だと他機と区別しにくい)
          ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(oSx - 5, oSy);
          ctx.lineTo(oSx + 5, oSy);
          ctx.moveTo(oSx, oSy - 5);
          ctx.lineTo(oSx, oSy + 5);
          ctx.stroke();
        }

        // 自機 (中心、白縁取り)。heading-up なので上方向 = 自機前方。
        if (!myPlayer.isDead) {
          ctx.fillStyle = myPlayer.color;
          ctx.strokeStyle = "white";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, SELF_DOT_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      }

      // 外枠の円 (clip の外側に描画、bold)
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [myId, size, fullscreen, cameraYawRef]);

  return (
    <div
      style={
        fullscreen
          ? {
              position: "fixed",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              pointerEvents: "none",
              backgroundColor: "black",
            }
          : {
              position: "absolute",
              bottom: "10px",
              left: "10px",
              zIndex: 9999,
              pointerEvents: "none",
            }
      }
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: `${size}px`,
          height: `${size}px`,
        }}
      />
    </div>
  );
};
