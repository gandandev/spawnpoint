import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Check, Copy, CornerDownLeft, KeyRound, Megaphone, RefreshCw, Search, Shield, ShieldCheck, Terminal, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAdminLogs, useAdminMutation, useAdminOverview } from "@/features/admin-hooks";
import type { AdminLogEntry, AdminOverview, AdminUser, BootstrapData, InventoryItem, PlayerDetails, SessionUpdate } from "@/types";

type AdminTab = "players" | "title" | "console";
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

function itemName(item: InventoryItem) {
  return item.displayName ?? item.type.replaceAll("_", " ");
}

function InventoryList({ title, items }: { title: string; items: InventoryItem[] }) {
  return <section className="flex min-w-0 flex-col gap-2">
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Box className="size-3.5" />{title}<span className="ml-auto tabular-nums">{items.length}</span></div>
    {items.length ? <ul className="admin-inventory-list">
      {items.map((item) => <li key={`${item.section}-${item.slot}`} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
        <span className="truncate capitalize">{itemName(item)}</span><span className="ml-auto shrink-0 tabular-nums text-muted-foreground">×{item.amount}</span>
      </li>)}
    </ul> : <div className="rounded-md bg-muted/45 px-3 py-4 text-center text-xs text-muted-foreground">비어 있음</div>}
  </section>;
}

function PlayerPanel({ player, busy, onOperator }: { player: PlayerDetails; busy: boolean; onOperator: (player: PlayerDetails) => Promise<void> }) {
  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#96ce4d]/15 text-sm font-semibold text-[#65952c]">{player.displayName.slice(0, 1)}</div>
      <div className="min-w-0"><div className="truncate font-medium">{player.displayName}</div><div className="truncate text-xs text-muted-foreground">{player.username} · {player.gameMode}</div></div>
      <Button variant={player.operator ? "destructive" : "outline"} size="sm" className="ml-auto" disabled={busy} onClick={() => void onOperator(player)}>{busy ? <Spinner /> : <Shield className="size-3.5" />}{player.operator ? "OP 회수" : "OP 부여"}</Button>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="admin-stat"><span>월드</span><strong className="truncate">{player.world}</strong></div>
      <div className="admin-stat"><span>좌표</span><strong>{player.x.toFixed(1)}, {player.y.toFixed(1)}, {player.z.toFixed(1)}</strong></div>
      <div className="admin-stat"><span>체력</span><strong>{player.health.toFixed(1)} / 20</strong></div>
      <div className="admin-stat"><span>허기</span><strong>{player.foodLevel} / 20</strong></div>
    </div>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <InventoryList title="인벤토리" items={player.inventory} />
      <InventoryList title="엔더 상자" items={player.enderChest} />
    </div>
  </div>;
}

interface TpaSettingRowProps {
  enabled: boolean | null;
  serverOnline: boolean;
  busy: boolean;
  onChange: (enabled: boolean) => void;
}

export function TpaSettingRow({ enabled, serverOnline, busy, onChange }: TpaSettingRowProps) {
  const unavailable = enabled === null;
  const disabled = busy || unavailable || !serverOnline;
  const status = !serverOnline
    ? "서버가 오프라인일 때는 변경할 수 없어요."
    : unavailable
      ? "게임 서버 설정을 불러올 수 없어요."
      : null;

  return <div className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5">
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium">TPA 요청</div>
      <div className="text-xs leading-relaxed text-muted-foreground">플레이어끼리 순간이동 요청을 보낼 수 있어요.</div>
      {status && <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{status}</div>}
    </div>
    {busy && <Spinner className="size-3.5" />}
    <Switch checked={enabled ?? false} disabled={disabled} onCheckedChange={onChange} aria-label="TPA 요청 허용" />
  </div>;
}

interface UserEditorProps {
  user: AdminUser;
  currentUserId: string;
  busy: boolean;
  resetConfirming: boolean;
  resetCode: string | null;
  onSave: (identity: Pick<AdminUser, "username">) => Promise<void>;
  onReset: () => Promise<void>;
  onArmReset: () => void;
  onCopyResetCode: () => void;
}

function UserEditor({ user, currentUserId, busy, resetConfirming, resetCode, onSave, onReset, onArmReset, onCopyResetCode }: UserEditorProps) {
  const [name, setName] = useState(user.username);
  useEffect(() => {
    setName(user.username);
  }, [user.id, user.username]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({ username: name });
  };

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex items-center gap-2"><div className="min-w-0"><div className="truncate font-medium">{user.displayName}</div><div className="truncate text-xs text-muted-foreground">게임 기술 ID: {user.gameUsername}</div></div>{user.isAdmin && <Badge variant="secondary" className="ml-auto"><ShieldCheck />관리자</Badge>}</div>
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <FieldGroup>
        <Field><FieldLabel htmlFor={`admin-name-${user.id}`}>이름</FieldLabel><Input id={`admin-name-${user.id}`} value={name} onChange={(event) => setName(event.target.value)} minLength={1} maxLength={16} required /></Field>
      </FieldGroup>
      <Button type="submit" disabled={busy || name === user.username}>{busy ? <Spinner /> : <Check />}이름 변경</Button>
    </form>
    {user.id !== currentUserId && <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />비밀번호 초기화</div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">기존 포털 로그인 쿠키를 무효화하고, 15분 동안 1회용 코드로 새 비밀번호를 설정할 수 있게 합니다.</p>
      {resetCode ? <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-2.5">
        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 select-all truncate text-sm font-semibold tracking-wide">{resetCode}</code><Button type="button" variant="ghost" size="icon-sm" onClick={onCopyResetCode} aria-label="초기화 코드 복사"><Copy /></Button></div>
        <span className="text-[11px] leading-relaxed text-muted-foreground">이 6자리 코드는 다시 표시되지 않아요. 사용자에게 안전하게 전달하세요.</span>
      </div> : <Button type="button" variant={resetConfirming ? "destructive" : "outline"} className="w-full" disabled={busy} onClick={() => resetConfirming ? void onReset() : onArmReset()}>{resetConfirming ? "한 번 더 눌러 초기화" : user.resetRequired ? "초기화 코드 재발급" : "비밀번호 초기화"}</Button>}
    </div>}
  </div>;
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [resetConfirming, setResetConfirming] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState<{ userId: string; value: string } | null>(null);
  const [titleText, setTitleText] = useState("");
  const [subtitleText, setSubtitleText] = useState("");
  const [titleColor, setTitleColor] = useState<TitleColor>("white");
  const [titleAudience, setTitleAudience] = useState<TitleAudience>("all");
  const [selectedTitleTargets, setSelectedTitleTargets] = useState<Set<string>>(() => new Set());
  const [consoleCommand, setConsoleCommand] = useState("");
  const [logSearchInput, setLogSearchInput] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const logsRef = useRef<HTMLPreElement>(null);

  const onOverview = useCallback((result: AdminOverview) => {
    setSelectedUserId((current) => current && result.users.some((user) => user.id === current) ? current : (result.users[0]?.id ?? null));
    setResetCode((current) => current && result.users.some((user) => user.id === current.userId && user.resetRequired) ? current : null);
  }, []);
  const { overview, loadError, loadOverview } = useAdminOverview({ open, csrf: data.csrf, onOverview });
  const { isBusy, mutate } = useAdminMutation({ csrf: data.csrf, onSession, notice, refresh: loadOverview });
  const logs = useAdminLogs({ active: open && tab === "console", csrf: data.csrf, query: logQuery });

  useEffect(() => {
    const timer = window.setTimeout(() => setLogQuery(logSearchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [logSearchInput]);

  useLayoutEffect(() => {
    if (tab === "console" && !logs.viewingOlder && logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs.entries.length, logs.viewingOlder, overview?.logs.length, tab]);

  const selectedUser = overview?.users.find((user) => user.id === selectedUserId) ?? null;
  const onlinePlayersByAccount = useMemo(() => new Map(overview?.players.flatMap((player) => player.accountId ? [[player.accountId, player] as const] : []) ?? []), [overview?.players]);
  const selectedPlayer = selectedUser ? onlinePlayersByAccount.get(selectedUser.id) ?? null : null;
  const titleTargets = useMemo<TitleTarget[]>(() => overview?.players.map((player) => ({
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

  const fallbackLogEntries = useMemo<AdminLogEntry[]>(() => overview?.logs.map((line) => ({ source: "현재 실행", line })) ?? [], [overview?.logs]);
  const visibleLogEntries = logs.entries.length > 0 ? logs.entries : (logs.isLoading && !logQuery ? fallbackLogEntries : []);
  const canSendTitle = overview?.server.phase === "online"
    && (titleText.trim().length > 0 || subtitleText.trim().length > 0)
    && (titleAudience === "all" ? titleTargets.length > 0 : selectedTitleTargets.size > 0);

  return <Dialog open={open} onOpenChange={(nextOpen) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      setResetCode(null);
      setResetConfirming(null);
    }
  }}>
    {showTrigger && <DialogTrigger asChild><Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" aria-label="관리자 패널" title="관리자 패널"><Shield /></Button></DialogTrigger>}
    <DialogContent className="max-h-[calc(100dvh-1rem)] min-h-[min(42rem,calc(100dvh-1rem))] w-[calc(100%-1rem)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden p-4 ring-0 sm:max-w-4xl">
      <DialogHeader>
        <div className="flex items-center gap-2"><DialogTitle>관리자 패널</DialogTitle>{overview && <Badge variant="secondary" className={cn("ml-1", overview.server.phase === "online" && "bg-[#96ce4d]/15 text-[#65952c]")}>{overview.server.phase === "online" ? "서버 온라인" : "서버 오프라인"}</Badge>}</div>
        <DialogDescription>플레이어를 관리하고, 타이틀과 서버 콘솔을 제어하세요.</DialogDescription>
      </DialogHeader>
      <ToggleGroup type="single" value={tab} onValueChange={(value) => { if (value === "players" || value === "title" || value === "console") setTab(value); }} variant="outline" spacing={0} className="grid w-full grid-cols-3 p-1">
        <ToggleGroupItem value="players" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><Users />플레이어 {overview?.users.length ?? 0}</ToggleGroupItem>
        <ToggleGroupItem value="title" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><Megaphone />타이틀</ToggleGroupItem>
        <ToggleGroupItem value="console" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><Terminal />콘솔</ToggleGroupItem>
      </ToggleGroup>
      <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
        {!overview && !loadError && <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />관리자 정보 불러오는 중</div>}
        {loadError && !overview && <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><span>{loadError}</span><Button variant="outline" onClick={() => void loadOverview()}><RefreshCw />다시 시도</Button></div>}
        {overview && tab === "players" && <div className="flex min-w-0 flex-col gap-3">
          <TpaSettingRow
            enabled={overview.tpaEnabled}
            serverOnline={overview.server.phase === "online"}
            busy={isBusy("tpa")}
            onChange={(enabled) => {
              void mutate("tpa", "/admin/settings/tpa", {
                method: "PUT",
                body: JSON.stringify({ enabled }),
                headers: { "Content-Type": "application/json" },
              });
            }}
          />
          {overview.users.length ? <div className="admin-split-panel">
          <div className="admin-list-panel">
            {overview.users.map((user) => {
              const onlinePlayer = onlinePlayersByAccount.get(user.id);
              return <button key={user.id} type="button" className={cn("admin-list-button", user.id === selectedUserId && "is-selected")} onClick={() => { setSelectedUserId(user.id); setResetConfirming(null); }}>
                <span className="flex min-w-0 items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full bg-muted-foreground/35", onlinePlayer && "bg-[#96ce4d]")} aria-label={onlinePlayer ? "온라인" : "오프라인"} /><span className={cn("truncate font-mark text-sm", onlinePlayer && "text-[#65952c]")}>{user.displayName}</span>{user.resetRequired && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}</span>
                <span className="truncate pl-4 text-xs text-muted-foreground">{onlinePlayer ? `${onlinePlayer.world} · ${user.gameUsername}` : user.gameUsername}</span>
              </button>;
            })}
          </div>
          <div className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">{selectedUser ? <>
            {selectedPlayer && <PlayerPanel player={selectedPlayer} busy={isBusy(`op:${selectedPlayer.accountId}`)} onOperator={async (player) => {
              const target = player.accountId ?? player.uuid;
              await mutate(`op:${target}`, `/admin/players/${encodeURIComponent(target)}/operator`, { method: "PUT", body: JSON.stringify({ operator: !player.operator }), headers: { "Content-Type": "application/json" } });
            }} />}
            <UserEditor
            user={selectedUser}
            currentUserId={data.user!.id}
            busy={isBusy(`user:${selectedUser.id}`)}
            resetConfirming={resetConfirming === selectedUser.id}
            resetCode={resetCode?.userId === selectedUser.id ? resetCode.value : null}
            onArmReset={() => setResetConfirming(selectedUser.id)}
            onCopyResetCode={() => {
              if (resetCode?.userId !== selectedUser.id) return;
              void navigator.clipboard.writeText(resetCode.value)
                .then(() => notice("초기화 코드를 복사했어요."))
                .catch(() => notice("코드를 길게 눌러 직접 복사하세요."));
            }}
            onSave={async (identity) => {
              const changed = await mutate(`user:${selectedUser.id}`, `/admin/users/${selectedUser.id}/profile`, { method: "PATCH", body: JSON.stringify(identity), headers: { "Content-Type": "application/json" } });
              if (changed) notice("사용자 정보를 변경했어요.");
            }}
            onReset={async () => {
              const changed = await mutate(`user:${selectedUser.id}`, `/admin/users/${selectedUser.id}/password-reset`, { method: "POST" });
              setResetConfirming(null);
              if (changed?.resetCode) {
                setResetCode({ userId: selectedUser.id, value: changed.resetCode });
                notice("1회용 코드를 사용자에게 전달하세요.");
              }
            }}
            />
          </> : <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">플레이어를 선택하세요.</div>}</div>
        </div> : <div className="flex min-h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">등록된 플레이어가 없어요.</div>}
        </div>}
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
          <pre ref={logsRef} className="admin-log-view" aria-label="서버 콘솔 출력">{visibleLogEntries.length
            ? logText(visibleLogEntries)
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
