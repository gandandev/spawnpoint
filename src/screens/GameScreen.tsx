import { useEffect } from "react";
import type { ClientChoice } from "@/types";

export interface GameSession {
  client: ClientChoice["id"];
  username: string;
  launchId: string;
}

export function GameScreen({ game, gameUrl, onExit }: { game: GameSession; gameUrl: string; onExit: () => void }) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "spawnpoint:return-to-menu") return;
      if (event.data.launchId !== game.launchId) return;
      onExit();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [game.launchId, onExit]);

  return <main className="fixed inset-0 z-50 size-full bg-black" aria-label="마인크래프트 플레이">
    <iframe title={`마인크래프트 ${game.client}`} src={gameUrl} className="size-full border-0" allow="fullscreen; gamepad; clipboard-read; clipboard-write" allowFullScreen />
  </main>;
}
