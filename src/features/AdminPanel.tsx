import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownLeft, History, Megaphone, RefreshCw, Search, Settings2, Shield, Terminal, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAdminLogs, useAdminMutation, useAdminOverview } from "@/features/admin-hooks";
import { AdminPlayersPanel } from "@/features/AdminPlayersPanel";
import { AdminServerSettings } from "@/features/AdminServerSettings";
import { AdminHistoryPanel } from "@/features/AdminHistoryPanel";
import type { AdminLogEntry, BootstrapData, SessionUpdate } from "@/types";

type AdminTab = "players" | "settings" | "history" | "title" | "console";
type TitleAudience = "all" | "selected";
type TitleColor = "white" | "gray" | "red" | "gold" | "yellow" | "green" | "aqua" | "blue" | "light_purple";

const TITLE_COLORS: Array<{ value: TitleColor; label: string; swatch: string }> = [
  { value: "white", label: "흰색", swatch: "#f0f1ed" },
  { value: "gray", label: "회색", swatch: "#9b9e96" },
  { value: "red", label: "빨강", swatch: "#d85f5f" },
  { value: "gold", label: "주황", swatch: "#d29a49" },
  { value: "yellow", label: "노랑", swatch: "#d5c44d" },
  { value: "green", label: "초록", swatch: "#73a957" },
  { value: "aqua", label: "청록", swatch: "#55b4ae" },
  { value: "blue", label: "파랑", swatch: "#6687c4" },
  { value: "light_purple", label: "분홍", swatch: "#b875ad" },
];

function logSourceLabel(source: string) {
  if (source === "latest.log") return "현재 또는 최근 실행";
  if (source === "현재 실행") return source;
  return source.replace(/\.log(?:\.gz)?$/, "");
}

function logText(entries: AdminLogEntry[]) {
  const lines: string[] = [];
  let source: string | null = null;
  for (const entry of entries) {
    if (entry.source !== source) {
      source = entry.source;
      lines.push(`──────── ${logSourceLabel(source)} ────────`);
    }
    lines.push(entry.line);
  }
  return lines.join("\n");
}

interface AdminPanelProps {
  data: BootstrapData;
  onSession: (user: SessionUpdate["user"], csrf: string, adminExpiresAt: number | null) => void;
  notice: (message: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

function TitleColorPicker({ value, onChange }: { value: TitleColor; onChange: (value: TitleColor) => void }) {
  return <fieldset className="flex flex-col gap-2">
    <legend className="mb-2 text-sm font-medium">색깔</legend>
    <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-9">
      {TITLE_COLORS.map((color) => <button
        key={color.value}
        type="button"
        className={cn("flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border text-[10px] text-muted-foreground transition-colors hover:bg-muted active:scale-[0.98]", value === color.value && "border-foreground/45 bg-muted text-foreground")}
        aria-label={`타이틀 색깔 ${color.label}`}
        aria-pressed={value === color.value}
        onClick={() => onChange(color.value)}
      >
        <span className="size-4 rounded-full border border-foreground/10" style={{ backgroundColor: color.swatch }} />
        {color.label}
      </button>)}
    </div>
  </fieldset>;
}

interface TitleTarget {
  id: string;
  displayName: string;
  username: string;
}

function TitleTargetPicker({ audience, targets, selected, onAudience, onToggle }: {
  audience: TitleAudience;
  targets: TitleTarget[];
  selected: Set<string>;
  onAudience: (audience: TitleAudience) => void;
  onToggle: (id: string) => void;
}) {
  return <fieldset className="flex flex-col gap-2">
    <legend className="mb-2 text-sm font-medium">받는 사람</legend>
    <ToggleGroup type="single" value={audience} onValueChange={(value) => {
      if (value === "all" || value === "selected") onAudience(value);
    }} variant="outline" spacing={0} className="grid w-full grid-cols-2 p-1">
      <ToggleGroupItem value="all" className="h-9 w-full cursor-pointer text-xs">모든 온라인 사용자</ToggleGroupItem>
      <ToggleGroupItem value="selected" className="h-9 w-full cursor-pointer text-xs">직접 선택</ToggleGroupItem>
    </ToggleGroup>
    {audience === "selected" && <div className="max-h-40 overflow-y-auto rounded-lg border p-1">
      {targets.length ? targets.map((target) => {
        const checked = selected.has(target.id);
        return <button
          key={target.id}
          type="button"
          role="checkbox"
          aria-checked={checked}
          className={cn("flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-muted active:scale-[0.99]", checked && "bg-muted")}
          onClick={() => onToggle(target.id)}
        >
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", checked && "border-[#65952c] bg-[#96ce4d]/20 text-[#65952c]")}>{checked && <Check className="size-3" />}</span>
          <span className="min-w-0 flex-1 truncate">{target.displayName}</span>
          <span className="truncate text-[11px] text-muted-foreground">{target.username}</span>
        </button>;
      }) : <div className="px-3 py-5 text-center text-xs text-muted-foreground">온라인 사용자가 없어요.</div>}
    </div>}
    <div className="text-xs text-muted-foreground">{audience === "all" ? `현재 온라인 ${targets.length}명에게 보냅니다.` : `${selected.size}명을 선택했습니다.`}</div>
  </fieldset>;
}

export function AdminPanel({ data, onSession, notice, open: controlledOpen, onOpenChange, showTrigger = true }: AdminPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [tab, setTab] = useState<AdminTab>("players");
  const [titleText, setTitleText] = useState("");
  const [subtitleText, setSubtitleText] = useState("");
  const [titleColor, setTitleColor] = useState<TitleColor>("white");
  const [titleAudience, setTitleAudience] = useState<TitleAudience>("all");
  const [selectedTitleTargets, setSelectedTitleTargets] = useState<Set<string>>(() => new Set());
  const [consoleCommand, setConsoleCommand] = useState("");
  const [logSearchInput, setLogSearchInput] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const logsRef = useRef<HTMLPreElement>(null);

  const { overview, loadError, loadOverview } = useAdminOverview({ open, csrf: data.csrf });
  const { isBusy, mutate } = useAdminMutation({ csrf: data.csrf, onSession, notice, refresh: loadOverview });
  const logs = useAdminLogs({ active: open && tab === "console", csrf: data.csrf, query: logQuery });

  useEffect(() => {
    const timer = window.setTimeout(() => setLogQuery(logSearchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [logSearchInput]);

  useLayoutEffect(() => {
    if (tab === "console" && !logs.viewingOlder && logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs.entries.length, logs.viewingOlder, tab]);

  const titleTargets = useMemo<TitleTarget[]>(() => overview?.players.filter((player) => player.online).map((player) => ({
    id: player.accountId ?? player.uuid,
    displayName: player.displayName,
    username: player.username,
  })) ?? [], [overview?.players]);

  useEffect(() => {
    const available = new Set(titleTargets.map((target) => target.id));
    setSelectedTitleTargets((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [titleTargets]);

  const canSendTitle = overview?.server.phase === "online"
    && (titleText.trim().length > 0 || subtitleText.trim().length > 0)
    && (titleAudience === "all" ? titleTargets.length > 0 : selectedTitleTargets.size > 0);

  return <Dialog open={open} onOpenChange={(nextOpen) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }}>
    {showTrigger && <DialogTrigger asChild><Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" aria-label="관리자 패널" title="관리자 패널"><Shield /></Button></DialogTrigger>}
    <DialogContent className="max-h-[calc(100dvh-1rem)] min-h-[min(44rem,calc(100dvh-1rem))] w-[calc(100%-1rem)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden p-4 ring-0 sm:max-w-6xl">
      <DialogHeader>
        <div className="flex items-center gap-2"><DialogTitle>관리자 패널</DialogTitle>{overview && <Badge variant="secondary" className={cn("ml-1", overview.server.phase === "online" && "bg-[#96ce4d]/15 text-[#65952c]")}>{overview.server.phase === "online" ? "서버 온라인" : "서버 오프라인"}</Badge>}</div>
        <DialogDescription>플레이어, 서버 설정, 영구 기록, 공지와 콘솔을 한곳에서 관리하세요.</DialogDescription>
      </DialogHeader>
      <ToggleGroup type="single" value={tab} onValueChange={(value) => { if (value === "players" || value === "settings" || value === "history" || value === "title" || value === "console") setTab(value); }} variant="outline" spacing={0} className="admin-primary-tabs grid w-full grid-cols-5 p-1">
        <ToggleGroupItem value="players" className="admin-primary-tab"><Users /><span>플레이어 {overview?.users.filter((user) => user.archivedAt === null).length ?? 0}</span></ToggleGroupItem>
        <ToggleGroupItem value="settings" className="admin-primary-tab"><Settings2 /><span>설정</span></ToggleGroupItem>
        <ToggleGroupItem value="history" className="admin-primary-tab"><History /><span>기록</span></ToggleGroupItem>
        <ToggleGroupItem value="title" className="admin-primary-tab"><Megaphone /><span>타이틀</span></ToggleGroupItem>
        <ToggleGroupItem value="console" className="admin-primary-tab"><Terminal /><span>콘솔</span></ToggleGroupItem>
      </ToggleGroup>
      <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
        {!overview && !loadError && <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />관리자 정보 불러오는 중</div>}
        {loadError && !overview && <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><span>{loadError}</span><Button variant="outline" onClick={() => void loadOverview()}><RefreshCw />다시 시도</Button></div>}
        {overview && tab === "players" && <AdminPlayersPanel overview={overview} currentUserId={data.user!.id} isBusy={isBusy} mutate={mutate} notice={notice} />}
        {overview && tab === "settings" && <AdminServerSettings
          settings={overview.settings}
          serverOnline={overview.server.phase === "online"}
          busy={isBusy("settings")}
          onSave={async (settings) => {
            const result = await mutate("settings", "/admin/settings/server", {
              method: "PUT",
              body: JSON.stringify(settings),
              headers: { "Content-Type": "application/json" },
            });
            if (!result?.settings) return null;
            if (result.liveApplied === false) {
              notice("설정은 저장했지만 온라인 서버에 바로 적용하지 못했어요. 서버를 다시 시작하세요.");
            } else {
              notice(result.restartRequired ? "설정을 저장했어요. 일부 값은 다음 서버 시작 때 적용됩니다." : "설정을 저장하고 적용했어요.");
            }
            return result.settings;
          }}
        />}
        {overview && tab === "history" && <AdminHistoryPanel active={open && tab === "history"} csrf={data.csrf} />}
        {overview && tab === "title" && <form className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-1" onSubmit={async (event) => {
          event.preventDefault();
          if (!canSendTitle) return;
          const result = await mutate("title", "/admin/title", {
            method: "POST",
            body: JSON.stringify({
              title: titleText.trim(),
              subtitle: subtitleText.trim(),
              color: titleColor,
              audience: titleAudience,
              targets: titleAudience === "selected" ? [...selectedTitleTargets] : [],
            }),
            headers: { "Content-Type": "application/json" },
          });
          if (result) notice(`${result.sent ?? 0}명에게 타이틀을 띄웠어요.`);
        }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="admin-title-text">제목</FieldLabel>
              <Input id="admin-title-text" value={titleText} onChange={(event) => setTitleText(event.target.value)} maxLength={64} placeholder="화면 가운데 크게 표시할 문구" autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="admin-subtitle-text">부제목</FieldLabel>
              <Input id="admin-subtitle-text" value={subtitleText} onChange={(event) => setSubtitleText(event.target.value)} maxLength={128} placeholder="제목 아래에 작게 표시할 문구" autoComplete="off" />
              <FieldDescription>제목과 부제목 중 하나만 입력해도 됩니다.</FieldDescription>
            </Field>
          </FieldGroup>
          <TitleColorPicker value={titleColor} onChange={setTitleColor} />
          <TitleTargetPicker
            audience={titleAudience}
            targets={titleTargets}
            selected={selectedTitleTargets}
            onAudience={setTitleAudience}
            onToggle={(id) => setSelectedTitleTargets((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
          />
          {overview.server.phase !== "online" && <div className="text-xs text-muted-foreground">서버가 온라인일 때 타이틀을 띄울 수 있어요.</div>}
          <Button type="submit" disabled={!canSendTitle || isBusy("title")} className="w-full">{isBusy("title") ? <Spinner /> : <Megaphone />}타이틀 띄우기</Button>
        </form>}
        {overview && tab === "console" && <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={logSearchInput} onChange={(event) => setLogSearchInput(event.target.value)} maxLength={100} className="pl-8" placeholder="이전 실행까지 로그 검색" aria-label="콘솔 로그 검색" autoComplete="off" />
            </div>
            {logs.viewingOlder && <Button type="button" variant="outline" size="sm" onClick={logs.showLatest}><RefreshCw />최신 로그</Button>}
          </div>
          <pre ref={logsRef} className="admin-log-view" aria-label="서버 콘솔 출력">{logs.entries.length
            ? logText(logs.entries)
            : logs.isLoading
              ? "로그를 불러오는 중..."
              : logQuery
                ? "검색 결과가 없어요."
                : "아직 저장된 콘솔 출력이 없어요."}</pre>
          {logs.loadError && <div className="text-xs text-destructive">{logs.loadError}</div>}
          {logs.nextOffset !== null && <Button type="button" variant="outline" size="sm" disabled={logs.isLoadingOlder} onClick={() => void logs.loadOlder()}>{logs.isLoadingOlder ? <Spinner /> : <RefreshCw />}이전 기록 더 보기</Button>}
          <form className="flex gap-2" onSubmit={async (event) => {
            event.preventDefault();
            const command = consoleCommand.trim();
            if (!command) return;
            const sent = await mutate("console", "/admin/console", {
              method: "POST",
              body: JSON.stringify({ command }),
              headers: { "Content-Type": "application/json" },
            });
            if (sent) setConsoleCommand("");
          }}>
            <Input value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} maxLength={256} disabled={overview.server.phase !== "online" || isBusy("console")} placeholder={overview.server.phase === "online" ? "명령 입력, /help와 help 모두 가능" : "서버가 온라인일 때 입력할 수 있어요"} aria-label="콘솔 명령" autoComplete="off" />
            <Button type="submit" size="icon" disabled={overview.server.phase !== "online" || isBusy("console") || !consoleCommand.trim()} aria-label="명령 실행">{isBusy("console") ? <Spinner /> : <CornerDownLeft />}</Button>
          </form>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
