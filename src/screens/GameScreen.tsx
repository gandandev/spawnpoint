import { useEffect, useRef } from "react";

export interface GameSession {
  username: string;
  launchId: string;
  spectator?: boolean;
}

export function GameScreen({ game, gameUrl, visible = true, onExit }: { game: GameSession; gameUrl: string; visible?: boolean; onExit: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wasHidden = useRef(false);

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

  useEffect(() => {
    if (visible) iframeRef.current?.focus();
    else document.activeElement instanceof HTMLElement && document.activeElement.blur();
    iframeRef.current?.contentWindow?.postMessage({ type: "spawnpoint:visibility", launchId: game.launchId, visible, reconnect: visible && wasHidden.current }, window.location.origin);
    wasHidden.current = !visible;
  }, [visible, game.launchId]);

  return <main hidden={!visible} aria-hidden={!visible} className="fixed inset-0 z-50 size-full bg-black" aria-label="마인크래프트 플레이">
    <iframe ref={iframeRef} onLoad={() => { if (visible) iframeRef.current?.focus(); }} title="마인크래프트 stable" src={gameUrl} className="size-full border-0" allow="fullscreen; gamepad; microphone; clipboard-read; clipboard-write" allowFullScreen />
  </main>;
}
