import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Check, Copy, CornerDownLeft, KeyRound, MapPin, RefreshCw, Shield, ShieldCheck, Terminal, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AdminOverview, AdminUser, BootstrapData, InventoryItem, PlayerDetails, PublicUser } from "@/types";

type AdminTab = "players" | "users" | "console";

interface AdminPanelProps {
  data: BootstrapData;
  onSession: (user: PublicUser, csrf: string) => void;
  notice: (message: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

interface AdminMutationResult {
  user?: PublicUser;
  csrf?: string;
  resetCode?: string;
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
  onSave: (playerName: string) => Promise<void>;
  onReset: () => Promise<void>;
  onArmReset: () => void;
  onCopyResetCode: () => void;
}

function UserEditor({ user, currentUserId, busy, resetConfirming, resetCode, onSave, onReset, onArmReset, onCopyResetCode }: UserEditorProps) {
  const [playerName, setPlayerName] = useState(user.displayName);
  useEffect(() => {
    setPlayerName(user.displayName);
  }, [user.displayName, user.id, user.username]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(playerName);
  };

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex items-center gap-2"><div className="min-w-0"><div className="truncate font-medium">{user.displayName}</div><div className="truncate text-xs text-muted-foreground">게임 기술 ID: {user.gameUsername}</div></div>{user.isAdmin && <Badge variant="secondary" className="ml-auto"><ShieldCheck />관리자</Badge>}</div>
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <FieldGroup>
        <Field><FieldLabel htmlFor={`admin-name-${user.id}`}>플레이어 이름</FieldLabel><Input id={`admin-name-${user.id}`} value={playerName} onChange={(event) => setPlayerName(event.target.value)} minLength={1} maxLength={16} required /><FieldDescription>로그인과 게임에 같은 이름이 표시되고, 월드 데이터 연결은 그대로 유지돼요.</FieldDescription></Field>
      </FieldGroup>
      <Button type="submit" disabled={busy || (playerName === user.username && playerName === user.displayName)}>{busy ? <Spinner /> : <Check />}이름 변경</Button>
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

export function AdminPanel({ data, onSession, notice, open: controlledOpen, onOpenChange, showTrigger = true }: AdminPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [tab, setTab] = useState<AdminTab>("players");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [resetConfirming, setResetConfirming] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState<{ userId: string; value: string } | null>(null);
  const [consoleCommand, setConsoleCommand] = useState("");
  const logsRef = useRef<HTMLPreElement>(null);
  const overviewRequestGenerationRef = useRef(0);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const generation = ++overviewRequestGenerationRef.current;
    let result: AdminOverview;
    try {
      result = await api<AdminOverview>("/admin/overview", {
        headers: { "x-spawnpoint-csrf": data.csrf! },
        signal,
      });
    } catch (error) {
      if (generation !== overviewRequestGenerationRef.current) return null;
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setLoadError(error instanceof Error ? error.message : "관리자 정보를 불러오지 못했어요");
      }
      throw error;
    }
    if (generation !== overviewRequestGenerationRef.current) return null;
    setOverview(result);
    setLoadError(null);
    setSelectedPlayerKey((current) => current && result.players.some((player) => (player.accountId ?? player.uuid) === current) ? current : (result.players[0]?.accountId ?? result.players[0]?.uuid ?? null));
    setSelectedUserId((current) => current && result.users.some((user) => user.id === current) ? current : (result.users[0]?.id ?? null));
    setResetCode((current) => current && result.users.some((user) => user.id === current.userId && user.resetRequired) ? current : null);
    return result;
  }, [data.csrf]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const poll = async () => {
      controller = new AbortController();
      try {
        await loadOverview(controller.signal);
      } catch {
        // The latest request owns the visible error state inside loadOverview.
      }
      if (active) timer = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadOverview, open]);

  useLayoutEffect(() => {
    if (tab === "console" && logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [overview?.logs.length, tab]);

  const mutate = async (key: string, path: string, options: RequestInit) => {
    setBusyKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      const result = await api<AdminMutationResult>(path, {
        ...options,
        headers: { "x-spawnpoint-csrf": data.csrf!, ...options.headers },
      });
      if (result?.user && result.csrf) {
        onSession(result.user, result.csrf);
      } else {
        await loadOverview();
      }
      return result ?? {};
    } catch (error) {
      notice(error instanceof Error ? error.message : "관리자 작업을 완료하지 못했어요");
      return null;
    } finally {
      setBusyKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const selectedPlayer = overview?.players.find((player) => (player.accountId ?? player.uuid) === selectedPlayerKey) ?? null;
  const selectedUser = overview?.users.find((user) => user.id === selectedUserId) ?? null;

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
        <DialogDescription>플레이어 상태, 계정, 서버 콘솔을 실시간으로 확인하세요.</DialogDescription>
      </DialogHeader>
      <ToggleGroup type="single" value={tab} onValueChange={(value) => { if (value === "players" || value === "users" || value === "console") setTab(value); }} variant="outline" spacing={0} className="grid w-full grid-cols-3 p-1">
        <ToggleGroupItem value="players" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><MapPin />플레이어 {overview?.players.length ?? 0}</ToggleGroupItem>
        <ToggleGroupItem value="users" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><Users />계정 {overview?.users.length ?? 0}</ToggleGroupItem>
        <ToggleGroupItem value="console" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><Terminal />콘솔</ToggleGroupItem>
      </ToggleGroup>
      <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
        {!overview && !loadError && <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />관리자 정보 불러오는 중</div>}
        {loadError && !overview && <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><span>{loadError}</span><Button variant="outline" onClick={() => void loadOverview()}><RefreshCw />다시 시도</Button></div>}
        {overview && tab === "players" && <div className="flex min-w-0 flex-col gap-3">
          <TpaSettingRow
            enabled={overview.tpaEnabled}
            serverOnline={overview.server.phase === "online"}
            busy={busyKeys.has("tpa")}
            onChange={(enabled) => {
              void mutate("tpa", "/admin/settings/tpa", {
                method: "PUT",
                body: JSON.stringify({ enabled }),
                headers: { "Content-Type": "application/json" },
              });
            }}
          />
          {overview.players.length ? <div className="admin-split-panel">
          <div className="admin-list-panel">
            {overview.players.map((player) => {
              const key = player.accountId ?? player.uuid;
              return <button key={key} type="button" className={cn("admin-list-button", key === selectedPlayerKey && "is-selected")} onClick={() => setSelectedPlayerKey(key)}><span className="truncate font-medium">{player.displayName}</span><span className="truncate text-xs text-muted-foreground">{player.world} · {player.username}</span></button>;
            })}
          </div>
          <div className="min-w-0 rounded-lg border p-4">{selectedPlayer ? <PlayerPanel player={selectedPlayer} busy={busyKeys.has(`op:${selectedPlayerKey}`)} onOperator={async (player) => {
            const target = player.accountId ?? player.uuid;
            await mutate(`op:${target}`, `/admin/players/${encodeURIComponent(target)}/operator`, { method: "PUT", body: JSON.stringify({ operator: !player.operator }), headers: { "Content-Type": "application/json" } });
          }} /> : <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">플레이어를 선택하세요.</div>}</div>
        </div> : <div className="flex min-h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">{overview.bridgeAvailable ? "현재 접속 중인 플레이어가 없어요." : "게임 서버가 켜지면 상세 정보가 표시돼요."}</div>}
        </div>}
        {overview && tab === "users" && <div className="admin-split-panel">
          <div className="admin-list-panel">
            {overview.users.map((user) => <button key={user.id} type="button" className={cn("admin-list-button", user.id === selectedUserId && "is-selected")} onClick={() => { setSelectedUserId(user.id); setResetConfirming(null); }}><span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{user.displayName}</span>{user.resetRequired && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}</span><span className="truncate text-xs text-muted-foreground">{user.username}</span></button>)}
          </div>
          <div className="min-w-0 rounded-lg border p-4">{selectedUser ? <UserEditor
            user={selectedUser}
            currentUserId={data.user!.id}
            busy={busyKeys.has(`user:${selectedUser.id}`)}
            resetConfirming={resetConfirming === selectedUser.id}
            resetCode={resetCode?.userId === selectedUser.id ? resetCode.value : null}
            onArmReset={() => setResetConfirming(selectedUser.id)}
            onCopyResetCode={() => {
              if (resetCode?.userId !== selectedUser.id) return;
              void navigator.clipboard.writeText(resetCode.value)
                .then(() => notice("초기화 코드를 복사했어요."))
                .catch(() => notice("코드를 길게 눌러 직접 복사하세요."));
            }}
            onSave={async (playerName) => {
              const changed = await mutate(`user:${selectedUser.id}`, `/admin/users/${selectedUser.id}/profile`, { method: "PATCH", body: JSON.stringify({ username: playerName, displayName: playerName }), headers: { "Content-Type": "application/json" } });
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
          /> : <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">계정을 선택하세요.</div>}</div>
        </div>}
        {overview && tab === "console" && <div className="flex min-h-0 flex-col gap-2">
          <pre ref={logsRef} className="admin-log-view" aria-label="서버 콘솔 출력">{overview.logs.length ? overview.logs.join("\n") : "아직 콘솔 출력이 없어요."}</pre>
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
            <Input value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} maxLength={256} disabled={overview.server.phase !== "online" || busyKeys.has("console")} placeholder={overview.server.phase === "online" ? "명령 입력" : "서버가 온라인일 때 입력할 수 있어요"} aria-label="콘솔 명령" autoComplete="off" />
            <Button type="submit" size="icon" disabled={overview.server.phase !== "online" || busyKeys.has("console") || !consoleCommand.trim()} aria-label="명령 실행">{busyKeys.has("console") ? <Spinner /> : <CornerDownLeft />}</Button>
          </form>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
