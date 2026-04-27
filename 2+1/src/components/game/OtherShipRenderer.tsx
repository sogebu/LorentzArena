import { Fragment, useMemo, useRef } from "react";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import {
  createVector3,
  lorentzBoost,
  multiplyVector4Matrix4,
  observableImageCells,
  pastLightConeIntersectionWorldLine,
  requiredImageCellRadius,
  type Vector3,
  type Vector4,
} from "../../physics";
import { LIGHT_CONE_HEIGHT } from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { SelfShipRenderer } from "./SelfShipRenderer";
import type { RelativisticPlayer } from "./types";

/**
 * 他機の 3D ship 描画。 SelfShipRenderer (自機と同じ 3D モデル) を流用し、 **観測者本人の
 * 過去光円錐 ∩ 他機世界線** の合成 player を 各 image cell ごとに作って 9 image 描画。
 *
 * **PBC universal cover (物理的に正しい echo)**: 各 image cell ごとに `imageObserver = obs -
 * 2L*(obsCell + cell)` を pastLightConeIntersectionWorldLine に渡して raw 距離 (= 最短画像化
 * なし) で intersection 計算 → intersection.pos に `+2L*(obsCell + cell)` 加算した image
 * position を virtualPlayer.phaseSpace.pos として SelfShipRenderer に渡す。 1 周遠い image cell
 * は ~2L 古い timestamp で表示される (= echo)。
 *
 * 交点 null (image cell に光が届いてない / past-cone が worldLine 末端超過) の image は
 * 非描画。 死亡中は SceneContent の τ_0 routing で DeadShipRenderer + DeathMarker にフォールバック。
 *
 * thrustRef は 9 image で共有 (= 最後 image の thrust 値が残る)、 exhaust visual のみ影響、
 * 軽微。
 */
export const OtherShipRenderer = ({
  player,
}: {
  player: RelativisticPlayer;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();
  const torusHalfWidth = useTorusHalfWidth();

  const thrustRef = useRef<Vector3>(createVector3(0, 0, 0));

  const cells = useMemo(() => {
    if (torusHalfWidth === undefined) return [{ kx: 0, ky: 0 }];
    const R = requiredImageCellRadius(torusHalfWidth, LIGHT_CONE_HEIGHT);
    return observableImageCells(R);
  }, [torusHalfWidth]);
  const L = torusHalfWidth ?? 0;
  const obsCellX =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.x + L) / (2 * L))
      : 0;
  const obsCellY =
    torusHalfWidth !== undefined && observerPos
      ? Math.floor((observerPos.y + L) / (2 * L))
      : 0;

  return (
    <>
      {cells.map((cell) => {
        const dx = 2 * L * (obsCellX + cell.kx);
        const dy = 2 * L * (obsCellY + cell.ky);
        const cellKey = `${cell.kx},${cell.ky}`;
        const imageObserver: Vector4 | null = observerPos
          ? { ...observerPos, x: observerPos.x - dx, y: observerPos.y - dy }
          : null;
        const intersection = imageObserver
          ? pastLightConeIntersectionWorldLine(player.worldLine, imageObserver)
          : null;
        if (!intersection) return <Fragment key={cellKey} />;

        // Subject rest frame proper acceleration (= 各 image instance で同じ ref に上書き、
        // 最後の image 値が exhaust visual に反映される)。
        const alphaRest = multiplyVector4Matrix4(
          lorentzBoost(intersection.u),
          intersection.alpha,
        );
        thrustRef.current = { x: alphaRest.x, y: alphaRest.y, z: 0 };

        // image position = raw intersection + image cell offset
        const imagePos: Vector4 = {
          ...intersection.pos,
          x: intersection.pos.x + dx,
          y: intersection.pos.y + dy,
        };
        const virtualPlayer = {
          id: player.id,
          phaseSpace: {
            pos: imagePos,
            heading: intersection.heading,
          },
          color: player.color,
        };

        return (
          <SelfShipRenderer
            key={cellKey}
            player={virtualPlayer}
            thrustAccelRef={thrustRef}
            observerPos={observerPos}
            observerBoost={observerBoost}
            cannonStyle="laser"
            alpha4={intersection.alpha}
          />
        );
      })}
    </>
  );
};
