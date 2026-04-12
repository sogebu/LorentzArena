import { useI18n } from "../../i18n";
import type { DeathEvent, RelativisticPlayer } from "./types";
import { ControlPanel } from "./hud/ControlPanel";
import { Overlays } from "./hud/Overlays";
import { Speedometer } from "./hud/Speedometer";

type HUDProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  scores: Record<string, number>;
  fps: number;
  showInRestFrame: boolean;
  setShowInRestFrame: (v: boolean) => void;
  useOrthographic: boolean;
  setUseOrthographic: (v: boolean) => void;
  energy: number;
  isFiring: boolean;
  myLaserColor: string;
  deathFlash: boolean;
  killGlow: boolean;
  killNotification: { victimName: string; color: string } | null;
  myDeathEvent?: DeathEvent | null;
  getPlayerColor: (peerId: string) => string;
};

export const HUD = ({
  players,
  myId,
  scores,
  fps,
  showInRestFrame,
  setShowInRestFrame,
  useOrthographic,
  setUseOrthographic,
  energy,
  isFiring,
  myLaserColor,
  deathFlash,
  killGlow,
  killNotification,
  myDeathEvent,
  getPlayerColor,
}: HUDProps) => {
  const { t } = useI18n();
  const myPlayer = myId ? players.get(myId) : undefined;

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
        killGlow={killGlow}
        getPlayerColor={getPlayerColor}
      />

      {myPlayer && (
        <Speedometer
          player={myPlayer}
          energy={energy}
          myLaserColor={myLaserColor}
          t={t}
        />
      )}

      <Overlays
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
