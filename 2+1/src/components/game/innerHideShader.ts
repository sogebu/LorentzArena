import type * as THREE from "three";

/**
 * Per-vertex inner-radius hide: 観測者 (display frame の origin) からの距離が指定 R 未満
 * の vertex を alpha=0 にして、自機本体周辺で他の geometry (砲身等) と被って見える
 * 「自分の過去光円錐 / 自分の世界線」を消す。
 *
 * D pattern mesh (mesh.matrix = displayMatrix) で使う。`modelMatrix * vertex` が
 * display 座標 (= observer rest frame) を返し、その length が観測者からの距離になる。
 *
 * `applyTimeFadeShader` と並列で onBeforeCompile に流し込んで OK (varying / uniform 名衝突なし)。
 *
 * Usage:
 *   const hide = createInnerHideShader(8.0);
 *   <meshStandardMaterial onBeforeCompile={(s) => { applyTimeFadeShader(s); hide(s); }} />
 */
export const createInnerHideShader = (radius: number) => {
  return (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uInnerHideRadius = { value: radius };
    shader.vertexShader = injectVertex(shader.vertexShader);
    shader.fragmentShader = injectFragment(shader.fragmentShader);
  };
};

const VERTEX_DECL_KEY = "#include <common>";
const VERTEX_COMPUTE_KEY = "#include <project_vertex>";
const FRAGMENT_DECL_KEY = "#include <common>";
const FRAGMENT_APPLY_KEYS = [
  "#include <dithering_fragment>",
  "#include <premultiplied_alpha_fragment>",
];

const injectVertex = (src: string): string => {
  if (!src.includes(VERTEX_DECL_KEY) || !src.includes(VERTEX_COMPUTE_KEY)) {
    console.warn(
      "[innerHideShader] vertex shader inject keys missing; skipping injection",
    );
    return src;
  }
  return src
    .replace(
      VERTEX_DECL_KEY,
      `${VERTEX_DECL_KEY}
varying float vInnerDist;
uniform float uInnerHideRadius;`,
    )
    .replace(
      VERTEX_COMPUTE_KEY,
      `${VERTEX_COMPUTE_KEY}
{
  vec4 ihDisplayPos = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    ihDisplayPos = instanceMatrix * ihDisplayPos;
  #endif
  ihDisplayPos = modelMatrix * ihDisplayPos;
  vInnerDist = length(ihDisplayPos.xyz);
}`,
    );
};

const injectFragment = (src: string): string => {
  const applyKey = FRAGMENT_APPLY_KEYS.find((k) => src.includes(k));
  if (!src.includes(FRAGMENT_DECL_KEY) || !applyKey) {
    console.warn(
      "[innerHideShader] fragment shader inject keys missing; skipping injection",
    );
    return src;
  }
  return src
    .replace(
      FRAGMENT_DECL_KEY,
      `${FRAGMENT_DECL_KEY}
varying float vInnerDist;
uniform float uInnerHideRadius;`,
    )
    .replace(
      applyKey,
      `${applyKey}
if (vInnerDist < uInnerHideRadius) gl_FragColor.a = 0.0;`,
    );
};
