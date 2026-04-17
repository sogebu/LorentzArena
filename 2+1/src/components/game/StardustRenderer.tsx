import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  STARDUST_GRID_SIZE,
  STARDUST_MAX_SPARKS_PER_CELL,
  STARDUST_COLOR,
  STARDUST_SIZE,
  STARDUST_SPATIAL_RANGE,
  STARDUST_TIME_RANGE,
  TIME_FADE_SCALE,
} from './constants';
import { useGameStore } from '../../stores/game-store';
import { useDisplayFrame } from './DisplayFrameContext';

// Simple hash function for deterministic cell → seed mapping
function hashCell(cx: number, cy: number, ct: number): number {
  let h = 1;
  h = h * 31 + Math.floor(cx);
  h = h * 31 + Math.floor(cy);
  h = h * 31 + Math.floor(ct);
  return Math.abs(h);
}

// Seeded random [0, 1) from seed
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

interface Spark {
  x: number;
  y: number;
  t: number;
}

export function StardustRenderer() {
  const { scene } = useThree();
  const { displayMatrix } = useDisplayFrame();
  const pointsRef = useRef<THREE.Points | null>(null);
  const sparksRef = useRef<Spark[]>([]);
  const lastObserverCellRef = useRef<{ cx: number; cy: number; ct: number }>({ cx: 0, cy: 0, ct: 0 });


  const observers = useGameStore(s => s.players);
  const myId = useGameStore(s => s.myId);

  // Compute observer position from myId
  const observerPos = useMemo(() => {
    if (!myId || !observers) return { x: 0, y: 0, t: 0 };
    const me = observers.get(myId);
    if (!me) return { x: 0, y: 0, t: 0 };
    return {
      x: me.phaseSpace.pos.x,
      y: me.phaseSpace.pos.y,
      t: me.phaseSpace.pos.t,
    };
  }, [observers, myId]);

  // Generate sparks for cells in view window
  const generateSparks = (ox: number, oy: number, ot: number): Spark[] => {
    const sparks: Spark[] = [];
    const cellRange = Math.ceil(STARDUST_SPATIAL_RANGE / STARDUST_GRID_SIZE);
    const timeCellRange = Math.ceil(STARDUST_TIME_RANGE / STARDUST_GRID_SIZE);

    const centerCx = Math.floor(ox / STARDUST_GRID_SIZE);
    const centerCy = Math.floor(oy / STARDUST_GRID_SIZE);
    const centerCt = Math.floor(ot / STARDUST_GRID_SIZE);

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dy = -cellRange; dy <= cellRange; dy++) {
        for (let dt = -timeCellRange; dt <= timeCellRange; dt++) {
          const cx = centerCx + dx;
          const cy = centerCy + dy;
          const ct = centerCt + dt;

          const seed = hashCell(cx, cy, ct);
          const sparkCount = Math.floor(seededRandom(seed) * (STARDUST_MAX_SPARKS_PER_CELL + 1));

          for (let i = 0; i < sparkCount; i++) {
            const subSeed = seed + i * 73;
            const localX = seededRandom(subSeed) * STARDUST_GRID_SIZE;
            const localY = seededRandom(subSeed + 1) * STARDUST_GRID_SIZE;
            const localT = seededRandom(subSeed + 2) * STARDUST_GRID_SIZE;

            sparks.push({
              x: cx * STARDUST_GRID_SIZE + localX,
              y: cy * STARDUST_GRID_SIZE + localY,
              t: ct * STARDUST_GRID_SIZE + localT,
            });
          }
        }
      }
    }

    return sparks;
  };

  // Initialize geometry
  useEffect(() => {
    const initialSparks = generateSparks(observerPos.x, observerPos.y, observerPos.t);
    sparksRef.current = initialSparks;

    const positions = new Float32Array(initialSparks.length * 3);
    initialSparks.forEach((spark, i) => {
      positions[i * 3] = spark.x;
      positions[i * 3 + 1] = spark.y;
      positions[i * 3 + 2] = spark.t;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: STARDUST_COLOR,
      size: STARDUST_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      fog: false,
    });

    const points = new THREE.Points(geometry, material);
    pointsRef.current = points;
    scene.add(points);

    return () => {
      scene.remove(points);
      geometry.dispose();
      (material as THREE.PointsMaterial).dispose();
    };
  }, [scene]);

  // Update sparks as observer moves
  useFrame(() => {
    if (!pointsRef.current || !displayMatrix) return;

    const centerCx = Math.floor(observerPos.x / STARDUST_GRID_SIZE);
    const centerCy = Math.floor(observerPos.y / STARDUST_GRID_SIZE);
    const centerCt = Math.floor(observerPos.t / STARDUST_GRID_SIZE);

    const lastCell = lastObserverCellRef.current;
    if (lastCell.cx !== centerCx || lastCell.cy !== centerCy || lastCell.ct !== centerCt) {
      const newSparks = generateSparks(observerPos.x, observerPos.y, observerPos.t);
      sparksRef.current = newSparks;
      lastObserverCellRef.current = { cx: centerCx, cy: centerCy, ct: centerCt };

      const geometry = pointsRef.current.geometry as THREE.BufferGeometry;
      const positions = new Float32Array(newSparks.length * 3);
      newSparks.forEach((spark, i) => {
        positions[i * 3] = spark.x;
        positions[i * 3 + 1] = spark.y;
        positions[i * 3 + 2] = spark.t;
      });

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.attributes.position.needsUpdate = true;
    }

    // Apply display transform (D pattern)
    pointsRef.current.matrix = displayMatrix;
    pointsRef.current.matrixAutoUpdate = false;
  });

  return null;
}
