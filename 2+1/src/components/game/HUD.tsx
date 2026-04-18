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
  showRadar: boolean;
  setShowRadar: (v: boolean) => void;
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
  showRadar,
  setShowRadar,
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

  const myPlayer = myId ? players.get(myId) : undefined;
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
        showRadar={showRadar}
        setShowRadar={setShowRadar}
        killGlow={killGlow}
        getPlayerColor={getPlayerColor}
      />

      {showRadar && <Radar myId={myId} cameraYawRef={cameraYawRef} />}

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
        myLaserColor={myLaserColor}
        killNotification={killNotification}
        myDeathEvent={myDeathEvent}
      />
    </>
  );
};
