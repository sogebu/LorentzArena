import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGameStore } from "../../stores/game-store";
import { useDisplayFrame } from "./DisplayFrameContext";
import {
	STARDUST_GRID_SIZE,
	STARDUST_MAX_WORLDLINES_PER_CELL,
	STARDUST_COLOR,
	STARDUST_SIZE,
	STARDUST_SPATIAL_RANGE,
	STARDUST_TIME_RANGE,
	TIME_FADE_SCALE,
} from "./constants";
import { applyTimeFadeShader } from "./timeFadeShader";

const hashCell = (cx: number, cy: number, ct: number): number => {
	const p1 = 73856093;
	const p2 = 19349663;
	const p3 = 83492791;
	return Math.abs((cx * p1) ^ (cy * p2) ^ (ct * p3));
};

const seededRandom = (seed: number): number => {
	const x = Math.sin(seed) * 10000;
	return x - Math.floor(x);
};

const generateStardustPoints = (
	observerX: number,
	observerY: number,
	observerT: number,
): [number, number, number][] => {
	const points: [number, number, number][] = [];

	const cellXMin = Math.floor(observerX / STARDUST_GRID_SIZE) - 1;
	const cellXMax = Math.ceil(observerX / STARDUST_GRID_SIZE) + 1;
	const cellYMin = Math.floor(observerY / STARDUST_GRID_SIZE) - 1;
	const cellYMax = Math.ceil(observerY / STARDUST_GRID_SIZE) + 1;

	const cellTMin = Math.floor(observerT / STARDUST_GRID_SIZE) - 1;
	const cellTMax = Math.ceil(observerT / STARDUST_GRID_SIZE) + 1;

	// グリッドセル内に決定論的に点を生成
	for (let cx = cellXMin; cx <= cellXMax; cx++) {
		for (let cy = cellYMin; cy <= cellYMax; cy++) {
			for (let ct = cellTMin; ct <= cellTMax; ct++) {
				const cellHash = hashCell(cx, cy, ct);
				const numPoints =
					(cellHash % STARDUST_MAX_WORLDLINES_PER_CELL) + 1;

				for (let p = 0; p < numPoints; p++) {
					const seed = cellHash + p * 1000;
					const r1 = seededRandom(seed);
					const r2 = seededRandom(seed + 1);
					const r3 = seededRandom(seed + 2);

					const x =
						cx * STARDUST_GRID_SIZE +
						(r1 - 0.5) * STARDUST_GRID_SIZE;
					const y =
						cy * STARDUST_GRID_SIZE +
						(r2 - 0.5) * STARDUST_GRID_SIZE;
					const t =
						ct * STARDUST_GRID_SIZE +
						(r3 - 0.5) * STARDUST_GRID_SIZE;

					points.push([x, y, t]);
				}
			}
		}
	}

	return points;
};

export const StardustRenderer = () => {
	const { displayMatrix } = useDisplayFrame();
	const observerPos = useGameStore((state) => state.observer);

	const pointsGeometry = useMemo(() => {
		const geo = new THREE.BufferGeometry();

		if (!observerPos) {
			geo.setAttribute(
				"position",
				new THREE.BufferAttribute(new Float32Array(0), 3),
			);
			return geo;
		}

		const pointsArray = generateStardustPoints(
			observerPos.x,
			observerPos.y,
			observerPos.t,
		);

		if (pointsArray.length === 0) {
			geo.setAttribute(
				"position",
				new THREE.BufferAttribute(new Float32Array(0), 3),
			);
			return geo;
		}

		const positions = new Float32Array(pointsArray.length * 3);
		pointsArray.forEach((p, idx) => {
			positions[idx * 3] = p[0];
			positions[idx * 3 + 1] = p[1];
			positions[idx * 3 + 2] = p[2];
		});

		geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		return geo;
	}, [observerPos]);

	const pointsMaterial = useMemo(() => {
		const mat = new THREE.PointsMaterial({
			color: STARDUST_COLOR,
			size: STARDUST_SIZE,
			sizeAttenuation: true,
			transparent: true,
			opacity: 0.6,
		});

		// D パターン: per-vertex 時間 fade シェーダを適用
		applyTimeFadeShader(mat, TIME_FADE_SCALE);
		return mat;
	}, []);

	const points = useMemo(
		() => new THREE.Points(pointsGeometry, pointsMaterial),
		[pointsGeometry, pointsMaterial],
	);

	useFrame(() => {
		if (!displayMatrix) return;

		// 表示変換適用: 世界座標系 → 観測者フレーム
		points.matrix.copy(displayMatrix);
		points.matrixAutoUpdate = false;
		points.matrixWorldNeedsUpdate = true;
	});

	return <primitive object={points} />;
};
