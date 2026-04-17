import type * as THREE from "three";
import {
  STARDUST_FLASH_FUTURE_BOOST,
  STARDUST_FLASH_PAST_BOOST,
  STARDUST_FLASH_SIGMA,
  TIME_FADE_SCALE,
} from "./constants";

/**
 * Stardust 専用 shader: 時間 fade (Lorentzian) + 光円錐通過 flash (Gaussian)。
 *
 * 光円錐面 (rest frame で display z = ±ρ) を spark が通過する瞬間に alpha boost。
 * 過去 cone は強め、未来 cone は控えめ (届いていない event の情報量差)。
 *
 * rest frame では `modelMatrix × vertex` が観測者相対 (boost + T(-observer)) なので
 * tfDisplayPos.xyz をそのまま使える。world frame では `displayMatrix = I` で絶対座標に
 * なるため flash は正しく出ないが、通常プレイは rest frame なので許容 (簡素化優先)。
 */
export const applyStardustShader = (shader: THREE.Shader): void => {
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
      "gl_PointSize = size * (1.0 + sdFlashBoost);",
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
