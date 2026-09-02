import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { asCompound, asNumber, compoundTag, encodeNbt, listTag, longTag, numberTag, parseNbt, stringTag } from "../server/nbt.js";
import { offlinePlayerUuid, PlayerDataStore } from "../server/player-data.js";
import { ServerSettingsStore } from "../server/server-settings.js";
import type { ServerSettings } from "../server/types.js";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);
const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-player-admin-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createSettingsStore(root: string) {
  const minecraft = path.join(root, "minecraft");
  const seed = path.join(root, "seed");
  fs.mkdirSync(seed, { recursive: true });
  fs.writeFileSync(path.join(seed, "server.properties"), [
    "level-name=custom_world",
    "motd=Before",
    "max-players=12",
    "view-distance=4",
    "online-mode=false",
    "",
  ].join("\n"));
  return { minecraft, store: new ServerSettingsStore(minecraft, seed, 12) };
}

function settingsUpdate(base: ServerSettings): ServerSettings {
  return {
    ...base,
    motd: "관리 서버",
    maxPlayers: 20,
    difficulty: "hard",
    defaultGameMode: "creative",
    forceGameMode: true,
    viewDistance: 10,
    playerIdleTimeout: 30,
    pvp: false,
    allowFlight: true,
    hardcore: false,
    whiteList: true,
    commandBlocks: true,
    keepInventory: false,
    tpaEnabled: false,
  };
}

function item(slot: number, type: string, amount: number) {
  return compoundTag(new Map([
    ["Slot", numberTag(1, slot)],
    ["id", stringTag(`minecraft:${type}`)],
    ["Count", numberTag(1, amount)],
    ["Damage", numberTag(2, 0)],
  ]));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("administrator server settings", () => {
  it("persists supported properties and plugin flags while preserving unrelated values", async () => {
    const root = temporaryDirectory();
    const { minecraft, store } = createSettingsStore(root);
    const saved = await store.write(settingsUpdate(await store.read()));

    expect(saved).toMatchObject({
      motd: "관리 서버",
      maxPlayers: 20,
      difficulty: "hard",
      defaultGameMode: "creative",
      pvp: false,
      keepInventory: false,
      tpaEnabled: false,
    });
    const properties = fs.readFileSync(path.join(minecraft, "server.properties"), "utf8");
    expect(properties).toContain("level-name=custom_world\n");
    expect(properties).toContain("online-mode=false\n");
    expect(properties).toContain("difficulty=3\n");
    expect(properties).toContain("gamemode=1\n");
    expect(fs.readFileSync(path.join(minecraft, "plugins", "SpawnpointBridge", "config.yml"), "utf8")).toBe(
      "tpa-enabled: false\nkeep-inventory: false\n",
    );
  });
});

describe("offline administrator player data", () => {
  it("reads and safely updates state, inventory, operator, and ban data without running Minecraft", async () => {
    const root = temporaryDirectory();
    const { minecraft, store: settings } = createSettingsStore(root);
    const players = new PlayerDataStore(minecraft, settings);
    const account = { id: "account-1", gameUsername: "OfflineQA", displayName: "오프라인 QA", createdAt: 1_700_000_000_000 };
    const uuid = offlinePlayerUuid(account.gameUsername);
    const playerDataPath = path.join(minecraft, "custom_world", "playerdata", `${uuid}.dat`);
    const statsPath = path.join(minecraft, "custom_world", "stats", `${uuid}.json`);
    fs.mkdirSync(path.dirname(playerDataPath), { recursive: true });
    fs.mkdirSync(path.dirname(statsPath), { recursive: true });

    const document = {
      name: "",
      root: compoundTag(new Map([
        ["bukkit", compoundTag(new Map([
          ["firstPlayed", longTag(1_700_000_000_000)],
          ["lastPlayed", longTag(1_700_003_600_000)],
        ]))],
        ["Pos", listTag(6, [numberTag(6, 10), numberTag(6, 65), numberTag(6, -4)])],
        ["Rotation", listTag(5, [numberTag(5, 90), numberTag(5, 12)])],
        ["Dimension", numberTag(3, 0)],
        ["Health", numberTag(5, 18.5)],
        ["foodLevel", numberTag(3, 17)],
        ["playerGameType", numberTag(3, 0)],
        ["Inventory", listTag(10, [item(0, "stone", 4), item(100, "diamond_boots", 1), item(-106, "shield", 1)])],
        ["EnderItems", listTag(10, [item(2, "diamond", 3)])],
        ["SpawnpointTestValue", numberTag(3, 42)],
      ])),
    };
    fs.writeFileSync(playerDataPath, await gzip(encodeNbt(document)));
    fs.writeFileSync(statsPath, JSON.stringify({ "stat.playOneMinute": 144_000 }));

    const initial = await players.details(account);
    expect(initial).toMatchObject({
      online: false,
      dataAvailable: true,
      world: "custom_world",
      x: 10,
      y: 65,
      z: -4,
      health: 18.5,
      foodLevel: 17,
      playTimeTicks: 144_000,
      operator: false,
      banned: false,
    });
    expect(initial.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: "storage", slot: 0, type: "stone", amount: 4 }),
      expect.objectContaining({ section: "armor", slot: 0, type: "diamond_boots" }),
      expect.objectContaining({ section: "extra", slot: 0, type: "shield" }),
    ]));
    expect(initial.enderChest).toEqual([expect.objectContaining({ section: "ender", slot: 2, type: "diamond", amount: 3 })]);

    const moved = await players.updateState(account, {
      health: 8.5,
      foodLevel: 9,
      gameMode: "creative",
      location: { world: "custom_world_nether", x: 20, y: 70, z: 30, yaw: -45, pitch: 5 },
    });
    expect(moved).toMatchObject({ health: 8.5, foodLevel: 9, gameMode: "creative", world: "custom_world_nether", x: 20, y: 70, z: 30 });

    await players.updateInventory(account, { section: "storage", slot: 0, item: { type: "dirt", amount: 32, durability: 0 } });
    const inventoried = await players.updateInventory(account, { section: "ender", slot: 3, item: { type: "emerald", amount: 7, durability: 0 } });
    expect(inventoried.inventory).toContainEqual(expect.objectContaining({ section: "storage", slot: 0, type: "dirt", amount: 32 }));
    expect(inventoried.enderChest).toContainEqual(expect.objectContaining({ section: "ender", slot: 3, type: "emerald", amount: 7 }));

    await players.setOperator(account, true);
    const restricted = await players.setBanned(account, true, "관리 테스트");
    expect(restricted).toMatchObject({ operator: true, banned: true });
    expect(JSON.parse(fs.readFileSync(path.join(minecraft, "ops.json"), "utf8"))).toContainEqual(expect.objectContaining({ uuid, name: "OfflineQA" }));
    expect(JSON.parse(fs.readFileSync(path.join(minecraft, "banned-players.json"), "utf8"))).toContainEqual(expect.objectContaining({ uuid, reason: "관리 테스트" }));

    const rewritten = parseNbt(await gunzip(fs.readFileSync(playerDataPath)));
    expect(asNumber(asCompound(rewritten.root)?.get("SpawnpointTestValue"))).toBe(42);
  });
});
