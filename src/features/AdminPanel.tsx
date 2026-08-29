import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Check, Copy, CornerDownLeft, KeyRound, RefreshCw, Shield, ShieldCheck, Terminal, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAdminMutation, useAdminOverview } from "@/features/admin-hooks";
import type { AdminOverview, AdminUser, BootstrapData, InventoryItem, PlayerDetails, PublicUser } from "@/types";

type AdminTab = "players" | "console";

interface AdminPanelProps {
  data: BootstrapData;
  onSession: (user: PublicUser, csrf: string) => void;
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
        <Field><FieldLabel htmlFor={`admin-name-${user.id}`}>플레이어 이름</FieldLabel><Input id={`admin-name-${user.id}`} value={playerName} onChange={(event) => setPlayerName(event.target.value)} minLength={1} maxLength={16} required /></Field>
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [resetConfirming, setResetConfirming] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState<{ userId: string; value: string } | null>(null);
  const [consoleCommand, setConsoleCommand] = useState("");
  const logsRef = useRef<HTMLPreElement>(null);

  const onOverview = useCallback((result: AdminOverview) => {
    setSelectedUserId((current) => current && result.users.some((user) => user.id === current) ? current : (result.users[0]?.id ?? null));
    setResetCode((current) => current && result.users.some((user) => user.id === current.userId && user.resetRequired) ? current : null);
  }, []);
  const { overview, loadError, loadOverview } = useAdminOverview({ open, csrf: data.csrf, onOverview });
  const { isBusy, mutate } = useAdminMutation({ csrf: data.csrf, onSession, notice, refresh: loadOverview });

  useLayoutEffect(() => {
    if (tab === "console" && logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [overview?.logs.length, tab]);

  const selectedUser = overview?.users.find((user) => user.id === selectedUserId) ?? null;
  const onlinePlayersByAccount = useMemo(() => new Map(overview?.players.flatMap((player) => player.accountId ? [[player.accountId, player] as const] : []) ?? []), [overview?.players]);
  const selectedPlayer = selectedUser ? onlinePlayersByAccount.get(selectedUser.id) ?? null : null;

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
        <DialogDescription>플레이어와 서버 콘솔을 실시간으로 확인하세요.</DialogDescription>
      </DialogHeader>
      <ToggleGroup type="single" value={tab} onValueChange={(value) => { if (value === "players" || value === "console") setTab(value); }} variant="outline" spacing={0} className="grid w-full grid-cols-2 p-1">
        <ToggleGroupItem value="players" className="h-9 min-w-0 w-full cursor-pointer gap-0.5 px-1 text-xs sm:gap-1 sm:px-2 sm:text-sm"><Users />플레이어 {overview?.users.length ?? 0}</ToggleGroupItem>
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
            />
          </> : <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground">플레이어를 선택하세요.</div>}</div>
        </div> : <div className="flex min-h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">등록된 플레이어가 없어요.</div>}
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
            <Input value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} maxLength={256} disabled={overview.server.phase !== "online" || isBusy("console")} placeholder={overview.server.phase === "online" ? "명령 입력" : "서버가 온라인일 때 입력할 수 있어요"} aria-label="콘솔 명령" autoComplete="off" />
            <Button type="submit" size="icon" disabled={overview.server.phase !== "online" || isBusy("console") || !consoleCommand.trim()} aria-label="명령 실행">{isBusy("console") ? <Spinner /> : <CornerDownLeft />}</Button>
          </form>
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
