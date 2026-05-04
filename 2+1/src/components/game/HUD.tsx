import { useI18n } from "../../i18n";
import { useGameStore } from "../../stores/game-store";
import { CenterCompass } from "./hud/CenterCompass";
import { ControlPanel } from "./hud/ControlPanel";
import { Overlays } from "./hud/Overlays";
import { Radar } from "./hud/Radar";
import { Speedometer } from "./hud/Speedometer";

type HUDProps = {
  myId: string | null;
  fps: number;
  showInRestFrame: boolean;
  setShowInRestFrame: (v: boolean) => void;
  useOrthographic: boolean;
  setUseOrthographic: (v: boolean) => void;
  showPLCSlice: boolean;
  setShowPLCSlice: (v: boolean) => void;
  plcMode: "2d" | "3d";
  setPlcMode: (v: "2d" | "3d") => void;
  cameraYawRef: React.RefObject<number>;
  energy: number;
  isFiring: boolean;
  myLaserColor: string;
  deathFlash: boolean;
  getPlayerColor: (peerId: string) => string;
};

export const HUD = ({
  myId,
  fps,
  showInRestFrame,
  setShowInRestFrame,
  useOrthographic,
  setUseOrthographic,
  showPLCSlice,
  setShowPLCSlice,
  plcMode,
  setPlcMode,
  cameraYawRef,
  energy,
  isFiring,
  myLaserColor,
  deathFlash,
  getPlayerColor,
}: HUDProps) => {
  const { t } = useI18n();

  // Store selectors
  const players = useGameStore((s) => s.players);
  const scores = useGameStore((s) => s.scores);
  const killNotification = useGameStore((s) => s.killNotification);
  const myGhostPhaseSpace = useGameStore((s) => s.myGhostPhaseSpace);

  const rawMyPlayer = myId ? players.get(myId) : undefined;
  // 死亡中は Speedometer / HUD は ghost (= myGhostPhaseSpace) を観測者として扱う。
  // `players[myId].phaseSpace` は死亡時刻で凍結されているため、速度/世界時刻が止まる。
  const myPlayer =
    rawMyPlayer?.isDead && myGhostPhaseSpace
      ? { ...rawMyPlayer, phaseSpace: myGhostPhaseSpace }
      : rawMyPlayer;
  // RespawnCountdown の React key 用 (= 死亡時刻 coord time、 死亡 player は applyKill で
  // phaseSpace 凍結保持されるため `rawMyPlayer.phaseSpace.pos.t` で derive)。
  const deathPosT =
    rawMyPlayer?.isDead ? rawMyPlayer.phaseSpace.pos.t : null;
  const killGlow = killNotification !== null;

  return (
    <>
      <ControlPanel
        players={players}
        myId={myId}
        scores={scores}
        fps={fps}
        showInRestFrame={showInRestFrame}
        setShowInRestFrame={setShowInRestFrame}
        useOrthographic={useOrthographic}
        setUseOrthographic={setUseOrthographic}
        showPLCSlice={showPLCSlice}
        setShowPLCSlice={setShowPLCSlice}
        plcMode={plcMode}
        setPlcMode={setPlcMode}
        killGlow={killGlow}
        getPlayerColor={getPlayerColor}
      />

      {(!showPLCSlice || plcMode === "2d") && (
        <Radar myId={myId} cameraYawRef={cameraYawRef} fullscreen={showPLCSlice} />
      )}

      {/* Arena 中心方向矢印 + 距離 (= 「遠くに行って戻れない」 onboarding fix、
          EXPLORING.md §1a)。 自機 cameraYaw を screen up と仮定して原点方向を chevron で
          表示。 PLC fullscreen 時も使える (= 2D radar mode で迷子になりやすいため)。 */}
      <CenterCompass myId={myId} cameraYawRef={cameraYawRef} />

      {myPlayer && (
        <Speedometer
          player={myPlayer}
          energy={energy}
          myLaserColor={myLaserColor}
          t={t}
        />
      )}

      <Overlays
        myId={myId}
        isDead={myPlayer?.isDead ?? false}
        deathFlash={deathFlash}
        killGlow={killGlow}
        isFiring={isFiring}
        killNotification={killNotification}
        deathPosT={deathPosT}
      />
    </>
  );
};
