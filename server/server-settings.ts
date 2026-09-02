import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { ServerDifficulty, ServerGameMode, ServerSettings } from "./types.js";

const DIFFICULTIES: ServerDifficulty[] = ["peaceful", "easy", "normal", "hard"];
const GAME_MODES: ServerGameMode[] = ["survival", "creative", "adventure", "spectator"];

function parseProperties(source: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return values;
}

function replaceProperties(source: string, updates: ReadonlyMap<string, string>): string {
  const remaining = new Map(updates);
  const lines = source.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    if (separator <= 0 || line.trimStart().startsWith("#")) return line;
    const key = line.slice(0, separator).trim();
    const value = remaining.get(key);
    if (value === undefined) return line;
    remaining.delete(key);
    return `${key}=${value}`;
  });
  while (lines.length && lines.at(-1) === "") lines.pop();
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

function booleanValue(values: Map<string, string>, key: string, fallback: boolean): boolean {
  const value = values.get(key)?.toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function integerValue(values: Map<string, string>, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(values.get(key) ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function enumValue<T extends string>(values: Map<string, string>, key: string, choices: readonly T[], fallback: T): T {
  const raw = values.get(key)?.toLowerCase();
  const numeric = Number.parseInt(raw ?? "", 10);
  if (Number.isInteger(numeric) && choices[numeric]) return choices[numeric];
  return choices.includes(raw as T) ? raw as T : fallback;
}

function pluginBoolean(source: string, key: string, fallback: boolean): boolean {
  const match = new RegExp(`^${key}:\\s*(true|false)\\s*$`, "im").exec(source);
  return match ? match[1].toLowerCase() === "true" : fallback;
}

function replacePluginBoolean(source: string, key: string, value: boolean): string {
  const pattern = new RegExp(`^${key}:\\s*(?:true|false)\\s*$`, "im");
  if (pattern.test(source)) return source.replace(pattern, `${key}: ${value}`);
  const suffix = source && !source.endsWith("\n") ? "\n" : "";
  return `${source}${suffix}${key}: ${value}\n`;
}

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class ServerSettingsStore {
  private readonly propertiesPath: string;
  private readonly seedPropertiesPath: string;
  private readonly pluginConfigPath: string;

  constructor(
    private readonly minecraftDir: string,
    seedDir: string,
    private readonly fallbackMaxPlayers: number,
  ) {
    this.propertiesPath = path.join(minecraftDir, "server.properties");
    this.seedPropertiesPath = path.join(seedDir, "server.properties");
    this.pluginConfigPath = path.join(minecraftDir, "plugins", "SpawnpointBridge", "config.yml");
  }

  private async propertySource(): Promise<string> {
    return await readIfPresent(this.propertiesPath)
      ?? await fs.readFile(this.seedPropertiesPath, "utf8");
  }

  async read(): Promise<ServerSettings> {
    const values = parseProperties(await this.propertySource());
    const plugin = await readIfPresent(this.pluginConfigPath) ?? "";
    return {
      motd: (values.get("motd") ?? "spawnpoint").slice(0, 80),
      maxPlayers: integerValue(values, "max-players", this.fallbackMaxPlayers, 2, 40),
      difficulty: enumValue(values, "difficulty", DIFFICULTIES, "normal"),
      defaultGameMode: enumValue(values, "gamemode", GAME_MODES, "survival"),
      forceGameMode: booleanValue(values, "force-gamemode", false),
      viewDistance: integerValue(values, "view-distance", 4, 2, 12),
      playerIdleTimeout: integerValue(values, "player-idle-timeout", 0, 0, 120),
      pvp: booleanValue(values, "pvp", true),
      allowFlight: booleanValue(values, "allow-flight", true),
      hardcore: booleanValue(values, "hardcore", false),
      allowNether: booleanValue(values, "allow-nether", true),
      generateStructures: booleanValue(values, "generate-structures", true),
      spawnAnimals: booleanValue(values, "spawn-animals", true),
      spawnMonsters: booleanValue(values, "spawn-monsters", true),
      spawnNpcs: booleanValue(values, "spawn-npcs", true),
      whiteList: booleanValue(values, "white-list", false),
      commandBlocks: booleanValue(values, "enable-command-block", false),
      keepInventory: pluginBoolean(plugin, "keep-inventory", true),
      tpaEnabled: pluginBoolean(plugin, "tpa-enabled", true),
    };
  }

  async levelName(): Promise<string> {
    const levelName = parseProperties(await this.propertySource()).get("level-name")?.trim();
    return levelName && !levelName.includes("..") && !path.isAbsolute(levelName) ? levelName : "world";
  }

  async write(settings: ServerSettings): Promise<ServerSettings> {
    const currentProperties = await this.propertySource();
    const updates = new Map<string, string>([
      ["motd", settings.motd],
      ["max-players", String(settings.maxPlayers)],
      ["difficulty", String(DIFFICULTIES.indexOf(settings.difficulty))],
      ["gamemode", String(GAME_MODES.indexOf(settings.defaultGameMode))],
      ["force-gamemode", String(settings.forceGameMode)],
      ["view-distance", String(settings.viewDistance)],
      ["player-idle-timeout", String(settings.playerIdleTimeout)],
      ["pvp", String(settings.pvp)],
      ["allow-flight", String(settings.allowFlight)],
      ["hardcore", String(settings.hardcore)],
      ["allow-nether", String(settings.allowNether)],
      ["generate-structures", String(settings.generateStructures)],
      ["spawn-animals", String(settings.spawnAnimals)],
      ["spawn-monsters", String(settings.spawnMonsters)],
      ["spawn-npcs", String(settings.spawnNpcs)],
      ["white-list", String(settings.whiteList)],
      ["enable-command-block", String(settings.commandBlocks)],
    ]);
    await writeAtomic(this.propertiesPath, replaceProperties(currentProperties, updates));

    let plugin = await readIfPresent(this.pluginConfigPath) ?? "";
    plugin = replacePluginBoolean(plugin, "tpa-enabled", settings.tpaEnabled);
    plugin = replacePluginBoolean(plugin, "keep-inventory", settings.keepInventory);
    await writeAtomic(this.pluginConfigPath, plugin);
    return this.read();
  }

  hasRuntimeProperties(): boolean {
    return fsSync.existsSync(this.propertiesPath);
  }
}
