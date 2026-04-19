import * as THREE from "three";

/**
 * Per-vertex inner-radius hide: 指定された world 座標の中心点から半径 R 内の vertex を
 * alpha=0 にして、対象オブジェクト周辺で被って見える geometry を消す。
 *
 * D pattern mesh (vertex は world 座標、mesh.matrix = displayMatrix) で使う。
 *   - centerWorld: world 座標の中心点 (= 隠したい場所、e.g. プレイヤー現在位置)
 *   - radius: world 座標距離 (= 機体サイズ等の係数)
 *
 * shader 内では `length(transformed - uInnerHideCenter)` で world 距離を計算。
 *
 * **重要**: centerWorld は **`THREE.Vector3` インスタンスの参照** を受け取る。caller が
 * `.set(x, y, z)` で in-place 更新すれば、three.js が自動的に uniform 同期する
 * (= per-frame 更新可能)。シーンの観測者・対象 player が動くケースで必須。
 *
 * `applyTimeFadeShader` と並列で onBeforeCompile に流し込み可 (varying / uniform 名衝突なし)。
 *
 * Usage:
 *   const center = new THREE.Vector3();
 *   const hide = createInnerHideShader(R, center);
 *   <meshStandardMaterial onBeforeCompile={(s) => { applyTimeFadeShader(s); hide(s); }} />
 *   // useFrame で毎 tick: center.set(player.pos.x, player.pos.y, player.pos.t);
 */
export const createInnerHideShader = (
  radius: number,
  centerWorld: THREE.Vector3,
) => {
  return (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uInnerHideRadius = { value: radius };
    shader.uniforms.uInnerHideCenter = { value: centerWorld };
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
uniform float uInnerHideRadius;
uniform vec3 uInnerHideCenter;`,
    )
    .replace(
      VERTEX_COMPUTE_KEY,
      `${VERTEX_COMPUTE_KEY}
{
  vec3 ihLocalPos = transformed;
  #ifdef USE_INSTANCING
    ihLocalPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  vInnerDist = length(ihLocalPos - uInnerHideCenter);
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
