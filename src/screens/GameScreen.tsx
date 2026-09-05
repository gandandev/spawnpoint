import { useEffect, useRef } from "react";

export interface GameSession {
  username: string;
  launchId: string;
}

export function GameScreen({ game, gameUrl, onExit }: { game: GameSession; gameUrl: string; onExit: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== "spawnpoint:return-to-menu") return;
      if (event.data.launchId !== game.launchId) return;
      onExit();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [game.launchId, onExit]);

  return <main className="fixed inset-0 z-50 size-full bg-black" aria-label="마인크래프트 플레이">
    <iframe ref={iframeRef} title="마인크래프트 stable" src={gameUrl} className="size-full border-0" allow="fullscreen; gamepad; microphone; clipboard-read; clipboard-write" allowFullScreen />
  </main>;
}
