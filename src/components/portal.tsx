import { ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { ChevronDown, Server, ServerOff } from "@/components/pixel-icons";
import { api } from "@/lib/api";
import type { OnlinePlayer, ServerStatus } from "@/types";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { currentSiteName } from "@/lib/site-name";
import { cn } from "@/lib/utils";

export function AnimatedHeight({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!content) return;
    const updateHeight = () => setHeight(content.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);

  return (
    <div
      className="shrink-0 overflow-hidden transition-[height] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] focus-within:overflow-visible motion-reduce:transition-none"
      style={{ height }}
    >
      <div ref={setContent} className="p-1">{children}</div>
    </div>
  );
}

export function Logo() {
  const siteName = currentSiteName();
  return <div className="ml-1 flex shrink-0 select-none items-center gap-3" aria-label={siteName}>
    <svg aria-hidden="true" className="size-[18px]" viewBox="0 0 18 18" fill="none">
      <path fill="#96ce4d" fillRule="evenodd" d="M0 0h18v13H13v5H0zM4 4v7h7V4z" />
    </svg>
    <span className="flex items-center gap-1.5 max-[359px]:hidden">
      <span className="font-mark text-sm font-bold tracking-normal">{siteName}</span>
      <span className="font-mark text-[10px] font-normal tabular-nums text-muted-foreground/60" data-build-number>v{__BUILD_NUMBER__}</span>
    </span>
  </div>;
}

function useStatusLabel(status: ServerStatus) {
  const [now, setNow] = useState(() => Date.now());
  const waiting = status.phase === "online" && status.players.length === 0 && status.idleShutdownAt !== null;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  if (status.phase !== "online") return { text: status.phase === "off" ? "오프라인" : status.phase === "error" ? "오류" : "준비 중" };
  if (status.players.length) return { text: "온라인", detail: `${status.players.length}명` };
  const minutes = status.idleShutdownAt ? Math.max(0, Math.ceil((status.idleShutdownAt - now) / 60_000)) : null;
  return { text: "온라인", detail: minutes === null ? "0명" : `0명 · ${minutes}분 후 자동 종료` };
}

function ServerStatusIcon({ status, className }: { status: ServerStatus; className?: string }) {
  const Icon = status.phase === "off" ? ServerOff : Server;
  return <Icon className={className} />;
}

interface ServerCardProps {
  status: ServerStatus;
  showPlayerDropdown?: boolean;
}

export function ServerCard({ status, showPlayerDropdown = false }: ServerCardProps) {
  const label = useStatusLabel(status);
  const starting = status.phase === "preparing" || status.phase === "starting";
  const playerSignature = status.players.join("\u0000");
  const canExpand = showPlayerDropdown && status.phase === "online" && status.players.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  useEffect(() => {
    if (canExpand) return;
    setExpanded(false);
    setPlayers([]);
  }, [canExpand]);

  useEffect(() => {
    if (!expanded || !canExpand) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const refreshPlayers = async () => {
      controller = new AbortController();
      setLoadingPlayers(true);
      try {
        const result = await api<{ players: OnlinePlayer[] }>("/server/players", { signal: controller.signal });
        if (active) setPlayers(result.players);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          const fallbackPlayers = playerSignature ? playerSignature.split("\u0000") : [];
          setPlayers(fallbackPlayers.map((gameUsername) => ({ gameUsername, displayName: gameUsername })));
        }
      } finally {
        if (active) {
          setLoadingPlayers(false);
          timer = window.setTimeout(() => void refreshPlayers(), 10_000);
        }
      }
    };
    void refreshPlayers();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [canExpand, expanded, playerSignature]);

  const compactStatusContent = <>
      {starting && <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-[shimmer_1.5s_linear_infinite] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,.6),transparent)] bg-[length:200%_100%]" />}
      <ServerStatusIcon status={status} className={cn("relative size-4 shrink-0 text-muted-foreground", status.phase === "online" && "text-[#65952c]")} />
      <strong className={cn("relative text-sm", status.phase === "online" && "text-[#65952c]")}>{label.text}</strong>
      {canExpand ? <span className="relative ml-auto flex items-center gap-1.5 text-sm font-medium text-[#65952c]">
        <span className="tabular-nums">{status.players.length}명</span><ChevronDown className="t-acc-chevron size-4" />
      </span> : status.phase === "online" ? label.detail && <span className="relative ml-auto mr-2 text-sm text-[#65952c]">{label.detail}</span> : null}
    </>;

  return <Card size="sm" className={cn("server-card t-acc relative gap-0 overflow-hidden border-0 bg-muted py-0 shadow-none ring-0", status.phase === "online" && "bg-[#96ce4d]/15", canExpand && "cursor-pointer transition-[background-color,transform] duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-[#96ce4d]/25 has-[:active]:scale-[var(--scale-large)] has-[:active]:bg-[#96ce4d]/35 motion-reduce:transition-none motion-reduce:has-[:active]:scale-100")} data-open={expanded}>
    {canExpand && <button
        type="button"
        className="t-acc-toggle absolute inset-0 z-10 touch-manipulation cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#65952c]/30"
        aria-expanded={expanded}
        aria-controls="online-player-list"
        aria-label={`온라인 ${status.players.length}명, 접속자 목록 ${expanded ? "접기" : "펼치기"}`}
        onClick={() => setExpanded((current) => !current)}
      />}
    <div className={cn("relative flex min-h-11 select-none items-center gap-3 px-2 pl-3.5", canExpand && "pr-3.5")}>{compactStatusContent}</div>
    {canExpand && <div id="online-player-list" className="t-acc-panel" aria-hidden={!expanded}><div className="t-acc-panel-inner"><div className="px-3.5 pb-3 pt-0">
      {loadingPlayers && players.length === 0 ? <span className="flex items-center gap-2 text-xs text-[#65952c]"><Spinner />접속자 확인 중</span> : <ul className="block" aria-label="현재 플레이 중인 사람">
        {players.map((player, index) => <li key={player.gameUsername} className="inline font-mark text-sm text-[#4f7622]" title={player.gameUsername}>{player.displayName}{index < players.length - 1 && <span aria-hidden="true">, </span>}</li>)}
      </ul>}
    </div></div></div>}
  </Card>;

}
