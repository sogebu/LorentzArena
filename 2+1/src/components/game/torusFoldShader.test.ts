import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createTorusFoldShader } from "./torusFoldShader";

const makeShader = () =>
  ({
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: `
uniform vec3 cameraPosition;
#include <common>
void main() {
  #include <begin_vertex>
  #include <project_vertex>
}`,
    fragmentShader: "void main() {}",
  }) as unknown as THREE.WebGLProgramParametersWithUniforms;

describe("createTorusFoldShader", () => {
  it("uniforms に uTorusHalfWidth と uObserverPos を設定", () => {
    const obs = new THREE.Vector3(1, 2, 3);
    const fold = createTorusFoldShader(20, obs);
    const s = makeShader();
    fold(s);
    expect(s.uniforms.uTorusHalfWidth.value).toBe(20);
    // Vector3 の参照を共有 (= caller が in-place 更新で auto sync)
    expect(s.uniforms.uObserverPos.value).toBe(obs);
  });

  it("vertex shader に uniform 宣言と fold ロジックを注入", () => {
    const fold = createTorusFoldShader(20, new THREE.Vector3());
    const s = makeShader();
    fold(s);
    expect(s.vertexShader).toContain("uniform float uTorusHalfWidth");
    expect(s.vertexShader).toContain("uniform vec3 uObserverPos");
    // fold compute 本体: transformed.xy = obs.xy + minImage(transformed.xy - obs.xy)
    expect(s.vertexShader).toContain("transformed.xy - uObserverPos.xy");
    expect(s.vertexShader).toContain(
      "transformed.xy = uObserverPos.xy + tfDelta",
    );
  });

  it("fold は begin_vertex の **直後** に注入される (= transformed が初期化された後)", () => {
    const fold = createTorusFoldShader(20, new THREE.Vector3());
    const s = makeShader();
    fold(s);
    const beginIdx = s.vertexShader.indexOf("#include <begin_vertex>");
    const foldIdx = s.vertexShader.indexOf("transformed.xy = uObserverPos.xy");
    const projectIdx = s.vertexShader.indexOf("#include <project_vertex>");
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(foldIdx).toBeGreaterThan(beginIdx);
    expect(projectIdx).toBeGreaterThan(foldIdx);
  });

  it("inject key が無い shader では skip して console.warn", () => {
    const fold = createTorusFoldShader(20, new THREE.Vector3());
    const s = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "void main() { gl_Position = vec4(0); }",
      fragmentShader: "void main() {}",
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fold(s);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[torusFoldShader]"),
    );
    // uniforms は設定された (warn は inject 部分の skip のみ、 caller responsibility は果たす)
    expect(s.uniforms.uTorusHalfWidth.value).toBe(20);
    warnSpy.mockRestore();
  });
});
