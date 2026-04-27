import type * as THREE from "three";

/**
 * D pattern mesh の vertex shader に「観測者中心 primary cell `[obs±L]²` への (x, y) 折り
 * 畳み」 を注入。 vertex の world position (transformed = position attribute) を、 観測者
 * 連続位置 (`uObserverPos`) を中心とする最短画像で primary cell 内に折る。 mesh.matrix (=
 * displayMatrix) が `inv(boost) * translate(-obs)` で folded position を画面に並進する
 * ので、 結果として全 vertex が画面 primary cell `[-L, L)²` 内に表示される。
 *
 * fold は `#include <begin_vertex>` の **直後** で transformed に対して行うので、 既存の
 * applyTimeFadeShader / createInnerHideShader と並列で onBeforeCompile に流し込み可:
 *   - timeFade: `modelMatrix * transformed` の z (= dt) を使う。 fold は (x, y) のみで z
 *     不変 → vTimeFade 計算は影響受けない
 *   - innerHide: `transformed - uInnerHideCenter` の world 距離を使う。 fold 後 vertex が
 *     hide center と同 image cell なら近距離 (hide)、 異 image cell なら遠距離 (描画)
 *     → 物理的に妥当 (過去映像の隣接 image 上の vertex は hide しない)
 *
 * `uObserverPos: THREE.Vector3` の参照を caller が `useFrame` で in-place 更新する想定 (=
 * `hideCenter` と同じパターン)。 z 成分は無視 (空間 fold のみ)。
 *
 * 注入順は `fold → timeFade → innerHide`。 fold が transformed を書き換えるので、 後段の
 * shader はそれを引き継ぐ。
 */
export const createTorusFoldShader = (
  halfWidth: number,
  observerPos: THREE.Vector3,
) => {
  return (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uTorusHalfWidth = { value: halfWidth };
    shader.uniforms.uObserverPos = { value: observerPos };
    shader.vertexShader = injectVertex(shader.vertexShader);
  };
};

const VERTEX_DECL_KEY = "#include <common>";
const VERTEX_COMPUTE_KEY = "#include <begin_vertex>";

const injectVertex = (src: string): string => {
  if (!src.includes(VERTEX_DECL_KEY) || !src.includes(VERTEX_COMPUTE_KEY)) {
    console.warn(
      "[torusFoldShader] vertex shader inject keys missing; skipping injection",
    );
    return src;
  }
  return src
    .replace(
      VERTEX_DECL_KEY,
      `${VERTEX_DECL_KEY}
uniform float uTorusHalfWidth;
uniform vec3 uObserverPos;`,
    )
    .replace(
      VERTEX_COMPUTE_KEY,
      `${VERTEX_COMPUTE_KEY}
{
  float tfL = uTorusHalfWidth;
  vec2 tfDelta = transformed.xy - uObserverPos.xy;
  // GLSL mod: x - y * floor(x/y) → 常に [0, y)。 (delta + L) を [0, 2L) に折って -L を
  // 引いて [-L, L)。 floor 基準なので imageCell の floor 基準 (境界 +L で next cell) と一致。
  tfDelta.x = mod(tfDelta.x + tfL, 2.0 * tfL) - tfL;
  tfDelta.y = mod(tfDelta.y + tfL, 2.0 * tfL) - tfL;
  transformed.xy = uObserverPos.xy + tfDelta;
}`,
    );
};
