import type * as THREE from "three";
import { TIME_FADE_SCALE } from "./constants";

/**
 * Per-vertex time-distance opacity fade (Lorentzian), as an onBeforeCompile shader
 * injection. Designed for D pattern meshes where vertex positions are in world
 * coordinates and the mesh's `matrix` is the observer's display matrix.
 *
 * The vertex stage transforms each vertex through `modelMatrix` (and
 * `instanceMatrix` if present) to obtain the display-frame position; its z
 * component is the observer rest-frame time distance of that vertex from "now".
 * Fade is computed per vertex as
 *
 *   fade = r² / (r² + dt²)   (r = TIME_FADE_SCALE = LIGHT_CONE_HEIGHT / 2)
 *
 * and interpolated into the fragment stage, where it multiplies the final
 * output alpha. This is the GPU counterpart of the formula documented in
 * DESIGN.md §描画「時間的距離 opacity fade」. The CPU-side helper was removed
 * when all targets migrated to per-vertex v1; bring it back if a non-shader
 * path needs the same value.
 *
 * Works with MeshStandardMaterial, MeshBasicMaterial, and LineBasicMaterial
 * (all use `#include <project_vertex>` and `#include <dithering_fragment>`).
 * InstancedMesh is handled via the built-in `USE_INSTANCING` define.
 *
 * If the expected three.js shader keys are ever missing (future version bump),
 * the injector skips with a console warning instead of silently breaking.
 *
 * Usage:
 *   <meshStandardMaterial ... onBeforeCompile={applyTimeFadeShader} />
 */
export const applyTimeFadeShader = (
  shader: THREE.WebGLProgramParametersWithUniforms,
): void => {
  shader.uniforms.uTimeFadeScale = { value: TIME_FADE_SCALE };
  shader.vertexShader = injectVertex(shader.vertexShader);
  shader.fragmentShader = injectFragment(shader.fragmentShader);
};

const VERTEX_DECL_KEY = "#include <common>";
const VERTEX_COMPUTE_KEY = "#include <project_vertex>";
const FRAGMENT_DECL_KEY = "#include <common>";
// Mesh*/Line* materials は `#include <dithering_fragment>` を持つが、PointsMaterial は
// 持たない (three r181 時点、`src/renderers/shaders/ShaderLib/points.glsl.js`)。
// 共通で最後尾にある `#include <premultiplied_alpha_fragment>` にフォールバックする。
// 優先順: dithering を先に試す (既存の Mesh/Line の inject 位置は不変)。
const FRAGMENT_APPLY_KEYS = [
  "#include <dithering_fragment>",
  "#include <premultiplied_alpha_fragment>",
];

const injectVertex = (src: string): string => {
  if (!src.includes(VERTEX_DECL_KEY) || !src.includes(VERTEX_COMPUTE_KEY)) {
    console.warn(
      "[timeFadeShader] vertex shader inject keys missing; skipping injection",
    );
    return src;
  }
  return src
    .replace(
      VERTEX_DECL_KEY,
      `${VERTEX_DECL_KEY}
varying float vTimeFade;
uniform float uTimeFadeScale;`,
    )
    .replace(
      VERTEX_COMPUTE_KEY,
      `${VERTEX_COMPUTE_KEY}
{
  vec4 tfDisplayPos = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    tfDisplayPos = instanceMatrix * tfDisplayPos;
  #endif
  tfDisplayPos = modelMatrix * tfDisplayPos;
  float tfDt = tfDisplayPos.z;
  float tfR = uTimeFadeScale;
  vTimeFade = (tfR * tfR) / (tfR * tfR + tfDt * tfDt);
}`,
    );
};

const injectFragment = (src: string): string => {
  const applyKey = FRAGMENT_APPLY_KEYS.find((k) => src.includes(k));
  if (!src.includes(FRAGMENT_DECL_KEY) || !applyKey) {
    console.warn(
      "[timeFadeShader] fragment shader inject keys missing; skipping injection",
    );
    return src;
  }
  return src
    .replace(
      FRAGMENT_DECL_KEY,
      `${FRAGMENT_DECL_KEY}
varying float vTimeFade;`,
    )
    .replace(
      applyKey,
      `${applyKey}
gl_FragColor.a *= vTimeFade;`,
    );
};
