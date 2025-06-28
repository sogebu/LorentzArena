import type React from "react";
import { useEffect, useRef } from "react";
import {
  type PhaseSpace,
  type Vector3,
  createVector3,
  createVector4,
  lengthVector3,
  lengthSquaredVector3,
  subVector3,
  scaleVector3,
  getPositionPhaseSpace,
  getVelocityPhaseSpace,
  getCoordinateTimePhaseSpace,
  lorentzBoost,
  multiplyVector4Matrix4,
  subVector4,
  spatialVector4,
} from "../physics";

interface WebGLGridProps {
  observerPhaseSpace: PhaseSpace;
  screenSize: { width: number; height: number };
  LIGHT_SPEED: number;
  GRID_SIZE: number;
}

const VISIBLE_RANGE = 20; // より広い範囲のグリッドを表示
const GRID_SUBDIVISION = 4; // グリッドの分割数を増やして滑らかに

// 頂点シェーダー
const vertexShaderSource = `
  attribute vec2 position;
  uniform vec2 resolution;
  varying vec2 vPosition;
  
  void main() {
    vPosition = position;
    vec2 clipSpace = ((position / resolution) * 2.0) - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
  }
`;

// フラグメントシェーダー
const fragmentShaderSource = `
  precision mediump float;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vPosition;
  uniform vec2 center;
  
  void main() {
    float dist = distance(vPosition, center);
    float maxDist = length(center);
    float fade = 1.0 - smoothstep(maxDist * 0.5, maxDist * 1.5, dist);
    gl_FragColor = vec4(color, opacity * fade);
  }
`;

const WebGLGrid: React.FC<WebGLGridProps> = ({
  observerPhaseSpace,
  screenSize,
  LIGHT_SPEED,
  GRID_SIZE,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      console.error("WebGL not supported");
      return;
    }

    glRef.current = gl;

    // シェーダーのコンパイル
    const compileShader = (source: string, type: number) => {
      const shader = gl.createShader(type);
      if (!shader) return null;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    };

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

    if (!vertexShader || !fragmentShader) return;

    // プログラムの作成
    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    programRef.current = program;

    // クリーンアップ
    return () => {
      if (glRef.current && programRef.current) {
        glRef.current.deleteProgram(programRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    if (!gl || !program) return;

    // Canvas サイズ設定
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = screenSize.width;
    canvas.height = screenSize.height;
    gl.viewport(0, 0, screenSize.width, screenSize.height);

    // プログラムを使用
    gl.useProgram(program);

    // アトリビュートとユニフォームの取得
    const positionLocation = gl.getAttribLocation(program, "position");
    const resolutionLocation = gl.getUniformLocation(program, "resolution");
    const colorLocation = gl.getUniformLocation(program, "color");
    const opacityLocation = gl.getUniformLocation(program, "opacity");
    const centerLocation = gl.getUniformLocation(program, "center");

    // バッファの作成
    const positionBuffer = gl.createBuffer();

    // 観測者の状態を取得
    const observerPos4 = observerPhaseSpace.position4;
    const observerVel = getVelocityPhaseSpace(observerPhaseSpace);
    const observerPos = getPositionPhaseSpace(observerPhaseSpace);

    // グリッドオフセット
    const gridOffsetX = Math.floor((observerPos.x * LIGHT_SPEED) / GRID_SIZE);
    const gridOffsetY = Math.floor((observerPos.y * LIGHT_SPEED) / GRID_SIZE);

    // 速度に応じたグリッド色
    const velocity = lengthVector3(observerVel);
    const gridOpacity = Math.max(0.3, 0.8 - velocity * 0.5);
    const gridColor = velocity > 0.5 ? [0.4, 0.4, 0.4] : [0.27, 0.27, 0.27];
    
    // WebGLの線幅（実装によっては効果がない場合があります）
    gl.lineWidth(1.0);

    // 過去光円錐変換
    const applyPastLightConeTransform = (worldPos: Vector3): Vector3 => {
      const spatialDistance = lengthVector3(subVector3(worldPos, observerPos));
      const lightTravelTime = spatialDistance;
      const emissionTime =
        getCoordinateTimePhaseSpace(observerPhaseSpace) - lightTravelTime;

      const worldPos4 = createVector4(
        emissionTime,
        worldPos.x,
        worldPos.y,
        worldPos.z,
      );

      if (lengthSquaredVector3(observerVel) === 0) {
        return subVector3(worldPos, observerPos);
      }

      const boostToObserver = lorentzBoost(scaleVector3(observerVel, -1));
      const relativePos4 = subVector4(worldPos4, observerPos4);
      const transformedPos4 = multiplyVector4Matrix4(
        boostToObserver,
        relativePos4,
      );

      return spatialVector4(transformedPos4);
    };

    // 頂点データを生成
    const vertices: number[] = [];

    // 横線
    for (let i = -VISIBLE_RANGE; i <= VISIBLE_RANGE; i++) {
      const points: { x: number; y: number }[] = [];
      
      // 中心からの距離に応じて分割数を調整（LOD）
      const distFromCenter = Math.abs(i);
      const subdivision = distFromCenter > VISIBLE_RANGE * 0.6 ? 2 : GRID_SUBDIVISION;

      for (let j = -VISIBLE_RANGE; j <= VISIBLE_RANGE; j += 1 / subdivision) {
        const worldPos = createVector3(
          ((j + gridOffsetX) * GRID_SIZE) / LIGHT_SPEED,
          ((i + gridOffsetY) * GRID_SIZE) / LIGHT_SPEED,
          0,
        );

        const transformedPos = applyPastLightConeTransform(worldPos);
        points.push({
          x: transformedPos.x * LIGHT_SPEED + screenSize.width / 2,
          y: transformedPos.y * LIGHT_SPEED + screenSize.height / 2,
        });
      }

      for (let k = 0; k < points.length - 1; k++) {
        // 画面外の線分はスキップ（パフォーマンス最適化）
        const p1 = points[k];
        const p2 = points[k + 1];
        if (
          (p1.x < -500 && p2.x < -500) ||
          (p1.x > screenSize.width + 500 && p2.x > screenSize.width + 500) ||
          (p1.y < -500 && p2.y < -500) ||
          (p1.y > screenSize.height + 500 && p2.y > screenSize.height + 500)
        ) {
          continue;
        }
        vertices.push(p1.x, p1.y);
        vertices.push(p2.x, p2.y);
      }
    }

    // 縦線
    for (let j = -VISIBLE_RANGE; j <= VISIBLE_RANGE; j++) {
      const points: { x: number; y: number }[] = [];
      
      // 中心からの距離に応じて分割数を調整（LOD）
      const distFromCenter = Math.abs(j);
      const subdivision = distFromCenter > VISIBLE_RANGE * 0.6 ? 2 : GRID_SUBDIVISION;

      for (let i = -VISIBLE_RANGE; i <= VISIBLE_RANGE; i += 1 / subdivision) {
        const worldPos = createVector3(
          ((j + gridOffsetX) * GRID_SIZE) / LIGHT_SPEED,
          ((i + gridOffsetY) * GRID_SIZE) / LIGHT_SPEED,
          0,
        );

        const transformedPos = applyPastLightConeTransform(worldPos);
        points.push({
          x: transformedPos.x * LIGHT_SPEED + screenSize.width / 2,
          y: transformedPos.y * LIGHT_SPEED + screenSize.height / 2,
        });
      }

      for (let k = 0; k < points.length - 1; k++) {
        // 画面外の線分はスキップ（パフォーマンス最適化）
        const p1 = points[k];
        const p2 = points[k + 1];
        if (
          (p1.x < -500 && p2.x < -500) ||
          (p1.x > screenSize.width + 500 && p2.x > screenSize.width + 500) ||
          (p1.y < -500 && p2.y < -500) ||
          (p1.y > screenSize.height + 500 && p2.y > screenSize.height + 500)
        ) {
          continue;
        }
        vertices.push(p1.x, p1.y);
        vertices.push(p2.x, p2.y);
      }
    }

    // 頂点データをGPUに送信
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    // 描画設定
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // ユニフォームを設定
    gl.uniform2f(resolutionLocation, screenSize.width, screenSize.height);
    gl.uniform3fv(colorLocation, gridColor);
    gl.uniform1f(opacityLocation, gridOpacity);
    gl.uniform2f(centerLocation, screenSize.width / 2, screenSize.height / 2);

    // 線を描画
    gl.drawArrays(gl.LINES, 0, vertices.length / 2);

  }, [observerPhaseSpace, screenSize, LIGHT_SPEED, GRID_SIZE]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
};

export default WebGLGrid;