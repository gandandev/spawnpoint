import { SkinPreview } from "@/SkinPreview";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Ban, Box, Check, ChevronDown, Clock3, Copy, Kick, HeartPulse, KeyRound, PackagePlus, Shield, AdminBadge, Trash2, UserRound } from "@/components/pixel-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MINECRAFT_ITEM_ATLAS_COLUMNS, MINECRAFT_ITEM_ATLAS_ROWS, MINECRAFT_ITEM_TEXTURES } from "@/generated/minecraft-item-atlas";
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

type PlayerSort = "last-online" | "playtime" | "name";

const koreanNameCollator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

function comparePlayerNames(left: AdminUser, right: AdminUser) {
  return koreanNameCollator.compare(left.displayName, right.displayName)
    || koreanNameCollator.compare(left.username, right.username)
    || left.id.localeCompare(right.id);
}

function lastOnlineAt(user: AdminUser, player: PlayerDetails | undefined) {
  return player?.lastSeenAt ?? user.lastLoginAt ?? 0;
}

function comparePlayers(sort: PlayerSort, playersByAccount: Map<string, PlayerDetails>) {
  return (left: AdminUser, right: AdminUser) => {
    const leftPlayer = playersByAccount.get(left.id);
    const rightPlayer = playersByAccount.get(right.id);
    if (sort === "name") return comparePlayerNames(left, right);
    if (sort === "playtime") {
      return (rightPlayer?.playTimeTicks ?? 0) - (leftPlayer?.playTimeTicks ?? 0)
        || comparePlayerNames(left, right);
    }
    const onlineDifference = Number(Boolean(rightPlayer?.online)) - Number(Boolean(leftPlayer?.online));
    if (onlineDifference) return onlineDifference;
    return lastOnlineAt(right, rightPlayer) - lastOnlineAt(left, leftPlayer)
      || comparePlayerNames(left, right);
  };
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

type InventorySectionId = "storage" | "armor" | "extra" | "ender";

interface SelectedInventorySlot {
  section: InventorySectionId;
  slot: number;
}

interface InventorySlotPosition extends SelectedInventorySlot {
  x: number;
  y: number;
}

const storageSlots = (mainY: number, hotbarY: number): InventorySlotPosition[] => [
  ...Array.from({ length: 27 }, (_, index) => ({ section: "storage" as const, slot: index + 9, x: 8 + (index % 9) * 18, y: mainY + Math.floor(index / 9) * 18 })),
  ...Array.from({ length: 9 }, (_, index) => ({ section: "storage" as const, slot: index, x: 8 + index * 18, y: hotbarY })),
];

const PLAYER_SLOT_POSITIONS: InventorySlotPosition[] = [
  ...[3, 2, 1, 0].map((slot, index) => ({ section: "armor" as const, slot, x: 8, y: 8 + index * 18 })),
  { section: "extra", slot: 0, x: 77, y: 62 },
  ...storageSlots(84, 142),
];

const ENDER_SLOT_POSITIONS: InventorySlotPosition[] = [
  ...Array.from({ length: 27 }, (_, index) => ({ section: "ender" as const, slot: index, x: 8 + (index % 9) * 18, y: 18 + Math.floor(index / 9) * 18 })),
  ...storageSlots(85, 143),
];

const ITEM_TEXTURE_ALIASES: Readonly<Record<string, string[]>> = {
  bed: ["item:bed_red"],
  bed_block: ["item:bed_red"],
  burning_furnace: ["item:furnace"],
  crops: ["item:wheat"],
  enchantment_table: ["item:enchanting_table"],
  ink_sack: ["item:dye_powder_black"],
  lava: ["item:lava_bucket"],
  piston_base: ["item:piston"],
  piston_sticky_base: ["item:sticky_piston"],
  rails: ["item:rail"],
  redstone_wire: ["item:redstone"],
  stationary_lava: ["item:lava_bucket"],
  torch: ["block:torch_on"],
  redstone_torch: ["block:redstone_torch_on"],
  redstone_torch_off: ["block:redstone_torch_off"],
  redstone_torch_on: ["block:redstone_torch_on"],
  workbench: ["item:crafting_table"],
  golden_apple: ["item:apple_golden"],
  enchanted_golden_apple: ["item:apple_golden"],
  cooked_beef: ["item:beef_cooked"],
  beef: ["item:beef_raw"],
  cooked_chicken: ["item:chicken_cooked"],
  chicken: ["item:chicken_raw"],
};

const BLOCK_COLOR_TEXTURES = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "silver", "cyan", "purple", "blue", "brown", "green", "red", "black"] as const;
const DYE_TEXTURES = ["black", "red", "green", "brown", "blue", "purple", "cyan", "silver", "gray", "pink", "lime", "yellow", "light_blue", "magenta", "orange", "white"] as const;

function inventorySlotKey(section: InventorySectionId, slot: number) {
  return `${section}:${slot}`;
}

function inventorySectionName(section: InventorySectionId, slot: number) {
  if (section === "armor") return ["장화", "레깅스", "흉갑", "투구"][slot] ?? "방어구";
  if (section === "extra") return "보조 손";
  if (section === "ender") return "엔더 상자";
  return slot < 9 ? "단축바" : "인벤토리";
}

function itemTextureIndex(item: InventoryItem) {
  const id = item.type.toLowerCase().replace(/^minecraft:/, "");
  const shortenedMaterial = id.replace(/^golden_/, "gold_").replace(/^wooden_/, "wood_");
  const dataValue = Math.max(0, Math.min(15, Math.trunc(item.durability)));
  const variantCandidates = id === "dye" || id === "ink_sack"
    ? [`item:dye_powder_${DYE_TEXTURES[dataValue]}`]
    : id === "bed" || id === "bed_block"
      ? [`item:bed_${BLOCK_COLOR_TEXTURES[dataValue]}`]
      : [];
  const candidates = [...variantCandidates, `item:${id}`, `item:${shortenedMaterial}`, ...(ITEM_TEXTURE_ALIASES[id] ?? []), `block:${id}`];
  return candidates.map((candidate) => MINECRAFT_ITEM_TEXTURES[candidate]).find((index) => index !== undefined);
}

function MinecraftItemIcon({ item }: { item: InventoryItem }) {
  const textureIndex = itemTextureIndex(item);
  if (textureIndex === undefined) return <span className="minecraft-slot-fallback" aria-hidden="true">{item.type.slice(0, 2).toUpperCase()}</span>;
  const x = textureIndex % MINECRAFT_ITEM_ATLAS_COLUMNS;
  const y = Math.floor(textureIndex / MINECRAFT_ITEM_ATLAS_COLUMNS);
  return <span className="minecraft-item-icon" aria-hidden="true" style={{
    backgroundImage: "url('/assets/minecraft/admin-inventory/items.png')",
    backgroundPosition: `${x / (MINECRAFT_ITEM_ATLAS_COLUMNS - 1) * 100}% ${y / (MINECRAFT_ITEM_ATLAS_ROWS - 1) * 100}%`,
    backgroundSize: `${MINECRAFT_ITEM_ATLAS_COLUMNS * 100}% ${MINECRAFT_ITEM_ATLAS_ROWS * 100}%`,
  }} />;
}

function MinecraftInventoryWindow({ label, texture, height, positions, countSections, itemsBySlot, selected, onSelect }: {
  label: string;
  texture: string;
  height: number;
  positions: InventorySlotPosition[];
  countSections: InventorySectionId[];
  itemsBySlot: ReadonlyMap<string, InventoryItem>;
  selected: SelectedInventorySlot;
  onSelect: (slot: SelectedInventorySlot) => void;
}) {
  const filledCount = countSections.reduce((count, section) => count + [...itemsBySlot.keys()].filter((key) => key.startsWith(`${section}:`)).length, 0);
  return <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/25 p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><Box className="size-4" />{label}<span className="ml-auto text-xs tabular-nums text-muted-foreground">{filledCount}</span></div>
    <div className="minecraft-inventory-shell">
      <div className="minecraft-inventory-window" style={{ aspectRatio: `176 / ${height}` }}>
        <img src={texture} alt={`${label} Minecraft UI`} draggable={false} />
        {label === "플레이어 인벤토리" ? <span className="minecraft-inventory-caption" style={{ left: `${86 / 176 * 100}%`, top: `${16 / height * 100}%` }}>제작</span> : <>
          <span className="minecraft-inventory-caption" style={{ left: `${8 / 176 * 100}%`, top: `${6 / height * 100}%` }}>엔더 상자</span>
          <span className="minecraft-inventory-caption" style={{ left: `${8 / 176 * 100}%`, top: `${73 / height * 100}%` }}>인벤토리</span>
        </>}
        {positions.map((position) => {
          const key = inventorySlotKey(position.section, position.slot);
          const item = itemsBySlot.get(key);
          const slotLabel = `${inventorySectionName(position.section, position.slot)} ${position.slot}번 칸, ${item ? `${itemName(item)} ${item.amount}개` : "비어 있음"}`;
          return <button
            type="button"
            key={key}
            className="minecraft-inventory-slot"
            style={{ left: `${position.x / 176 * 100}%`, top: `${position.y / height * 100}%`, width: `${18 / 176 * 100}%`, height: `${18 / height * 100}%` }}
            aria-label={slotLabel}
            aria-pressed={selected.section === position.section && selected.slot === position.slot}
            title={slotLabel}
            onClick={() => onSelect({ section: position.section, slot: position.slot })}
          >
            {item && <><MinecraftItemIcon item={item} />{item.amount > 1 && <span className="minecraft-item-amount">{item.amount}</span>}</>}
          </button>;
        })}
      </div>
    </div>
  </section>;
}

function InventoryManager({ player, playerId, isBusy, mutate, notice }: {
  player: PlayerDetails;
  playerId: string;
  isBusy: (key: string) => boolean;
  mutate: AdminMutate;
  notice: (message: string) => void;
}) {
  const [selected, setSelected] = useState<SelectedInventorySlot>({ section: "storage", slot: 0 });
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("1");
  const [durability, setDurability] = useState("0");
  const itemsBySlot = useMemo(() => new Map([...player.inventory, ...player.enderChest].map((item) => [inventorySlotKey(item.section as InventorySectionId, item.slot), item])), [player.enderChest, player.inventory]);
  const selectedItem = itemsBySlot.get(inventorySlotKey(selected.section, selected.slot));
  const selectedItemType = selectedItem?.type ?? "";
  const selectedItemAmount = selectedItem?.amount ?? 1;
  const selectedItemDurability = selectedItem?.durability ?? 0;
  const mutationKey = `inventory:${playerId}:${selected.section}`;

  useEffect(() => {
    setSelected({ section: "storage", slot: 0 });
  }, [playerId]);

  useEffect(() => {
    setType(selectedItemType);
    setAmount(String(selectedItemAmount));
    setDurability(String(selectedItemDurability));
  }, [selected.section, selected.slot, selectedItemAmount, selectedItemDurability, selectedItemType]);

  const update = async (body: unknown, message: string) => {
    const result = await mutate(mutationKey, `/admin/players/${encodeURIComponent(playerId)}/inventory`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    if (result) notice(message);
  };

  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
    <div className="flex items-center gap-2 text-sm font-medium"><Box className="size-4" />아이템 관리<span className="ml-auto text-xs font-normal text-muted-foreground">빈 칸도 눌러서 편집할 수 있어요.</span></div>
    <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
      <MinecraftInventoryWindow label="플레이어 인벤토리" texture="/assets/minecraft/admin-inventory/player.png" height={166} positions={PLAYER_SLOT_POSITIONS} countSections={["storage", "armor", "extra"]} itemsBySlot={itemsBySlot} selected={selected} onSelect={setSelected} />
      <MinecraftInventoryWindow label="엔더 상자" texture="/assets/minecraft/admin-inventory/ender.png" height={167} positions={ENDER_SLOT_POSITIONS} countSections={["ender"]} itemsBySlot={itemsBySlot} selected={selected} onSelect={setSelected} />
    </div>
    <form className="grid gap-2 border-t pt-3 sm:grid-cols-[7rem_minmax(0,1fr)_5rem_7rem_auto]" onSubmit={(event) => {
      event.preventDefault();
      void update({ section: selected.section, slot: selected.slot, item: { type, amount: Number(amount), durability: Number(durability) } }, "아이템을 저장했어요.");
    }}>
      <div className="admin-compact-field">선택한 칸<div className="flex h-8 items-center rounded-lg border bg-muted/40 px-2 text-sm text-foreground"><span>{inventorySectionName(selected.section, selected.slot)}</span><span className="ml-auto tabular-nums">{selected.slot}</span></div></div>
      <label className="admin-compact-field">아이템 ID<Input value={type} onChange={(event) => setType(event.target.value)} placeholder="diamond_sword" pattern="(?:minecraft:)?[a-z0-9_]+" required /></label>
      <label className="admin-compact-field">수량<Input type="number" min={1} max={64} value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <label className="admin-compact-field">내구도 값<Input type="number" min={0} max={32767} value={durability} onChange={(event) => setDurability(event.target.value)} required /></label>
      <div className="flex items-end gap-1.5">
        {selectedItem && <Button type="button" variant="outline" size="icon" aria-label={`${itemName(selectedItem)} 제거`} disabled={isBusy(mutationKey)} onClick={() => void update({ section: selected.section, slot: selected.slot, item: null }, "아이템을 제거했어요.")}><Trash2 /></Button>}
        <Button type="submit" disabled={isBusy(mutationKey)}>{isBusy(mutationKey) ? <Spinner /> : <PackagePlus />}저장</Button>
      </div>
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
    <div className="flex items-center gap-2 text-sm font-medium"><UserRound className="size-4" />포털 계정{user.isAdmin && <Badge variant="secondary" className="ml-auto"><AdminBadge />관리자</Badge>}</div>
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="admin-stat"><span>최근 로그인</span><strong>{formatDate(user.lastLoginAt)}</strong></div>
      <div className="admin-stat"><span>비밀번호 변경</span><strong>{formatDate(user.passwordUpdatedAt)}</strong></div>
    </div>
    <form className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void onSave(name); }}>
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor={`admin-name-${user.id}`}>로그인 이름</FieldLabel><Input id={`admin-name-${user.id}`} value={name} minLength={1} maxLength={16} onChange={(event) => setName(event.target.value)} required /></Field>
      <Button type="submit" className="w-full sm:w-auto" disabled={busy || name === user.username}>{busy ? <Spinner /> : <Check />}이름 변경</Button>
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

function PlayerEditor({ user, player, currentUserId, isBusy, mutate, notice, temporaryPassword, onTemporaryPassword, onCopyPassword, onArchive }: {
  user: AdminUser;
  player: PlayerDetails | null;
  currentUserId: string;
  isBusy: (key: string) => boolean;
  mutate: AdminMutate;
  notice: (message: string) => void;
  temporaryPassword: string | null;
  onTemporaryPassword: () => Promise<void>;
  onCopyPassword: () => void;
  onArchive: (archived: boolean) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const playerId = user.id;
  const run = async (key: string, path: string, method: string, body: unknown, message: string) => {
    const result = await mutate(key, path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    if (result) notice(message);
  };

  return <div className="admin-player-detail">
    <div className="admin-player-summary">
    <SkinPreview src={user.skin?.previewUrl ?? "/assets/skins/steve.png?v=texture-v2"} model={user.skin?.model ?? "steve"} className="admin-player-preview" />
    <div className="flex min-w-0 flex-wrap content-center items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium">{user.displayName}</span><Badge variant={player?.online ? "secondary" : "outline"}>{player?.online ? "온라인" : "오프라인"}</Badge>{user.archivedAt !== null && <Badge variant="outline">보관됨</Badge>}{player?.banned && <Badge variant="destructive">차단됨</Badge>}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.gameUsername} · {player?.uuid ?? "월드 기록 없음"}</div>
      </div>
      <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap">
        <Button type="button" className="min-w-0 px-2 sm:px-3" variant={player?.operator ? "destructive" : "outline"} size="sm" disabled={isBusy(`op:${playerId}`)} onClick={() => void run(`op:${playerId}`, `/admin/players/${playerId}/operator`, "PUT", { operator: !player?.operator }, player?.operator ? "OP를 회수했어요." : "OP를 부여했어요.")}>{isBusy(`op:${playerId}`) ? <Spinner /> : <Shield />}{player?.operator ? "OP 회수" : "OP 부여"}</Button>
        <Button type="button" className="min-w-0 px-2 sm:px-3" variant="outline" size="sm" disabled={!player?.online || isBusy(`kick:${playerId}`)} onClick={() => void run(`kick:${playerId}`, `/admin/players/${playerId}/kick`, "POST", { reason }, "플레이어를 내보냈어요.")}><Kick />킥</Button>
        <Button type="button" className="min-w-0 px-2 sm:px-3" variant={player?.banned ? "outline" : "destructive"} size="sm" disabled={isBusy(`ban:${playerId}`)} onClick={() => void run(`ban:${playerId}`, `/admin/players/${playerId}/ban`, "PUT", { banned: !player?.banned, reason }, player?.banned ? "차단을 풀었어요." : "플레이어를 차단했어요.")}><Ban />{player?.banned ? "밴 해제" : "밴"}</Button>
        <Button type="button" className="min-w-0 px-2 sm:px-3" variant="outline" size="sm" title={user.archivedAt === null && user.id === currentUserId ? "내 계정은 보관할 수 없어요." : user.archivedAt === null && player?.online ? "게임에 접속 중인 사용자는 보관할 수 없어요." : undefined} disabled={isBusy(`archive:${playerId}`) || (user.archivedAt === null && (user.id === currentUserId || player?.online))} onClick={() => void onArchive(user.archivedAt === null)}>{isBusy(`archive:${playerId}`) ? <Spinner /> : user.archivedAt !== null ? <ArchiveRestore /> : <Archive />}{user.archivedAt !== null ? "보관 해제" : "보관"}</Button>
      </div>
      <Input className="basis-full" value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} placeholder="킥 또는 밴 사유, 비워 두면 기본 문구 사용" aria-label="킥 또는 밴 사유" />
    </div>
    </div>
    {player && <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
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
      <details className="admin-detail-section"><summary>상태와 위치 편집</summary>
      <StateEditor player={player} busy={isBusy(`state:${playerId}`)} onSave={async (body) => {
        await run(`state:${playerId}`, `/admin/players/${playerId}/state`, "PATCH", body, "플레이어 상태를 적용했어요.");
      }} />
      </details>
      <details className="admin-detail-section"><summary>아이템 관리</summary>
      <InventoryManager player={player} playerId={playerId} isBusy={isBusy} mutate={mutate} notice={notice} />
      </details>
    </> : <div className="px-1 py-3 text-xs text-muted-foreground">아직 월드에 접속한 기록이 없어서 상태와 아이템 데이터가 없습니다.</div>}

    <details className="admin-detail-section"><summary>포털 계정 관리</summary>
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
    </details>
  </div>;
}

function PlayerListButton({ user, player, selected, archived, sort, onSelect }: {
  user: AdminUser;
  player: PlayerDetails | undefined;
  selected: boolean;
  archived: boolean;
  sort: PlayerSort;
  onSelect: () => void;
}) {
  const detail = sort === "playtime"
    ? `플레이 ${formatPlayTime(player?.playTimeTicks ?? 0)}`
    : sort === "name"
      ? `@${user.username}`
      : player?.online ? player.world : formatDate(player?.lastSeenAt ?? user.lastLoginAt);

  return <button type="button" data-user-id={user.id} className={cn("admin-list-button", selected && "is-selected", archived && "is-archived")} onClick={onSelect}>
    <span className="flex min-w-0 items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full bg-muted-foreground/35", player?.online && "bg-[#96ce4d]")} aria-label={player?.online ? "온라인" : "오프라인"} /><span className={cn("truncate font-mark text-sm", player?.online && "text-[#65952c]")}>{user.displayName}</span>{archived ? <ArchiveRestore className="ml-auto size-3.5 text-muted-foreground" aria-label="보관함에서 나오기" /> : player?.banned && <Ban className="ml-auto size-3.5 text-destructive" />}</span>
    <span className="flex items-center gap-1 truncate pl-4 text-xs text-muted-foreground"><Clock3 className="size-3" />{detail}</span>
  </button>;
}

export function AdminPlayersPanel({ overview, currentUserId, isBusy, mutate, notice }: {
  overview: AdminOverview;
  currentUserId: string;
  isBusy: (key: string) => boolean;
  mutate: AdminMutate;
  notice: (message: string) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(overview.users.find((user) => user.archivedAt === null)?.id ?? overview.users[0]?.id ?? null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sort, setSort] = useState<PlayerSort>("last-online");
  const [temporaryPassword, setTemporaryPassword] = useState<{ userId: string; value: string } | null>(null);
  const playersByAccount = useMemo(() => new Map(overview.players.flatMap((player) => player.accountId ? [[player.accountId, player] as const] : [])), [overview.players]);
  const sortedUsers = useMemo(() => [...overview.users].sort(comparePlayers(sort, playersByAccount)), [overview.users, playersByAccount, sort]);
  const activeUsers = useMemo(() => sortedUsers.filter((user) => user.archivedAt === null), [sortedUsers]);
  const archivedUsers = useMemo(() => sortedUsers.filter((user) => user.archivedAt !== null), [sortedUsers]);

  useEffect(() => {
    if (!selectedUserId || !overview.users.some((user) => user.id === selectedUserId)) setSelectedUserId(activeUsers[0]?.id ?? overview.users[0]?.id ?? null);
  }, [activeUsers, overview.users, selectedUserId]);

  const selectedUser = overview.users.find((user) => user.id === selectedUserId) ?? null;
  const selectedPlayer = selectedUser ? playersByAccount.get(selectedUser.id) ?? null : null;
  if (!overview.users.length) return <div className="flex min-h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">등록된 플레이어가 없어요.</div>;

  return <div className="admin-split-panel">
    <div className="admin-list-panel">
      <label className="admin-player-sort"><span>정렬</span><select aria-label="플레이어 정렬" value={sort} onChange={(event) => setSort(event.target.value as PlayerSort)}><option value="last-online">마지막 온라인순</option><option value="playtime">플레이타임순</option><option value="name">가나다순</option></select></label>
      {activeUsers.map((user) => <PlayerListButton key={user.id} user={user} player={playersByAccount.get(user.id)} selected={user.id === selectedUserId} archived={false} sort={sort} onSelect={() => { setSelectedUserId(user.id); setTemporaryPassword(null); }} />)}
      {archivedUsers.length > 0 && <div className="admin-archive-group">
        <button type="button" className="admin-archive-toggle" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((open) => !open)}><Archive className="size-3.5" /><span>보관함</span><span className="tabular-nums text-muted-foreground">{archivedUsers.length}</span><ChevronDown className={cn("ml-auto size-3.5 transition-transform", archivedOpen && "rotate-180")} /></button>
        {archivedOpen && <div className="admin-archived-list">{archivedUsers.map((user) => <PlayerListButton key={user.id} user={user} player={playersByAccount.get(user.id)} selected={user.id === selectedUserId} archived sort={sort} onSelect={() => { setSelectedUserId(user.id); setTemporaryPassword(null); }} />)}</div>}
      </div>}
    </div>
    <div className="min-w-0">{selectedUser ? <PlayerEditor
      user={selectedUser}
      player={selectedPlayer}
      currentUserId={currentUserId}
      isBusy={isBusy}
      mutate={mutate}
      notice={notice}
      onArchive={async (archived) => {
        const result = await mutate(`archive:${selectedUser.id}`, `/admin/users/${selectedUser.id}/archive`, { method: "PUT", body: JSON.stringify({ archived }), headers: { "Content-Type": "application/json" } });
        if (!result) return;
        notice(archived ? "사용자를 보관했어요." : "사용자를 보관함에서 꺼냈어요.");
        if (archived) {
          setArchivedOpen(true);
          setSelectedUserId(activeUsers.find((user) => user.id !== selectedUser.id)?.id ?? selectedUser.id);
        }
      }}
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
