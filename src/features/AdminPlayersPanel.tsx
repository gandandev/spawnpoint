import { FormEvent, useEffect, useMemo, useState } from "react";
import { Ban, Box, Check, Clock3, Copy, DoorOpen, HeartPulse, KeyRound, PackagePlus, Shield, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { AdminMutate } from "@/features/admin-hooks";
import type { AdminOverview, AdminUser, InventoryItem, PlayerDetails, ServerGameMode } from "@/types";

function formatDate(value: number | null) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function formatPlayTime(ticks: number) {
  const minutes = Math.max(0, Math.floor(ticks / 20 / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days}일 ${hours}시간`;
  if (hours) return `${hours}시간 ${rest}분`;
  return `${rest}분`;
}

function itemName(item: InventoryItem) {
  return item.displayName ?? item.type.replaceAll("_", " ");
}

function StateEditor({ player, busy, onSave }: { player: PlayerDetails; busy: boolean; onSave: (body: unknown) => Promise<void> }) {
  const [health, setHealth] = useState(String(player.health));
  const [foodLevel, setFoodLevel] = useState(String(player.foodLevel));
  const [gameMode, setGameMode] = useState<ServerGameMode>(player.gameMode as ServerGameMode);
  const [world, setWorld] = useState(player.world);
  const [x, setX] = useState(String(player.x));
  const [y, setY] = useState(String(player.y));
  const [z, setZ] = useState(String(player.z));
  const [yaw, setYaw] = useState(String(player.yaw));
  const [pitch, setPitch] = useState(String(player.pitch));

  useEffect(() => {
    setHealth(String(player.health));
    setFoodLevel(String(player.foodLevel));
    setGameMode(player.gameMode as ServerGameMode);
    setWorld(player.world);
    setX(String(player.x));
    setY(String(player.y));
    setZ(String(player.z));
    setYaw(String(player.yaw));
    setPitch(String(player.pitch));
  }, [player.accountId, player.foodLevel, player.gameMode, player.health, player.pitch, player.world, player.x, player.y, player.yaw, player.z]);

  return <form className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={(event) => {
    event.preventDefault();
    void onSave({
      health: Number(health),
      foodLevel: Number(foodLevel),
      gameMode,
      location: { world, x: Number(x), y: Number(y), z: Number(z), yaw: Number(yaw), pitch: Number(pitch) },
    });
  }}>
    <div className="flex items-center gap-2 text-sm font-medium"><HeartPulse className="size-4" />상태와 위치</div>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="admin-compact-field">체력<Input type="number" min={0} max={20} step={0.5} value={health} onChange={(event) => setHealth(event.target.value)} /></label>
      <label className="admin-compact-field">허기<Input type="number" min={0} max={20} step={1} value={foodLevel} onChange={(event) => setFoodLevel(event.target.value)} /></label>
      <label className="admin-compact-field">게임 모드<select className="admin-native-select" value={gameMode} onChange={(event) => setGameMode(event.target.value as ServerGameMode)}><option value="survival">서바이벌</option><option value="creative">크리에이티브</option><option value="adventure">모험</option><option value="spectator">관전자</option></select></label>
    </div>
    <div className="grid gap-2 sm:grid-cols-6">
      <label className="admin-compact-field sm:col-span-2">월드<Input value={world} maxLength={64} onChange={(event) => setWorld(event.target.value)} /></label>
      <label className="admin-compact-field">X<Input type="number" step="any" value={x} onChange={(event) => setX(event.target.value)} /></label>
      <label className="admin-compact-field">Y<Input type="number" step="any" value={y} onChange={(event) => setY(event.target.value)} /></label>
      <label className="admin-compact-field">Z<Input type="number" step="any" value={z} onChange={(event) => setZ(event.target.value)} /></label>
      <label className="admin-compact-field">방향<Input type="number" min={-360} max={360} step="any" value={yaw} onChange={(event) => setYaw(event.target.value)} /></label>
      <label className="admin-compact-field sm:col-start-6">고개<Input type="number" min={-90} max={90} step="any" value={pitch} onChange={(event) => setPitch(event.target.value)} /></label>
    </div>
    <Button type="submit" className="self-end" disabled={busy}>{busy ? <Spinner /> : <Check />}상태 적용</Button>
  </form>;
}

function InventorySection({ title, section, items, playerId, isBusy, mutate, notice }: {
  title: string;
  section: "storage" | "armor" | "extra" | "ender";
  items: InventoryItem[];
  playerId: string;
  isBusy: (key: string) => boolean;
  mutate: AdminMutate;
  notice: (message: string) => void;
}) {
  const [slot, setSlot] = useState("0");
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("1");
  const [durability, setDurability] = useState("0");
  const mutationKey = `inventory:${playerId}:${section}`;
  const maximumSlot = section === "storage" ? 35 : section === "armor" ? 3 : section === "extra" ? 0 : 26;

  const update = async (body: unknown, message: string) => {
    const result = await mutate(mutationKey, `/admin/players/${encodeURIComponent(playerId)}/inventory`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    if (result) notice(message);
  };

  return <section className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><Box className="size-4" />{title}<span className="ml-auto text-xs tabular-nums text-muted-foreground">{items.length}</span></div>
    {items.length ? <ul className="admin-inventory-list">
      {items.map((item) => <li key={`${item.section}-${item.slot}`} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
        <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{item.slot}</span>
        <span className="truncate capitalize">{itemName(item)}</span>
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">×{item.amount}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`${itemName(item)} 제거`} disabled={isBusy(mutationKey)} onClick={() => void update({ section, slot: item.slot, item: null }, "아이템을 제거했어요.")}><Trash2 /></Button>
      </li>)}
    </ul> : <div className="rounded-md bg-muted/45 px-3 py-4 text-center text-xs text-muted-foreground">비어 있음</div>}
    <form className="grid grid-cols-[4.5rem_minmax(0,1fr)_4rem] gap-2 border-t pt-3" onSubmit={(event) => {
      event.preventDefault();
      void update({ section, slot: Number(slot), item: { type, amount: Number(amount), durability: Number(durability) } }, "아이템을 저장했어요.");
    }}>
      <label className="admin-compact-field">칸<Input type="number" min={0} max={maximumSlot} value={slot} onChange={(event) => setSlot(event.target.value)} required /></label>
      <label className="admin-compact-field">아이템 ID<Input value={type} onChange={(event) => setType(event.target.value)} placeholder="diamond_sword" pattern="(?:minecraft:)?[a-z0-9_]+" required /></label>
      <label className="admin-compact-field">수량<Input type="number" min={1} max={64} value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <label className="admin-compact-field col-span-2">내구도 값<Input type="number" min={0} max={32767} value={durability} onChange={(event) => setDurability(event.target.value)} required /></label>
      <Button type="submit" className="self-end" disabled={isBusy(mutationKey)}>{isBusy(mutationKey) ? <Spinner /> : <PackagePlus />}저장</Button>
    </form>
  </section>;
}

function AccountEditor({ user, currentUserId, busy, temporaryPassword, onSave, onTemporaryPassword, onCopy }: {
  user: AdminUser;
  currentUserId: string;
  busy: boolean;
  temporaryPassword: string | null;
  onSave: (username: string) => Promise<void>;
  onTemporaryPassword: () => Promise<void>;
  onCopy: () => void;
}) {
  const [name, setName] = useState(user.username);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setName(user.username);
    setArmed(false);
  }, [user.id, user.username]);

  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><UserRound className="size-4" />포털 계정{user.isAdmin && <Badge variant="secondary" className="ml-auto"><ShieldCheck />관리자</Badge>}</div>
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="admin-stat"><span>최근 로그인</span><strong>{formatDate(user.lastLoginAt)}</strong></div>
      <div className="admin-stat"><span>비밀번호 변경</span><strong>{formatDate(user.passwordUpdatedAt)}</strong></div>
    </div>
    <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void onSave(name); }}>
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor={`admin-name-${user.id}`}>로그인 이름</FieldLabel><Input id={`admin-name-${user.id}`} value={name} minLength={1} maxLength={16} onChange={(event) => setName(event.target.value)} required /></Field>
      <Button type="submit" disabled={busy || name === user.username}>{busy ? <Spinner /> : <Check />}이름 변경</Button>
    </form>
    {user.id !== currentUserId && <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />임시 비밀번호</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">현재 비밀번호는 해시로 저장되어 복구할 수 없습니다. 새 임시 비밀번호를 만들면 기존 비밀번호와 로그인 세션이 바로 무효가 됩니다.</p>
      {temporaryPassword ? <div className="mt-3 flex items-center gap-2 rounded-md border bg-background p-2">
        <code className="min-w-0 flex-1 select-all truncate text-sm font-semibold tracking-wide">{temporaryPassword}</code>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCopy} aria-label="임시 비밀번호 복사"><Copy /></Button>
      </div> : <Button type="button" variant={armed ? "destructive" : "outline"} className="mt-3 w-full" disabled={busy} onClick={() => armed ? void onTemporaryPassword() : setArmed(true)}>{busy ? <Spinner /> : <KeyRound />}{armed ? "한 번 더 눌러 발급" : "임시 비밀번호 발급"}</Button>}
      {temporaryPassword && <p className="mt-2 text-[11px] text-muted-foreground">이 값은 이 화면에서만 한 번 보입니다.</p>}
    </div>}
  </section>;
}

function PlayerEditor({ user, player, currentUserId, isBusy, mutate, notice, temporaryPassword, onTemporaryPassword, onCopyPassword }: {
  user: AdminUser;
  player: PlayerDetails | null;
  currentUserId: string;
  isBusy: (key: string) => boolean;
  mutate: AdminMutate;
  notice: (message: string) => void;
  temporaryPassword: string | null;
  onTemporaryPassword: () => Promise<void>;
  onCopyPassword: () => void;
}) {
  const [reason, setReason] = useState("");
  const playerId = user.id;
  const run = async (key: string, path: string, method: string, body: unknown, message: string) => {
    const result = await mutate(key, path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    if (result) notice(message);
  };

  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#96ce4d]/15 font-semibold text-[#65952c]">{user.displayName.slice(0, 1)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium">{user.displayName}</span><Badge variant={player?.online ? "secondary" : "outline"}>{player?.online ? "온라인" : "오프라인"}</Badge>{player?.banned && <Badge variant="destructive">차단됨</Badge>}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.gameUsername} · {player?.uuid ?? "월드 기록 없음"}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant={player?.operator ? "destructive" : "outline"} size="sm" disabled={isBusy(`op:${playerId}`)} onClick={() => void run(`op:${playerId}`, `/admin/players/${playerId}/operator`, "PUT", { operator: !player?.operator }, player?.operator ? "OP를 회수했어요." : "OP를 부여했어요.")}>{isBusy(`op:${playerId}`) ? <Spinner /> : <Shield />}{player?.operator ? "OP 회수" : "OP 부여"}</Button>
        <Button type="button" variant="outline" size="sm" disabled={!player?.online || isBusy(`kick:${playerId}`)} onClick={() => void run(`kick:${playerId}`, `/admin/players/${playerId}/kick`, "POST", { reason }, "플레이어를 내보냈어요.")}><DoorOpen />킥</Button>
        <Button type="button" variant={player?.banned ? "outline" : "destructive"} size="sm" disabled={isBusy(`ban:${playerId}`)} onClick={() => void run(`ban:${playerId}`, `/admin/players/${playerId}/ban`, "PUT", { banned: !player?.banned, reason }, player?.banned ? "차단을 풀었어요." : "플레이어를 차단했어요.")}><Ban />{player?.banned ? "밴 해제" : "밴"}</Button>
      </div>
      <Input className="basis-full" value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} placeholder="킥 또는 밴 사유, 비워 두면 기본 문구 사용" aria-label="킥 또는 밴 사유" />
    </div>

    {player && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="admin-stat"><span>첫 접속</span><strong>{formatDate(player.firstSeenAt)}</strong></div>
      <div className="admin-stat"><span>마지막 접속</span><strong>{player.online ? "지금 접속 중" : formatDate(player.lastSeenAt)}</strong></div>
      <div className="admin-stat"><span>총 플레이 시간</span><strong>{formatPlayTime(player.playTimeTicks)}</strong></div>
      <div className="admin-stat"><span>게임 모드</span><strong>{player.gameMode}</strong></div>
      <div className="admin-stat"><span>월드</span><strong>{player.world}</strong></div>
      <div className="admin-stat"><span>좌표</span><strong>{player.x.toFixed(1)}, {player.y.toFixed(1)}, {player.z.toFixed(1)}</strong></div>
      <div className="admin-stat"><span>체력</span><strong>{player.health.toFixed(1)} / 20</strong></div>
      <div className="admin-stat"><span>허기</span><strong>{player.foodLevel} / 20</strong></div>
    </div>}

    {player?.dataAvailable ? <>
      <StateEditor player={player} busy={isBusy(`state:${playerId}`)} onSave={async (body) => {
        await run(`state:${playerId}`, `/admin/players/${playerId}/state`, "PATCH", body, "플레이어 상태를 적용했어요.");
      }} />
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <InventorySection title="인벤토리" section="storage" items={player.inventory.filter((item) => item.section === "storage")} playerId={playerId} isBusy={isBusy} mutate={mutate} notice={notice} />
        <InventorySection title="엔더 상자" section="ender" items={player.enderChest} playerId={playerId} isBusy={isBusy} mutate={mutate} notice={notice} />
        <InventorySection title="방어구" section="armor" items={player.inventory.filter((item) => item.section === "armor")} playerId={playerId} isBusy={isBusy} mutate={mutate} notice={notice} />
        <InventorySection title="보조 손" section="extra" items={player.inventory.filter((item) => item.section === "extra")} playerId={playerId} isBusy={isBusy} mutate={mutate} notice={notice} />
      </div>
    </> : <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">아직 월드에 접속한 기록이 없어서 상태와 아이템 데이터가 없습니다.</div>}

    <AccountEditor
      user={user}
      currentUserId={currentUserId}
      busy={isBusy(`user:${user.id}`)}
      temporaryPassword={temporaryPassword}
      onTemporaryPassword={onTemporaryPassword}
      onCopy={onCopyPassword}
      onSave={async (username) => {
        const result = await mutate(`user:${user.id}`, `/admin/users/${user.id}/profile`, { method: "PATCH", body: JSON.stringify({ username }), headers: { "Content-Type": "application/json" } });
        if (result) notice("로그인 이름을 변경했어요.");
      }}
    />
  </div>;
}

export function AdminPlayersPanel({ overview, currentUserId, isBusy, mutate, notice }: {
  overview: AdminOverview;
  currentUserId: string;
  isBusy: (key: string) => boolean;
  mutate: AdminMutate;
  notice: (message: string) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(overview.users[0]?.id ?? null);
  const [temporaryPassword, setTemporaryPassword] = useState<{ userId: string; value: string } | null>(null);
  const playersByAccount = useMemo(() => new Map(overview.players.flatMap((player) => player.accountId ? [[player.accountId, player] as const] : [])), [overview.players]);

  useEffect(() => {
    if (!selectedUserId || !overview.users.some((user) => user.id === selectedUserId)) setSelectedUserId(overview.users[0]?.id ?? null);
  }, [overview.users, selectedUserId]);

  const selectedUser = overview.users.find((user) => user.id === selectedUserId) ?? null;
  const selectedPlayer = selectedUser ? playersByAccount.get(selectedUser.id) ?? null : null;
  if (!overview.users.length) return <div className="flex min-h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">등록된 플레이어가 없어요.</div>;

  return <div className="admin-split-panel">
    <div className="admin-list-panel">
      {overview.users.map((user) => {
        const player = playersByAccount.get(user.id);
        return <button key={user.id} type="button" className={cn("admin-list-button", user.id === selectedUserId && "is-selected")} onClick={() => { setSelectedUserId(user.id); setTemporaryPassword(null); }}>
          <span className="flex min-w-0 items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full bg-muted-foreground/35", player?.online && "bg-[#96ce4d]")} aria-label={player?.online ? "온라인" : "오프라인"} /><span className={cn("truncate font-mark text-sm", player?.online && "text-[#65952c]")}>{user.displayName}</span>{player?.banned && <Ban className="ml-auto size-3.5 text-destructive" />}</span>
          <span className="flex items-center gap-1 truncate pl-4 text-xs text-muted-foreground"><Clock3 className="size-3" />{player?.online ? player.world : formatDate(player?.lastSeenAt ?? user.lastLoginAt)}</span>
        </button>;
      })}
    </div>
    <div className="min-w-0">{selectedUser ? <PlayerEditor
      user={selectedUser}
      player={selectedPlayer}
      currentUserId={currentUserId}
      isBusy={isBusy}
      mutate={mutate}
      notice={notice}
      temporaryPassword={temporaryPassword?.userId === selectedUser.id ? temporaryPassword.value : null}
      onTemporaryPassword={async () => {
        const result = await mutate(`user:${selectedUser.id}`, `/admin/users/${selectedUser.id}/temporary-password`, { method: "POST" });
        if (result?.temporaryPassword) {
          setTemporaryPassword({ userId: selectedUser.id, value: result.temporaryPassword });
          notice("임시 비밀번호를 만들었어요. 지금 복사하세요.");
        }
      }}
      onCopyPassword={() => {
        if (temporaryPassword?.userId !== selectedUser.id) return;
        void navigator.clipboard.writeText(temporaryPassword.value).then(() => notice("임시 비밀번호를 복사했어요.")).catch(() => notice("길게 눌러 직접 복사하세요."));
      }}
    /> : null}</div>
  </div>;
}
