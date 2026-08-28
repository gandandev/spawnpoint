import type { ClientChoice } from "@/types";

export interface GameSession {
  client: ClientChoice["id"];
  username: string;
  launchId: string;
}

export function GameScreen({ game, gameUrl }: { game: GameSession; gameUrl: string }) {
  return <main className="fixed inset-0 z-50 size-full bg-black" aria-label="마인크래프트 플레이">
    <iframe title={`마인크래프트 ${game.client}`} src={gameUrl} className="size-full border-0" allow="fullscreen; gamepad; clipboard-read; clipboard-write" allowFullScreen />
  </main>;
}
