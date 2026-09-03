import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Clock3, Eye, EyeOff, History, MessageSquareText, RefreshCw, Search, Server, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAdminHistory } from "@/features/admin-history-hooks";
import { cn } from "@/lib/utils";
import type {
  AdminAccessHistoryEntry,
  AdminChatHistoryEntry,
  AdminHistorySection,
  AdminServerLogHistoryEntry,
} from "@/types";

type HistoryEntry = AdminAccessHistoryEntry | AdminChatHistoryEntry | AdminServerLogHistoryEntry;

const HISTORY_SECTIONS: Array<{ id: AdminHistorySection; label: string; icon: typeof History }> = [
  { id: "chats", label: "채팅", icon: MessageSquareText },
  { id: "access", label: "접속", icon: Wifi },
  { id: "logs", label: "서버 로그", icon: Server },
];

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatDuration(start: number, end: number): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days) return `${days}일 ${hours}시간`;
  if (hours) return `${hours}시간 ${minutes}분`;
  if (minutes) return `${minutes}분 ${rest}초`;
  return `${rest}초`;
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function PlayerHead({ src, name, compact = false }: { src: string; name: string; compact?: boolean }) {
  const fallback = "/assets/skins/spawnpoint.png";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const texture = failed ? fallback : src;
  return <div className={cn("minecraft-player-head", compact && "is-compact")} title={`${name} 스킨`} aria-label={`${name} 머리`}>
    <img src={texture} alt="" className="minecraft-player-head-face" onError={() => setFailed(true)} />
    <img src={texture} alt="" className="minecraft-player-head-hat" onError={() => setFailed(true)} />
  </div>;
}

function ChatHistory({ entries }: { entries: AdminChatHistoryEntry[] }) {
  if (!entries.length) return <HistoryEmpty message="해당 조건의 채팅이 없어요." />;
  return <ol className="flex flex-col gap-2" aria-label="영구 채팅 기록">
    {entries.map((entry) => <li key={entry.id} className="flex gap-3 rounded-lg border bg-background p-3">
      <PlayerHead src={entry.skinUrl} name={entry.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <strong className="font-mark text-sm text-[#65952c]">{entry.displayName}</strong>
          <span className="text-[11px] text-muted-foreground">{entry.gameUsername}</span>
          {entry.channel === "whisper" && <>
            <Badge variant="outline" className="gap-1 text-[10px]"><ArrowRight className="size-3" />귓속말</Badge>
            {entry.recipientSkinUrl && entry.recipientDisplayName && <PlayerHead src={entry.recipientSkinUrl} name={entry.recipientDisplayName} compact />}
            <span className="text-[11px] text-muted-foreground">{entry.recipientDisplayName}</span>
          </>}
          <time className="ml-auto text-[11px] tabular-nums text-muted-foreground" dateTime={new Date(entry.occurredAt).toISOString()}>{formatDateTime(entry.occurredAt)}</time>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.message}</p>
      </div>
    </li>)}
  </ol>;
}

function AccessHistory({ entries }: { entries: AdminAccessHistoryEntry[] }) {
  if (!entries.length) return <HistoryEmpty message="해당 조건의 접속 기록이 없어요." />;
  const now = Date.now();
  return <ol className="flex flex-col gap-2" aria-label="영구 접속 기록">
    {entries.map((entry) => {
      const sessionStart = entry.joinedAt ?? entry.connectedAt;
      const sessionEnd = entry.leftAt ?? entry.disconnectedAt;
      const displayEnd = sessionEnd ?? entry.lastSeenAt;
      return <li key={entry.id} className="rounded-lg border bg-background p-3">
        <div className="flex items-start gap-3">
          <PlayerHead src={entry.skinUrl} name={entry.displayName} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="font-mark truncate text-sm text-[#65952c]">{entry.displayName}</strong>
              <span className="text-[11px] text-muted-foreground">{entry.accountUsername}</span>
              <Badge variant={entry.disconnectedAt === null ? "secondary" : "outline"} className="ml-auto">{entry.disconnectedAt === null ? "접속 중" : "종료"}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{entry.ipAddress}</code>
              <span>{entry.gameUsername}</span>
              <span className="tabular-nums">{formatDuration(sessionStart, sessionEnd ?? now)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="admin-stat"><span>{entry.joinedAt ? "게임 입장" : "게이트웨이 연결"}</span><strong>{formatDateTime(sessionStart)}</strong></div>
          <div className="admin-stat"><span>{sessionEnd ? (entry.leftAt ? "게임 퇴장" : "연결 종료") : "마지막 통신"}</span><strong>{formatDateTime(displayEnd)}</strong></div>
        </div>
      </li>;
    })}
  </ol>;
}

function ServerLogHistory({ entries }: { entries: AdminServerLogHistoryEntry[] }) {
  if (!entries.length) return <HistoryEmpty message="해당 조건의 서버 로그가 없어요." />;
  return <ol className="admin-permanent-log" aria-label="영구 서버 로그">
    {entries.map((entry) => <li key={entry.id}>
      <div className="admin-permanent-log-meta">
        <time dateTime={new Date(entry.occurredAt).toISOString()}>{formatDateTime(entry.occurredAt)}</time>
        <span>{entry.source}</span>
      </div>
      <code>{entry.line}</code>
    </li>)}
  </ol>;
}

function HistoryEmpty({ message }: { message: string }) {
  return <div className="flex min-h-52 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground"><Clock3 className="size-5" />{message}</div>;
}

export function AdminHistoryPanel({ active, csrf }: { active: boolean; csrf: string | null }) {
  const [section, setSection] = useState<AdminHistorySection>("chats");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [revealIp, setRevealIp] = useState(false);
  const history = useAdminHistory<HistoryEntry>({ active, csrf, section, query, from, to, revealIp });

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const applyTimeRange = (event: FormEvent) => {
    event.preventDefault();
    const nextFrom = parseLocalDateTime(fromInput);
    const nextTo = parseLocalDateTime(toInput);
    if (nextFrom !== null && nextTo !== null && nextFrom > nextTo) {
      setRangeError("시작 시간은 끝 시간보다 빨라야 해요.");
      return;
    }
    setRangeError(null);
    setFrom(nextFrom);
    setTo(nextTo);
  };

  const clearTimeRange = () => {
    setFromInput("");
    setToInput("");
    setFrom(null);
    setTo(null);
    setRangeError(null);
  };

  const placeholder = section === "chats"
    ? "이름 또는 채팅 내용 검색"
    : section === "access"
      ? "이름 또는 IP 주소 검색"
      : "서버 로그 내용 검색";

  const selectSection = (nextSection: AdminHistorySection) => {
    setSection(nextSection);
    setSearchInput("");
    setQuery("");
    setRevealIp(false);
  };

  return <div className="admin-history-layout">
    <nav className="admin-history-nav" aria-label="기록 분류">
      {HISTORY_SECTIONS.map(({ id, label, icon: Icon }) => <button
        key={id}
        type="button"
        className={cn("admin-history-nav-button", section === id && "is-selected")}
        aria-current={section === id ? "page" : undefined}
        onClick={() => selectSection(id)}
      ><Icon />{label}</button>)}
    </nav>

    <section className="flex min-w-0 flex-col gap-3">
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} maxLength={100} className="pl-8" placeholder={placeholder} aria-label="영구 기록 검색" autoComplete="off" />
          </div>
          {section === "access" && <Button type="button" variant="outline" size="sm" aria-pressed={revealIp} onClick={() => setRevealIp((value) => !value)}>{revealIp ? <EyeOff /> : <Eye />}{revealIp ? "IP 가리기" : "IP 원문 보기"}</Button>}
          <Button type="button" variant="outline" size="sm" onClick={history.refresh}><RefreshCw />새로고침</Button>
        </div>
        <form className="mt-3 grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]" onSubmit={applyTimeRange}>
          <label className="admin-compact-field">시작 시간<Input type="datetime-local" step={1} value={fromInput} onChange={(event) => setFromInput(event.target.value)} /></label>
          <label className="admin-compact-field">끝 시간<Input type="datetime-local" step={1} value={toInput} onChange={(event) => setToInput(event.target.value)} /></label>
          <Button type="submit" size="sm"><History />시간 적용</Button>
          <Button type="button" variant="ghost" size="sm" disabled={!fromInput && !toInput} onClick={clearTimeRange}>시간 초기화</Button>
        </form>
        {rangeError && <p className="mt-2 text-xs text-destructive">{rangeError}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">기록은 서버 데이터 볼륨에 계속 저장되며, 재시작하거나 서버를 꺼도 남습니다.</p>
      </div>

      {history.isLoading && history.entries.length === 0
        ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />기록 불러오는 중</div>
        : section === "chats"
          ? <ChatHistory entries={history.entries as AdminChatHistoryEntry[]} />
          : section === "access"
            ? <AccessHistory entries={history.entries as AdminAccessHistoryEntry[]} />
            : <ServerLogHistory entries={history.entries as AdminServerLogHistoryEntry[]} />}
      {history.loadError && <p className="text-xs text-destructive">{history.loadError}</p>}
      {history.nextCursor !== null && <Button type="button" variant="outline" size="sm" disabled={history.isLoadingOlder} onClick={() => void history.loadOlder()}>{history.isLoadingOlder ? <Spinner /> : <History />}이전 기록 더 보기</Button>}
    </section>
  </div>;
}
