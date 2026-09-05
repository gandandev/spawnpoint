import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import {
  asCompound,
  asList,
  asNumber,
  asString,
  compoundTag,
  encodeNbt,
  listTag,
  numberTag,
  parseNbt,
  stringTag,
  type NbtCompound,
  type NbtDocument,
  type NbtList,
  type NbtTag,
} from "./nbt.js";
import { ServerSettingsStore } from "./server-settings.js";
import type { AdminUser, InventoryItem, PlayerDetails, ServerGameMode } from "./types.js";

const gunzip = promisify(gunzipCallback);
const gzip = promisify(gzipCallback);
const GAME_MODES: ServerGameMode[] = ["survival", "creative", "adventure", "spectator"];
const ITEM_ID = /^(?:minecraft:)?[a-z0-9_]+$/;

export type PlayerAccountReference = Pick<AdminUser, "id" | "gameUsername" | "displayName" | "createdAt">;

export interface PlayerStatePatch {
  health?: number;
  foodLevel?: number;
  gameMode?: ServerGameMode;
  location?: {
    world: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  };
}

export interface PlayerInventoryPatch {
  section: "storage" | "armor" | "extra" | "ender";
  slot: number;
  item: null | {
    type: string;
    amount: number;
    durability: number;
  };
}

interface AccessEntry {
  uuid?: string;
  name?: string;
}

interface AccessLists {
  operators: AccessEntry[];
  bans: AccessEntry[];
}

function uuidText(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function offlinePlayerUuid(username: string): string {
  const bytes = crypto.createHash("md5").update(`OfflinePlayer:${username}`, "utf8").digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidText(bytes);
}

function matchesAccess(entries: AccessEntry[], uuid: string, username: string): boolean {
  const normalizedName = username.toLowerCase();
  return entries.some((entry) => entry.uuid?.toLowerCase() === uuid || entry.name?.toLowerCase() === normalizedName);
}

function dimensionName(levelName: string, dimension: number): string {
  if (dimension === -1) return `${levelName}_nether`;
  if (dimension === 1) return `${levelName}_the_end`;
  return levelName;
}

function dimensionId(levelName: string, world: string): number | null {
  if (world === levelName) return 0;
  if (world === `${levelName}_nether`) return -1;
  if (world === `${levelName}_the_end`) return 1;
  return null;
}

function itemSection(rawSlot: number): { section: InventoryItem["section"]; slot: number } | null {
  if (rawSlot >= 0 && rawSlot <= 35) return { section: "storage", slot: rawSlot };
  if (rawSlot >= 100 && rawSlot <= 103) return { section: "armor", slot: rawSlot - 100 };
  if (rawSlot === -106) return { section: "extra", slot: 0 };
  return null;
}

function rawItemSlot(section: PlayerInventoryPatch["section"], slot: number): number | null {
  if (section === "storage" && slot >= 0 && slot <= 35) return slot;
  if (section === "armor" && slot >= 0 && slot <= 3) return slot + 100;
  if (section === "extra" && slot === 0) return -106;
  if (section === "ender" && slot >= 0 && slot <= 26) return slot;
  return null;
}

function itemMetadata(compound: NbtCompound): Pick<InventoryItem, "displayName" | "lore" | "enchantments"> {
  const metadata: Pick<InventoryItem, "displayName" | "lore" | "enchantments"> = {};
  const tag = asCompound(compound.get("tag"));
  const display = asCompound(tag?.get("display"));
  const displayName = asString(display?.get("Name"));
  if (displayName) metadata.displayName = displayName;
  const lore = asList(display?.get("Lore"), 8);
  if (lore) metadata.lore = lore.items.flatMap((entry) => {
    const value = asString(entry);
    return value === null ? [] : [value];
  });
  const enchantmentList = asList(tag?.get("ench"), 10) ?? asList(tag?.get("Enchantments"), 10);
  if (enchantmentList) {
    const enchantments: Record<string, number> = {};
    for (const entry of enchantmentList.items) {
      const value = asCompound(entry);
      const id = asNumber(value?.get("id")) ?? asString(value?.get("id"));
      const level = asNumber(value?.get("lvl"));
      if (id !== null && level !== null) enchantments[String(id)] = level;
    }
    if (Object.keys(enchantments).length) metadata.enchantments = enchantments;
  }
  return metadata;
}

function snapshotItems(list: NbtList | null, ender = false): InventoryItem[] {
  if (!list || list.elementType !== 10) return [];
  return list.items.flatMap((entry) => {
    const compound = asCompound(entry);
    if (!compound) return [];
    const rawSlot = asNumber(compound.get("Slot"));
    const placement = rawSlot === null
      ? null
      : ender
        ? rawSlot >= 0 && rawSlot <= 26 ? { section: "ender" as const, slot: rawSlot } : null
        : itemSection(rawSlot);
    const id = asString(compound.get("id"));
    const amount = asNumber(compound.get("Count"));
    const durability = asNumber(compound.get("Damage")) ?? 0;
    if (!placement || !id || amount === null || amount <= 0) return [];
    return [{
      ...placement,
      type: id.replace(/^minecraft:/, ""),
      amount,
      durability,
      ...itemMetadata(compound),
    }];
  }).sort((left, right) => left.slot - right.slot);
}


const EQUIPMENT_SLOTS = ["feet", "legs", "chest", "head"];
function modernDimensionId(name: string | null): number { return name === "minecraft:the_nether" ? -1 : name === "minecraft:the_end" ? 1 : 0; }
function componentText(tag: NbtTag | undefined): string {
  const text = asString(tag); if (text !== null) return text;
  const object = asCompound(tag);
  if (object) return (asString(object.get("text")) ?? asString(object.get("translate")) ?? "") + (asList(object.get("extra"))?.items.map(componentText).join("") ?? "");
  return asList(tag)?.items.map(componentText).join("") ?? "";
}
function modernItem(compound: NbtCompound, section: InventoryItem["section"], slot: number): InventoryItem | null {
  const id = asString(compound.get("id")); const amount = asNumber(compound.get("count"));
  if (!id || !amount || amount < 0) return null;
  const components = asCompound(compound.get("components"));
  const item: InventoryItem = { section, slot, type: id.replace(/^minecraft:/, ""), amount, durability: asNumber(components?.get("minecraft:damage")) ?? 0 };
  const name = componentText(components?.get("minecraft:custom_name") ?? components?.get("minecraft:item_name"));
  if (name) item.displayName = name;
  const lore = asList(components?.get("minecraft:lore")); if (lore) item.lore = lore.items.map(componentText);
  const enchants = asCompound(components?.get("minecraft:enchantments"));
  const levels = asCompound(enchants?.get("levels")) ?? enchants;
  if (levels) item.enchantments = Object.fromEntries([...levels].flatMap(([key, value]) => asNumber(value) === null ? [] : [[key.replace(/^minecraft:/, ""), asNumber(value)!]]));
  return item;
}
function snapshotModernItems(list: NbtList | null, ender = false): InventoryItem[] {
  return (list?.items ?? []).flatMap(entry => {
    const value = asCompound(entry); if (!value) return [];
    const slot = asNumber(value.get("Slot")); if (slot === null || slot < 0 || slot > (ender ? 26 : 35)) return [];
    const item = modernItem(value, ender ? "ender" : "storage", slot); return item ? [item] : [];
  }).sort((a,b) => a.slot - b.slot);
}
function snapshotEquipment(equipment: NbtCompound | null): InventoryItem[] {
  return [...EQUIPMENT_SLOTS, "offhand"].flatMap((key, index) => {
    const value = asCompound(equipment?.get(key)); if (!value) return [];
    const item = modernItem(value, index === 4 ? "extra" : "armor", index === 4 ? 0 : index); return item ? [item] : [];
  });
}
function updateModernInventory(root: NbtCompound, patch: PlayerInventoryPatch, rawSlot: number): void {
  const equipped = patch.section === "armor" || patch.section === "extra";
  const equipmentKey = patch.section === "extra" ? "offhand" : EQUIPMENT_SLOTS[patch.slot];
  let equipment = asCompound(root.get("equipment"));
  if (equipped && !equipment) { equipment = new Map(); root.set("equipment", compoundTag(equipment)); }
  const key = patch.section === "ender" ? "EnderItems" : "Inventory";
  let list = asList(root.get(key), 10);
  if (!equipped && !list) { root.set(key, listTag(10)); list = asList(root.get(key), 10)!; }
  const index = equipped ? -1 : list!.items.findIndex(entry => asNumber(asCompound(entry)?.get("Slot")) === rawSlot);
  if (!patch.item) { if (equipped) equipment!.delete(equipmentKey); else if (index !== -1) list!.items.splice(index, 1); return; }
  const id = patch.item.type.toLowerCase().replace(/^minecraft:/, "");
  if (!ITEM_ID.test(id)) throw new Error("아이템 ID가 올바르지 않아요.");
  const existing = equipped ? asCompound(equipment!.get(equipmentKey)) : index === -1 ? null : asCompound(list!.items[index]);
  const item = existing ?? new Map<string, NbtTag>();
  item.set("id", stringTag(`minecraft:${id}`)); item.set("count", numberTag(3, patch.item.amount));
  let components = asCompound(item.get("components"));
  if (!components) { components = new Map(); item.set("components", compoundTag(components)); }
  if (patch.item.durability > 0) components.set("minecraft:damage", numberTag(3, patch.item.durability)); else components.delete("minecraft:damage");
  if (equipped) equipment!.set(equipmentKey, compoundTag(item));
  else { item.set("Slot", numberTag(1, rawSlot)); if (index === -1) list!.items.push(compoundTag(item)); else list!.items[index] = compoundTag(item); }
}

function listNumbers(list: NbtList | null): number[] {
  return list?.items.flatMap((entry) => {
    const value = asNumber(entry);
    return value === null ? [] : [value];
  }) ?? [];
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeAtomic(filePath: string, contents: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, { mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function upsertAccessEntry(entries: AccessEntry[], uuid: string, username: string, enabled: boolean, create: () => AccessEntry): AccessEntry[] {
  const filtered = entries.filter((entry) => !matchesAccess([entry], uuid, username));
  return enabled ? [...filtered, create()] : filtered;
}

export class PlayerDataStore {
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly minecraftDir: string,
    private readonly settings: ServerSettingsStore,
    private readonly modern = false,
  ) {}

  private async accessLists(): Promise<AccessLists> {
    const [operators, bans] = await Promise.all([
      readJson<AccessEntry[]>(path.join(this.minecraftDir, "ops.json"), []),
      readJson<AccessEntry[]>(path.join(this.minecraftDir, "banned-players.json"), []),
    ]);
    return {
      operators: Array.isArray(operators) ? operators : [],
      bans: Array.isArray(bans) ? bans : [],
    };
  }

  private async paths(account: PlayerAccountReference, knownLevelName?: string): Promise<{ data: string; stats: string; uuid: string; levelName: string }> {
    const levelName = knownLevelName ?? await this.settings.levelName();
    const uuid = offlinePlayerUuid(account.gameUsername);
    return {
      data: path.join(this.minecraftDir, levelName, ...(this.modern ? ["players", "data"] : ["playerdata"]), `${uuid}.dat`),
      stats: path.join(this.minecraftDir, levelName, ...(this.modern ? ["players", "stats"] : ["stats"]), `${uuid}.json`),
      uuid,
      levelName,
    };
  }

  private async readDocument(filePath: string): Promise<{ document: NbtDocument; modifiedAt: number } | null> {
    try {
      const [compressed, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
      return { document: parseNbt(await gunzip(compressed)), modifiedAt: stats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async playTimeTicks(statsPath: string): Promise<number> {
    const stats = await readJson<Record<string, unknown>>(statsPath, {});
    const modern = (stats.stats as { "minecraft:custom"?: Record<string, unknown> } | undefined)?.["minecraft:custom"]?.["minecraft:play_one_minute"];
    const legacy = stats["stat.playOneMinute"];
    const value = typeof modern === "number" ? modern : typeof legacy === "number" ? legacy : 0;
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  }

  private async snapshot(account: PlayerAccountReference, access: AccessLists, levelName: string): Promise<PlayerDetails> {
    const playerPaths = await this.paths(account, levelName);
    const [stored, playTimeTicks] = await Promise.all([
      this.readDocument(playerPaths.data),
      this.playTimeTicks(playerPaths.stats),
    ]);
    const base = {
      accountId: account.id,
      uuid: playerPaths.uuid,
      username: account.gameUsername,
      displayName: account.displayName,
      online: false,
      dataAvailable: stored !== null,
      firstSeenAt: null,
      lastSeenAt: null,
      playTimeTicks,
      banned: matchesAccess(access.bans, playerPaths.uuid, account.gameUsername),
      operator: matchesAccess(access.operators, playerPaths.uuid, account.gameUsername),
      world: playerPaths.levelName,
      x: 0,
      y: 64,
      z: 0,
      yaw: 0,
      pitch: 0,
      health: 20,
      foodLevel: 20,
      gameMode: "survival",
      inventory: [],
      enderChest: [],
    } satisfies PlayerDetails;
    if (!stored) return base;

    const root = asCompound(stored.document.root);
    if (!root) throw new Error(`Player data for ${account.gameUsername} has an invalid root tag.`);
    const bukkit = asCompound(root.get("bukkit"));
    const position = listNumbers(asList(root.get("Pos"), 6));
    const rotation = listNumbers(asList(root.get("Rotation"), 5));
    const firstSeenAt = asNumber(bukkit?.get("firstPlayed"));
    const lastSeenAt = asNumber(bukkit?.get("lastPlayed"));
    const gameMode = asNumber(root.get("playerGameType"));
    return {
      ...base,
      firstSeenAt: firstSeenAt ?? account.createdAt,
      lastSeenAt: lastSeenAt ?? stored.modifiedAt,
      world: dimensionName(playerPaths.levelName, this.modern ? modernDimensionId(asString(root.get("Dimension"))) : asNumber(root.get("Dimension")) ?? 0),
      x: position[0] ?? 0,
      y: position[1] ?? 64,
      z: position[2] ?? 0,
      yaw: rotation[0] ?? 0,
      pitch: rotation[1] ?? 0,
      health: asNumber(root.get("Health")) ?? 20,
      foodLevel: asNumber(root.get("foodLevel")) ?? 20,
      gameMode: gameMode !== null && GAME_MODES[gameMode] ? GAME_MODES[gameMode] : "survival",
      inventory: this.modern ? [...snapshotModernItems(asList(root.get("Inventory"), 10)), ...snapshotEquipment(asCompound(root.get("equipment")))] : snapshotItems(asList(root.get("Inventory"), 10)),
      enderChest: this.modern ? snapshotModernItems(asList(root.get("EnderItems"), 10), true) : snapshotItems(asList(root.get("EnderItems"), 10), true),
    };
  }

  async list(accounts: PlayerAccountReference[]): Promise<PlayerDetails[]> {
    const [access, levelName] = await Promise.all([this.accessLists(), this.settings.levelName()]);
    return Promise.all(accounts.map((account) => this.snapshot(account, access, levelName)));
  }

  async details(account: PlayerAccountReference): Promise<PlayerDetails> {
    const [access, levelName] = await Promise.all([this.accessLists(), this.settings.levelName()]);
    return this.snapshot(account, access, levelName);
  }

  private async mutateDocument<T>(account: PlayerAccountReference, mutation: (root: NbtCompound, levelName: string) => T): Promise<T> {
    const playerPaths = await this.paths(account);
    const previous = this.mutationQueues.get(playerPaths.uuid) ?? Promise.resolve();
    let result!: T;
    const current = previous.then(async () => {
      const stored = await this.readDocument(playerPaths.data);
      if (!stored) throw new Error("이 플레이어는 아직 월드에 접속한 기록이 없어요.");
      const root = asCompound(stored.document.root);
      if (!root) throw new Error("저장된 플레이어 데이터가 올바르지 않아요.");
      result = mutation(root, playerPaths.levelName);
      await writeAtomic(playerPaths.data, await gzip(encodeNbt(stored.document)));
    });
    const settled = current.then(() => undefined, () => undefined);
    this.mutationQueues.set(playerPaths.uuid, settled);
    try {
      await current;
      return result;
    } finally {
      if (this.mutationQueues.get(playerPaths.uuid) === settled) this.mutationQueues.delete(playerPaths.uuid);
    }
  }

  async updateState(account: PlayerAccountReference, patch: PlayerStatePatch): Promise<PlayerDetails> {
    await this.mutateDocument(account, (root, levelName) => {
      if (patch.health !== undefined) root.set("Health", numberTag(5, patch.health));
      if (patch.foodLevel !== undefined) root.set("foodLevel", numberTag(3, patch.foodLevel));
      if (patch.gameMode !== undefined) root.set("playerGameType", numberTag(3, GAME_MODES.indexOf(patch.gameMode)));
      if (patch.location) {
        const dimension = dimensionId(levelName, patch.location.world);
        if (dimension === null) throw new Error("월드 선택이 올바르지 않아요.");
        root.set("Dimension", this.modern ? stringTag(dimension === -1 ? "minecraft:the_nether" : dimension === 1 ? "minecraft:the_end" : "minecraft:overworld") : numberTag(3, dimension));
        if (this.modern) { root.delete("WorldUUIDMost"); root.delete("WorldUUIDLeast"); }
        root.set("Pos", listTag(6, [
          numberTag(6, patch.location.x),
          numberTag(6, patch.location.y),
          numberTag(6, patch.location.z),
        ]));
        root.set("Rotation", listTag(5, [numberTag(5, patch.location.yaw), numberTag(5, patch.location.pitch)]));
        root.set("Motion", listTag(6, [numberTag(6, 0), numberTag(6, 0), numberTag(6, 0)]));
        root.set(this.modern ? "fall_distance" : "FallDistance", numberTag(this.modern ? 6 : 5, 0));
      }
    });
    return this.details(account);
  }

  async updateInventory(account: PlayerAccountReference, patch: PlayerInventoryPatch): Promise<PlayerDetails> {
    const rawSlot = rawItemSlot(patch.section, patch.slot);
    if (rawSlot === null) throw new Error("아이템 칸이 올바르지 않아요.");
    await this.mutateDocument(account, (root) => {
      if (this.modern) { updateModernInventory(root, patch, rawSlot); return; }
      const key = patch.section === "ender" ? "EnderItems" : "Inventory";
      let list = asList(root.get(key), 10);
      if (!list) {
        const created = listTag(10);
        root.set(key, created);
        list = asList(created, 10)!;
      }
      const existingIndex = list.items.findIndex((entry) => asNumber(asCompound(entry)?.get("Slot")) === rawSlot);
      if (!patch.item) {
        if (existingIndex !== -1) list.items.splice(existingIndex, 1);
        return;
      }
      const normalizedType = patch.item.type.toLowerCase().replace(/^minecraft:/, "");
      if (!ITEM_ID.test(normalizedType)) throw new Error("아이템 ID가 올바르지 않아요.");
      const existing = existingIndex === -1 ? null : asCompound(list.items[existingIndex]);
      const item = existing ?? new Map<string, NbtTag>();
      item.set("Slot", numberTag(1, rawSlot));
      item.set("id", stringTag(`minecraft:${normalizedType}`));
      item.set("Count", numberTag(1, patch.item.amount));
      item.set("Damage", numberTag(2, patch.item.durability));
      const entry = compoundTag(item);
      if (existingIndex === -1) list.items.push(entry);
      else list.items[existingIndex] = entry;
    });
    return this.details(account);
  }

  async setOperator(account: PlayerAccountReference, operator: boolean): Promise<PlayerDetails> {
    const uuid = offlinePlayerUuid(account.gameUsername);
    const filePath = path.join(this.minecraftDir, "ops.json");
    const current = await readJson<AccessEntry[]>(filePath, []);
    const updated = upsertAccessEntry(Array.isArray(current) ? current : [], uuid, account.gameUsername, operator, () => ({
      uuid,
      name: account.gameUsername,
      level: 4,
      bypassesPlayerLimit: false,
    } as AccessEntry));
    await writeAtomic(filePath, `${JSON.stringify(updated, null, 2)}\n`);
    return this.details(account);
  }

  async setBanned(account: PlayerAccountReference, banned: boolean, reason: string): Promise<PlayerDetails> {
    const uuid = offlinePlayerUuid(account.gameUsername);
    const filePath = path.join(this.minecraftDir, "banned-players.json");
    const current = await readJson<AccessEntry[]>(filePath, []);
    const updated = upsertAccessEntry(Array.isArray(current) ? current : [], uuid, account.gameUsername, banned, () => ({
      uuid,
      name: account.gameUsername,
      created: new Date().toISOString(),
      source: "spawnpoint admin",
      expires: "forever",
      reason,
    } as AccessEntry));
    await writeAtomic(filePath, `${JSON.stringify(updated, null, 2)}\n`);
    return this.details(account);
  }
}
