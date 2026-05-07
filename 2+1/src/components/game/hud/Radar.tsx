import { useEffect, useRef } from "react";
import {
  createVector4,
  lorentzBoost,
  multiplyVector4Matrix4,
  pastLightConeIntersectionWorldLine,
  quatToYaw,
  subVector4Torus,
} from "../../../physics";
import { useTorusHalfWidth } from "../../../hooks/useTorusHalfWidth";
import { selectIsDead, useGameStore } from "../../../stores/game-store";
import { ARENA_RADIUS, FUTURE_CONE_LASER_TRIANGLE_OPACITY } from "../constants";
import {
  futureLightConeIntersectionLaser,
  pastLightConeIntersectionLaser,
} from "../laserPhysics";
import { isLighthouse } from "../lighthouse";
import { isTouchDevice } from "./utils";

/** PLC 2D fullscreen mode の ship icon 上面アイコン半径 (px)。 fullscreen canvas は ~800-1080 px
 *  級なので 9 px だと形状認識限界以下 (= 小 dot にしか見えない)、 18 px に bump して
 *  octagon / teardrop / dome shape が読める寸法に (2026-05-07 odakin 「アイコン表示されてない」
 *  指摘で形状不明瞭が判明、 サイズ拡大で対処)。 通常 mini-map (= fullscreen=false) は
 *  `PLAYER_DOT_RADIUS=3.5` の小 dot を維持。 */
const SHIP_ICON_R = 18;

/**
 * Canvas 2D top-down ship icon を描画。 PLC 2D fullscreen mode で 3D ship model を 2D
 * 上面ベクター icon として可視化する (= 2026-05-07 odakin 指示「2D モードでも 3D モデルは
 * なんかいいかんじに表示しよう」)。 viewMode 別に identity を分ける:
 *   - classic (gunship): 八角プリズム → octagon + 機首 cannon line
 *   - shooter (rocket):  teardrop body → 細長い triangle (nose +x、 tail で広がる)
 *   - jellyfish:         dome + 触手 → circle + 5 短い触手線、 +x の触手だけ長い (= 武装触手)
 * ctx は呼び出し側で translate(cx, cy) + rotate(canvasAngle) 済を仮定 (= local +x = forward)。
 * size: icon の基準半径 (px)。 self 強調のため self は他機より 1.4× 大きく描く運用。
 * outline: 白アウトラインを描くか (= self は true で SELF_DOT_RADIUS の白縁取り継承)。
 */
const drawShipIcon = (
  ctx: CanvasRenderingContext2D,
  viewMode: "classic" | "shooter" | "jellyfish",
  color: string,
  size: number = SHIP_ICON_R,
  outline: boolean = false,
) => {
  const outlineStyle = "rgba(255, 255, 255, 0.95)";
  const outlineW = 1.5;
  if (viewMode === "shooter") {
    const tip = size * 1.2;
    const back = -size * 0.7;
    const halfW = size * 0.55;
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(back, halfW);
    ctx.lineTo(back * 0.7, 0);
    ctx.lineTo(back, -halfW);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outlineStyle;
      ctx.lineWidth = outlineW;
      ctx.stroke();
    }
    return;
  }
  if (viewMode === "jellyfish") {
    const innerR = size * 0.65;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outlineStyle;
      ctx.lineWidth = outlineW;
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    const tCount = 5;
    for (let i = 0; i < tCount; i++) {
      const a = (i / tCount) * Math.PI * 2;
      const isArmed = i === 0;
      const len = isArmed ? size * 0.95 : size * 0.55;
      ctx.beginPath();
      ctx.moveTo(innerR * Math.cos(a), innerR * Math.sin(a));
      ctx.lineTo((innerR + len) * Math.cos(a), (innerR + len) * Math.sin(a));
      ctx.stroke();
    }
    return;
  }
  // gunship (classic)
  const verts = 8;
  ctx.beginPath();
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * Math.PI * 2;
    const x = size * 0.7 * Math.cos(a);
    const y = size * 0.7 * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outlineStyle;
    ctx.lineWidth = outlineW;
    ctx.stroke();
  }
  // 機首 cannon line
  ctx.strokeStyle = outline ? outlineStyle : color;
  ctx.lineWidth = outline ? outlineW : 1.6;
  ctx.beginPath();
  ctx.moveTo(size * 0.7, 0);
  ctx.lineTo(size * 1.25, 0);
  ctx.stroke();
};

/** LH 専用 lamp icon サイズ (px)。 outer ring 半径。 SHIP_ICON_R と同寸感で
 *  fullscreen canvas (~800-1080 px) で形状認識できる寸法に。 */
const LH_ICON_R = 16;

/**
 * Lighthouse top-down icon: outer ring + 内 disc + 中央 lamp。 LH の 3D 塔を上から
 * 見た形 (= 円柱 outer ring、 lantern 内 disc、 lamp emissive 球)。 PLC 2D fullscreen では
 * LH も「3D モデル」 として表示する (= 2026-05-07 odakin 「3D モデルは見せて、 マーカー
 * じゃなくて」 指示)。 LH の存在感は維持、 dim dot 系の「marker」 (= world-now / frozen) のみ
 * 撤去で clean な表現を達成。
 */
const drawLighthouseIcon = (
  ctx: CanvasRenderingContext2D,
  color: string,
) => {
  // outer ring (= 塔本体)
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, LH_ICON_R, 0, Math.PI * 2);
  ctx.stroke();
  // 内 disc (= lantern wall 半透明)
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.arc(0, 0, LH_ICON_R * 0.65, 0, Math.PI * 2);
  ctx.fill();
  // 中央 lamp (= bright emissive)
  ctx.fillStyle = "rgba(180, 220, 255, 0.95)";
  ctx.beginPath();
  ctx.arc(0, 0, LH_ICON_R * 0.3, 0, Math.PI * 2);
  ctx.fill();
};

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
      const myIsDead = myId ? selectIsDead(state, myId) : false;
      // 死亡中は myGhostPhaseSpace で observer frame を構築 (= player.phaseSpace は
      // 死亡時刻で凍結されているため)。 SceneContent / HUD / CenterCompass と同じ
      // swap pattern。 詳細: 2026-05-04 plan: mydeathevent-decomposition。
      const myPlayer =
        rawMyPlayer && myIsDead && state.myGhostPhaseSpace
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

        // PLC 2D fullscreen mode の richness 追加 (= 2026-05-07 odakin 指示「PLC スライス 2D も
        // 見た目をリッチに」)。 PLC 3D で描画している同要素を 2D canvas projection で
        // mirror する。 通常 HUD radar (= fullscreen=false) では従来の minimum 表示維持。
        if (fullscreen) {
          // Reference rings (= 距離ガイド concentric circle、 rest-frame ls 単位)。 自機 = 中心
          // (0,0) 固定なので canvas で normal arc。 PLC 3D の reference rings (5/10/15/20) と同等。
          ctx.strokeStyle = "rgba(120, 200, 120, 0.08)";
          ctx.lineWidth = 1;
          for (const r of [5, 10, 15, 20]) {
            const screenR = r * scale;
            if (screenR < 2 || screenR > radius * 1.4) continue;
            ctx.beginPath();
            ctx.arc(cx, cy, screenR, 0, Math.PI * 2);
            ctx.stroke();
          }

          // レーザー世界線 xy 射影 (= PLC 3D §レーザー世界線 line と平行、 emission → tip
          // を rest-frame xy に投影、 「光がいま走っている path」 をうっすら可視化)。
          for (const laser of lasers) {
            const e = laser.emissionPos;
            const tipT = e.t + laser.range;
            const tipX = e.x + laser.direction.x * laser.range;
            const tipY = e.y + laser.direction.y * laser.range;
            const [sxE, syE] = projectEvent(e.t, e.x, e.y);
            const [sxT, syT] = projectEvent(tipT, tipX, tipY);
            ctx.strokeStyle = laser.color;
            ctx.globalAlpha = 0.18;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sxE, syE);
            ctx.lineTo(sxT, syT);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

          // (旧 神視点 world-now dot は 2026-05-07 に PLC 2D fullscreen から撤去。 user 指示
          // 「赤丸のマーカーが邪魔 + 他機のマーカーも要らん」、 他機の現在位置 dim 円が視覚 noise
          // になっていた。 過去光円錐 ∩ worldline 経路 (= 観測者 frame の他機位置) の方は別途
          // 検討対象 (= 下の他機 past-cone block で全 fullscreen 描画停止)。)

          // レーザー未来光円錐交点マーカー (= PLC 3D §laserFutureIntersections と平行、
          // photon が将来 laser 世界線に到達する event)。 past-cone 三角形と同じ黄金 gnomon
          // 形状、 サイズだけ少し小さく (= 2/3、 spacetime mode の past[6,1,1] vs future[1.5,1.5,1.5]
          // の縮約感に対応)、 opacity = FUTURE_CONE_LASER_TRIANGLE_OPACITY × 0.6 = 0.12 で
          // 「時空モードよりさらに薄く、 うっすら」 (odakin 指示)。 photon direction は
          // past-cone 同様 boost で aberration 適用 (= rest-frame 進行方向)。
          const FUTURE_TRI_LEN = LASER_TRI_LEN * (2 / 3);
          const FUTURE_TRI_HALF_W =
            FUTURE_TRI_LEN / Math.sqrt(4 * PHI + 3);
          for (const laser of lasers) {
            const fx = futureLightConeIntersectionLaser(laser, obsPos);
            if (!fx) continue;
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
            const rdx = rndx * cosA - rndy * sinA;
            const rdy = rndx * sinA + rndy * cosA;
            const sdx = rdx;
            const sdy = -rdy;
            const [centerX, centerY] = projectEvent(fx.t, fx.x, fx.y);
            const tipX = centerX + sdx * ((2 / 3) * FUTURE_TRI_LEN);
            const tipY = centerY + sdy * ((2 / 3) * FUTURE_TRI_LEN);
            const baseCX = centerX - sdx * ((1 / 3) * FUTURE_TRI_LEN);
            const baseCY = centerY - sdy * ((1 / 3) * FUTURE_TRI_LEN);
            const pSx = -sdy;
            const pSy = sdx;
            ctx.fillStyle = laser.color;
            ctx.globalAlpha = FUTURE_CONE_LASER_TRIANGLE_OPACITY * 0.6;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(
              baseCX + pSx * FUTURE_TRI_HALF_W,
              baseCY + pSy * FUTURE_TRI_HALF_W,
            );
            ctx.lineTo(
              baseCX - pSx * FUTURE_TRI_HALF_W,
              baseCY - pSy * FUTURE_TRI_HALF_W,
            );
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }

        // 他機 (人間 + 灯台) past-cone 交点。
        // - 通常 mini-map (= fullscreen=false): 従来通り小 dot を描画
        // - PLC 2D fullscreen: viewMode 別の上面 ship icon (= 「3D モデルは見せて、 マーカー
        //   じゃなくて」 odakin 指示 2026-05-07、 平面 dot は marker、 ship icon は 3D model
        //   表現として区別)。 LH も lamp icon で 3D 塔の上面 representation。
        for (const player of players.values()) {
          if (player.id === myId) continue;
          const ix = pastLightConeIntersectionWorldLine(
            player.worldLine,
            obsPos,
            halfW,
          );
          if (!ix) continue;
          const isLH = isLighthouse(player.id);
          const [sx, sy] = projectEvent(ix.pos.t, ix.pos.x, ix.pos.y);
          if (fullscreen) {
            ctx.save();
            ctx.translate(sx, sy);
            if (isLH) {
              // LH は静止前提 + 球対称 lamp なので heading 回転不要。
              drawLighthouseIcon(ctx, player.color);
            } else {
              // 機体 heading をキャンバス座標系の角度に変換 (self 側と同じ式):
              //   canvas y は下向き (= y-flip)、 heading-up rotation で +y_world ≡ canvas up =
              //   -y_canvas。 player heading yaw = yaw_p、 camera yaw = yaw、 canvas での前方
              //   角度 θ = (yaw - yaw_p) - π/2 (= player.yaw = camera.yaw のとき canvas
              //   上向き = -π/2)。
              const playerYaw = quatToYaw(ix.heading);
              const canvasAngle = yaw - playerYaw - Math.PI / 2;
              ctx.rotate(canvasAngle);
              const vm = player.viewMode ?? "classic";
              drawShipIcon(ctx, vm, player.color);
            }
            ctx.restore();
          } else {
            const r = isLH ? LIGHTHOUSE_DOT_RADIUS : PLAYER_DOT_RADIUS;
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
        }

        // 凍結世界線 (死体) past-cone 交点 — 薄く。 PLC 2D fullscreen では「他機マーカー」
        // 一律撤去 (= odakin 指示) に含めて skip。 mini-map のみ従来通り表示。
        if (!fullscreen) for (const fw of frozenWorldLines) {
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

        // 自機 (中心)。 fullscreen mode では viewMode 別 ship icon、 通常 mini-map は従来 dot。
        // heading-up rotation 由来で canvas 上方向 = camera yaw 方向、 自機 heading が camera と
        // 一致 (legacy_classic) なら canvas 上向き = 機首前方。 modern / shooter で heading が
        // camera と独立な場合は canvas angle 計算して回転 (= 他機と同じ式)。
        if (!myIsDead) {
          if (fullscreen) {
            const myYaw = quatToYaw(myPlayer.phaseSpace.heading);
            const myCanvasAngle = yaw - myYaw - Math.PI / 2;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(myCanvasAngle);
            const vm = useGameStore.getState().viewMode;
            // self 強調: 1.4× サイズ + 白アウトラインで他機と差別化 (= 元の SELF_DOT 白縁取り
            // スタイル継承 + ship icon にスケールアップ)。 自機が常に最も視認しやすい位置に居る。
            drawShipIcon(ctx, vm, myPlayer.color, SHIP_ICON_R * 1.4, true);
            ctx.restore();
          } else {
            ctx.fillStyle = myPlayer.color;
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, SELF_DOT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
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
