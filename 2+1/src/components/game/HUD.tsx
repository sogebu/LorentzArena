import { useI18n } from "../../i18n";
import { useGameStore } from "../../stores/game-store";
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
  const myDeathEvent = useGameStore((s) => s.myDeathEvent);

  const rawMyPlayer = myId ? players.get(myId) : undefined;
  // 死亡中は Speedometer / HUD は ghost (myDeathEvent.ghostPhaseSpace) を観測者として扱う。
  // `players[myId].phaseSpace` は死亡時刻で凍結されているため、速度/固有時間が止まる。
  const myPlayer =
    rawMyPlayer?.isDead && myDeathEvent
      ? { ...rawMyPlayer, phaseSpace: myDeathEvent.ghostPhaseSpace }
      : rawMyPlayer;
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
        myDeathEvent={myDeathEvent}
      />
    </>
  );
};
