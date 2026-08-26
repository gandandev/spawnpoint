import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientChoice } from "@/types";

export interface GameSession {
  client: ClientChoice["id"];
  username: string;
  launchId: string;
}

export function GameScreen({ game, gameUrl, onClose }: { game: GameSession; gameUrl: string; onClose: () => void }) {
  return <main className="fixed inset-0 z-50 size-full bg-black" aria-label="마인크래프트 플레이">
    <iframe title={`마인크래프트 ${game.client}`} src={gameUrl} className="size-full border-0" allow="fullscreen; gamepad; clipboard-read; clipboard-write" allowFullScreen />
    <Button variant="secondary" size="icon-sm" className="game-close-button size-11 opacity-70 hover:opacity-100 focus-visible:opacity-100 sm:size-7" onClick={onClose} aria-label="게임 종료">
      <X />
    </Button>
  </main>;
}
