import type * as THREE from "three";
import {
  STARDUST_FLASH_FUTURE_BOOST,
  STARDUST_FLASH_PAST_BOOST,
  STARDUST_FLASH_SIGMA,
  TIME_FADE_SCALE,
} from "./constants";

/**
 * Stardust 専用 shader: 時間 fade (Lorentzian) + 光円錐通過 flash (Gaussian) + 投影独立の
 * point size 計算。
 *
 * 光円錐面 (observer rest frame で display z = ±ρ) を spark が通過する瞬間に alpha boost。
 * 過去 cone は強め、未来 cone は控えめ (届いていない event の情報量差)。
 *
 * `modelMatrix × vertex` が rest frame では `L(u) · (event − observer)`、world frame では
 * `T(0, 0, −observer.t) · event` (2026-04-20 統一) でいずれも observer 相対の display 座標を返す
 * → `sdPos.xy` = 観測者からの空間ベクトル、`sdPos.z` = Δt として光円錐/fade 判定がフレーム独立。
 *
 * **投影独立な point size**: three.js PointsMaterial の sizeAttenuation は perspective でしか
 * `gl_PointSize *= scale / -mvPos.z` を掛けず ortho では素通し → size=0.04 [pixels] で不可視。
 * 対称化: 両モードで「projection の pixels-per-world-unit」を導出して乗算する。
 *   - perspective: `scale / -mvPos.z` (= 視点からの距離で減衰)
 *   - orthographic: `scale · projectionMatrix[1][1]` (= zoom、depth 非依存)
 * どちらも `scale` (= canvas_height/2) を基準に、投影行列から pixels/world 比を引き出す同じ意味の式。
 * 定数マジックナンバー不要、canvas resize / zoom 変更にも追従。
 */
export const applyStardustShader = (
  shader: THREE.WebGLProgramParametersWithUniforms,
): void => {
  shader.uniforms.uTimeFadeScale = { value: TIME_FADE_SCALE };
  shader.uniforms.uFlashSigma = { value: STARDUST_FLASH_SIGMA };
  shader.uniforms.uPastBoost = { value: STARDUST_FLASH_PAST_BOOST };
  shader.uniforms.uFutureBoost = { value: STARDUST_FLASH_FUTURE_BOOST };
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
varying float vTimeFade;
uniform float uTimeFadeScale;
uniform float uFlashSigma;
uniform float uPastBoost;
uniform float uFutureBoost;
float sdFlashBoost;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
  vec4 sdPos = modelMatrix * vec4(transformed, 1.0);
  float sdRho = length(sdPos.xy);
  float sdDt = sdPos.z;
  float sdR = uTimeFadeScale;
  float sdBase = (sdR * sdR) / (sdR * sdR + sdDt * sdDt);
  float sdPast = sdDt + sdRho;
  float sdFut = sdDt - sdRho;
  float sdSig2 = uFlashSigma * uFlashSigma;
  float sdPF = exp(-sdPast * sdPast / (2.0 * sdSig2));
  float sdFF = exp(-sdFut * sdFut / (2.0 * sdSig2));
  sdFlashBoost = uPastBoost * sdPF + uFutureBoost * sdFF;
  vTimeFade = sdBase * (1.0 + sdFlashBoost);`,
    )
    .replace(
      "gl_PointSize = size;",
      // 両モード統一: size × flash × pixels-per-world-unit を一式で乗算。
      // three.js 後続の #ifdef USE_SIZEATTENUATION は perspective のみ scale/-z を掛けるが、
      // ここで ortho も含めて同じ意味の係数を先に乗じておく → 後続 branch を上書きで相殺
      // するより、ここで完結させる方が対称的。以降の三者式 (isPerspective 分岐) を無効化
      // するため、projectionMatrix[2][3] を見て mode を判定し同一形で書く。
      `float sdPxPerWorld = (projectionMatrix[2][3] == -1.0)
    ? scale / -mvPosition.z
    : scale * projectionMatrix[1][1];
  gl_PointSize = size * (1.0 + sdFlashBoost) * sdPxPerWorld;`,
    )
    // three.js の後続 perspective 分岐は我々で既に処理済 → no-op 化 (二重乗算防止)。
    .replace(
      "if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );",
      "",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
varying float vTimeFade;`,
    )
    .replace(
      "#include <premultiplied_alpha_fragment>",
      `#include <premultiplied_alpha_fragment>
gl_FragColor.a *= vTimeFade;`,
    );
};
