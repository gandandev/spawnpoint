import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import type { AppDatabase } from "./db.js";
import type { PublicUser, SkinModel, SkinType, UserRecord } from "./types.js";

export function skinPathForUser(user: UserRecord): string {
  if (user.skinType === "preset") return `/assets/skins/${user.skinRef}.png`;
  return `/api/skins/${user.id}.png?v=${user.skinUpdatedAt}`;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    skin: {
      type: user.skinType,
      model: user.skinModel,
      label: user.skinLabel,
      previewUrl: skinPathForUser(user),
    },
  };
}

const CATALOG_TEXTURE_VERSION = "texture-v1";
const CATALOG_SOURCE_CACHE_VERSION = "source-v1";
const catalogTextureUrl = (skinId: string): string => `/api/skin/catalog/${skinId}.png?v=${CATALOG_TEXTURE_VERSION}`;

export const SKIN_CATALOG = [{
  id: "famous",
  label: "유명",
  skins: [
    { id: "famous-1", label: "유명 스킨 1", textureUrl: catalogTextureUrl("famous-1") },
    { id: "famous-6", label: "유명 스킨 6", textureUrl: catalogTextureUrl("famous-6") },
    { id: "saved-07", label: "저장한 스킨 7", textureUrl: catalogTextureUrl("saved-07") },
    { id: "saved-14", label: "저장한 스킨 14", textureUrl: catalogTextureUrl("saved-14") },
    { id: "spawnpoint", label: "spawnpoint", textureUrl: catalogTextureUrl("spawnpoint") },
    { id: "saved-06", label: "저장한 스킨 6", textureUrl: catalogTextureUrl("saved-06") },
    { id: "famous-3", label: "유명 스킨 3", textureUrl: catalogTextureUrl("famous-3") },
    { id: "famous-2", label: "유명 스킨 2", textureUrl: catalogTextureUrl("famous-2") },
    { id: "saved-02", label: "저장한 스킨 2", textureUrl: catalogTextureUrl("saved-02") },
    { id: "saved-05", label: "저장한 스킨 5", textureUrl: catalogTextureUrl("saved-05") },
    { id: "famous-4", label: "유명 스킨 4", textureUrl: catalogTextureUrl("famous-4") },
    { id: "saved-08", label: "저장한 스킨 8", textureUrl: catalogTextureUrl("saved-08") },
    { id: "famous-5", label: "유명 스킨 5", textureUrl: catalogTextureUrl("famous-5") },
    { id: "saved-12", label: "저장한 스킨 12", textureUrl: catalogTextureUrl("saved-12") },
    { id: "saved-09", label: "저장한 스킨 9", textureUrl: catalogTextureUrl("saved-09") },
    { id: "famous-7", label: "유명 스킨 7", textureUrl: catalogTextureUrl("famous-7") },
    { id: "saved-01", label: "저장한 스킨 1", textureUrl: catalogTextureUrl("saved-01") },
    { id: "famous-8", label: "유명 스킨 8", textureUrl: catalogTextureUrl("famous-8") },
    { id: "saved-04", label: "저장한 스킨 4", textureUrl: catalogTextureUrl("saved-04") },
    { id: "saved-15", label: "저장한 스킨 15", textureUrl: catalogTextureUrl("saved-15") },
    { id: "famous-9", label: "유명 스킨 9", textureUrl: catalogTextureUrl("famous-9") },
    { id: "saved-11", label: "저장한 스킨 11", textureUrl: catalogTextureUrl("saved-11") },
    { id: "saved-13", label: "저장한 스킨 13", textureUrl: catalogTextureUrl("saved-13") },
    { id: "saved-03", label: "저장한 스킨 3", textureUrl: catalogTextureUrl("saved-03") },
    { id: "saved-10", label: "저장한 스킨 10", textureUrl: catalogTextureUrl("saved-10") },
    { id: "saved-16", label: "저장한 스킨 16", textureUrl: catalogTextureUrl("saved-16") },
    { id: "saved-17", label: "저장한 스킨 17", textureUrl: catalogTextureUrl("saved-17") },
    { id: "saved-18", label: "저장한 스킨 18", textureUrl: catalogTextureUrl("saved-18") },
    { id: "saved-19", label: "저장한 스킨 19", textureUrl: catalogTextureUrl("saved-19") },
    { id: "saved-20", label: "저장한 스킨 20", textureUrl: catalogTextureUrl("saved-20") },
    { id: "saved-21", label: "저장한 스킨 21", textureUrl: catalogTextureUrl("saved-21") },
    { id: "saved-22", label: "저장한 스킨 22", textureUrl: catalogTextureUrl("saved-22") },
    { id: "saved-23", label: "저장한 스킨 23", textureUrl: catalogTextureUrl("saved-23") },
    { id: "saved-24", label: "저장한 스킨 24", textureUrl: catalogTextureUrl("saved-24") },
    { id: "saved-25", label: "저장한 스킨 25", textureUrl: catalogTextureUrl("saved-25") },
    { id: "saved-26", label: "저장한 스킨 26", textureUrl: catalogTextureUrl("saved-26") },
    { id: "saved-27", label: "저장한 스킨 27", textureUrl: catalogTextureUrl("saved-27") },
    { id: "saved-28", label: "저장한 스킨 28", textureUrl: catalogTextureUrl("saved-28") },
    { id: "saved-29", label: "저장한 스킨 29", textureUrl: catalogTextureUrl("saved-29") },
    { id: "saved-30", label: "저장한 스킨 30", textureUrl: catalogTextureUrl("saved-30") },
    { id: "saved-31", label: "저장한 스킨 31", textureUrl: catalogTextureUrl("saved-31") },
    { id: "saved-32", label: "저장한 스킨 32", textureUrl: catalogTextureUrl("saved-32") },
    { id: "saved-33", label: "저장한 스킨 33", textureUrl: catalogTextureUrl("saved-33") },
    { id: "saved-34", label: "저장한 스킨 34", textureUrl: catalogTextureUrl("saved-34") },
    { id: "saved-35", label: "저장한 스킨 35", textureUrl: catalogTextureUrl("saved-35") },
    { id: "saved-36", label: "저장한 스킨 36", textureUrl: catalogTextureUrl("saved-36") },
    { id: "saved-37", label: "저장한 스킨 37", textureUrl: catalogTextureUrl("saved-37") },
    { id: "saved-38", label: "저장한 스킨 38", textureUrl: catalogTextureUrl("saved-38") },
    { id: "saved-39", label: "저장한 스킨 39", textureUrl: catalogTextureUrl("saved-39") },
    { id: "saved-40", label: "저장한 스킨 40", textureUrl: catalogTextureUrl("saved-40") },
    { id: "saved-41", label: "저장한 스킨 41", textureUrl: catalogTextureUrl("saved-41") },
    { id: "saved-42", label: "저장한 스킨 42", textureUrl: catalogTextureUrl("saved-42") },
    { id: "saved-43", label: "저장한 스킨 43", textureUrl: catalogTextureUrl("saved-43") },
    { id: "saved-44", label: "저장한 스킨 44", textureUrl: catalogTextureUrl("saved-44") },
    { id: "saved-45", label: "저장한 스킨 45", textureUrl: catalogTextureUrl("saved-45") },
    { id: "saved-46", label: "저장한 스킨 46", textureUrl: catalogTextureUrl("saved-46") },
    { id: "saved-47", label: "저장한 스킨 47", textureUrl: catalogTextureUrl("saved-47") },
    { id: "saved-48", label: "저장한 스킨 48", textureUrl: catalogTextureUrl("saved-48") },
    { id: "saved-49", label: "저장한 스킨 49", textureUrl: catalogTextureUrl("saved-49") },
    { id: "saved-50", label: "저장한 스킨 50", textureUrl: catalogTextureUrl("saved-50") },
  ],
}] as const;

type CatalogSkinSource =
  | { kind: "preset"; ref: string; model: SkinModel }
  | { kind: "remote"; url: string; model: SkinModel };

function cachedPromise<T>(cache: Map<string, Promise<T>>, key: string, factory: () => Promise<T>, maxEntries?: number): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = factory();
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  if (maxEntries !== undefined && cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

const CATALOG_SKIN_SOURCES: Readonly<Record<string, CatalogSkinSource>> = {
  spawnpoint: { kind: "preset", ref: "spawnpoint", model: "steve" },
  "famous-1": { kind: "remote", url: "https://s.namemc.com/i/5b3eacb5eae8cc05.png", model: "steve" },
  "famous-2": { kind: "remote", url: "https://s.namemc.com/i/6284e38ae0ad125d.png", model: "steve" },
  "famous-3": { kind: "remote", url: "https://s.namemc.com/i/c42444f67d4d8b8d.png", model: "steve" },
  "famous-4": { kind: "remote", url: "https://s.namemc.com/i/fef2b519ed94ba29.png", model: "steve" },
  "famous-5": { kind: "remote", url: "https://s.namemc.com/i/71b51ff645f6d8ab.png", model: "steve" },
  "famous-6": { kind: "remote", url: "https://s.namemc.com/i/219aa6f666ad9076.png", model: "steve" },
  "famous-7": { kind: "remote", url: "https://s.namemc.com/i/38ea1f7c1259ba9d.png", model: "steve" },
  "famous-8": { kind: "remote", url: "https://s.namemc.com/i/fe719aacb649026e.png", model: "steve" },
  "famous-9": { kind: "remote", url: "https://s.namemc.com/i/c48671978c4ff2c4.png", model: "steve" },
  "saved-01": { kind: "preset", ref: "saved-01", model: "steve" },
  "saved-02": { kind: "preset", ref: "saved-02", model: "alex" },
  "saved-03": { kind: "preset", ref: "saved-03", model: "alex" },
  "saved-04": { kind: "preset", ref: "saved-04", model: "alex" },
  "saved-05": { kind: "preset", ref: "saved-05", model: "alex" },
  "saved-06": { kind: "preset", ref: "saved-06", model: "alex" },
  "saved-07": { kind: "preset", ref: "saved-07", model: "alex" },
  "saved-08": { kind: "preset", ref: "saved-08", model: "steve" },
  "saved-09": { kind: "preset", ref: "saved-09", model: "steve" },
  "saved-10": { kind: "preset", ref: "saved-10", model: "steve" },
  "saved-11": { kind: "preset", ref: "saved-11", model: "steve" },
  "saved-12": { kind: "preset", ref: "saved-12", model: "alex" },
  "saved-13": { kind: "preset", ref: "saved-13", model: "alex" },
  "saved-14": { kind: "preset", ref: "saved-14", model: "steve" },
  "saved-15": { kind: "preset", ref: "saved-15", model: "alex" },
  "saved-16": { kind: "preset", ref: "saved-16", model: "alex" },
  "saved-17": { kind: "preset", ref: "saved-17", model: "alex" },
  "saved-18": { kind: "preset", ref: "saved-18", model: "alex" },
  "saved-19": { kind: "preset", ref: "saved-19", model: "alex" },
  "saved-20": { kind: "preset", ref: "saved-20", model: "steve" },
  "saved-21": { kind: "preset", ref: "saved-21", model: "steve" },
  "saved-22": { kind: "preset", ref: "saved-22", model: "steve" },
  "saved-23": { kind: "preset", ref: "saved-23", model: "alex" },
  "saved-24": { kind: "preset", ref: "saved-24", model: "steve" },
  "saved-25": { kind: "preset", ref: "saved-25", model: "steve" },
  "saved-26": { kind: "preset", ref: "saved-26", model: "alex" },
  "saved-27": { kind: "preset", ref: "saved-27", model: "alex" },
  "saved-28": { kind: "preset", ref: "saved-28", model: "alex" },
  "saved-29": { kind: "preset", ref: "saved-29", model: "alex" },
  "saved-30": { kind: "preset", ref: "saved-30", model: "alex" },
  "saved-31": { kind: "preset", ref: "saved-31", model: "alex" },
  "saved-32": { kind: "preset", ref: "saved-32", model: "alex" },
  "saved-33": { kind: "preset", ref: "saved-33", model: "alex" },
  "saved-34": { kind: "preset", ref: "saved-34", model: "alex" },
  "saved-35": { kind: "preset", ref: "saved-35", model: "alex" },
  "saved-36": { kind: "preset", ref: "saved-36", model: "alex" },
  "saved-37": { kind: "preset", ref: "saved-37", model: "alex" },
  "saved-38": { kind: "preset", ref: "saved-38", model: "steve" },
  "saved-39": { kind: "preset", ref: "saved-39", model: "alex" },
  "saved-40": { kind: "preset", ref: "saved-40", model: "steve" },
  "saved-41": { kind: "preset", ref: "saved-41", model: "alex" },
  "saved-42": { kind: "preset", ref: "saved-42", model: "alex" },
  "saved-43": { kind: "preset", ref: "saved-43", model: "alex" },
  "saved-44": { kind: "preset", ref: "saved-44", model: "steve" },
  "saved-45": { kind: "preset", ref: "saved-45", model: "alex" },
  "saved-46": { kind: "preset", ref: "saved-46", model: "steve" },
  "saved-47": { kind: "preset", ref: "saved-47", model: "steve" },
  "saved-48": { kind: "preset", ref: "saved-48", model: "steve" },
  "saved-49": { kind: "preset", ref: "saved-49", model: "steve" },
  "saved-50": { kind: "preset", ref: "saved-50", model: "steve" },
};

const LEGACY_MIRROR_PARTS = [
  [4, 16, 4, 4, 20, 48], [8, 16, 4, 4, 24, 48],
  [0, 20, 4, 12, 24, 52], [4, 20, 4, 12, 20, 52],
  [8, 20, 4, 12, 16, 52], [12, 20, 4, 12, 28, 52],
  [44, 16, 4, 4, 36, 48], [48, 16, 4, 4, 40, 48],
  [40, 20, 4, 12, 40, 52], [44, 20, 4, 12, 36, 52],
  [48, 20, 4, 12, 32, 52], [52, 20, 4, 12, 44, 52],
] as const;

async function normalizedSkinBuffer(input: Buffer): Promise<Buffer> {
  const source = sharp(input, { limitInputPixels: 64 * 64 });
  const metadata = await source.metadata();
  if (metadata.format !== "png") throw new Error("Skin must be a PNG file.");
  if (metadata.width !== 64 || (metadata.height !== 64 && metadata.height !== 32)) {
    throw new Error("Skin must be 64x64 or legacy 64x32 pixels.");
  }

  if (metadata.height === 64) {
    return source.ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
  }

  const upper = await source.ensureAlpha().png().toBuffer();
  const mirrored = await Promise.all(LEGACY_MIRROR_PARTS.map(async ([left, top, width, height, targetLeft, targetTop]) => ({
    input: await sharp(upper).extract({ left, top, width, height }).flop().png().toBuffer(),
    left: targetLeft,
    top: targetTop,
  })));
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: upper, top: 0, left: 0 }, ...mirrored]).png({ compressionLevel: 9 }).toBuffer();
}

async function normalizeSkin(input: Buffer, outputPath: string): Promise<void> {
  const normalized = await normalizedSkinBuffer(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, normalized);
  await fs.rename(temporary, outputPath);
}

async function detectSkinModel(input: Buffer): Promise<SkinModel> {
  const image = sharp(input, { limitInputPixels: 64 * 64 });
  const metadata = await image.metadata();
  if (metadata.width !== 64 || metadata.height !== 64) return "steve";

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const isTransparent = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3] === 0;
  const slimMarkers = [[54, 20], [55, 20], [54, 31], [55, 31]];
  return slimMarkers.every(([x, y]) => isTransparent(x, y)) ? "alex" : "steve";
}

function nbtName(name: string): Buffer {
  const value = Buffer.from(name, "utf8");
  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(value.length);
  return Buffer.concat([length, value]);
}

function nbtTag(type: number, name: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type]), nbtName(name), payload]);
}

function nbtInt(name: string, value: number): Buffer {
  const payload = Buffer.allocUnsafe(4);
  payload.writeInt32BE(value);
  return nbtTag(3, name, payload);
}

function nbtByte(name: string, value: number): Buffer {
  return nbtTag(1, name, Buffer.from([value]));
}

function nbtString(name: string, value: string): Buffer {
  return nbtTag(8, name, nbtName(value));
}

function nbtByteArray(name: string, value: Buffer): Buffer {
  const length = Buffer.allocUnsafe(4);
  length.writeInt32BE(value.length);
  return nbtTag(7, name, Buffer.concat([length, value]));
}

function nbtList(name: string, elementType: number, elements: Buffer[]): Buffer {
  const length = Buffer.allocUnsafe(4);
  length.writeInt32BE(elements.length);
  return nbtTag(9, name, Buffer.concat([Buffer.from([elementType]), length, ...elements]));
}

export function encodeClientProfile(username: string, model: SkinModel, rgbaSkin: Buffer): string {
  if (rgbaSkin.length !== 64 * 64 * 4) throw new Error("Client skin must be a 64x64 RGBA image.");
  const argbSkin = Buffer.allocUnsafe(rgbaSkin.length);
  for (let offset = 0; offset < rgbaSkin.length; offset += 4) {
    argbSkin[offset] = rgbaSkin[offset + 3];
    argbSkin[offset + 1] = rgbaSkin[offset];
    argbSkin[offset + 2] = rgbaSkin[offset + 1];
    argbSkin[offset + 3] = rgbaSkin[offset + 2];
  }
  const skin = Buffer.concat([
    nbtString("name", "spawnpoint"),
    nbtByteArray("data", argbSkin),
    nbtByte("model", model === "alex" ? 1 : 0),
    Buffer.from([0]),
  ]);
  const profile = Buffer.concat([
    Buffer.from([10, 0, 0]),
    nbtInt("presetSkin", -1),
    nbtInt("customSkin", 0),
    nbtInt("presetCape", 0),
    nbtInt("customCape", -1),
    nbtString("username", username),
    nbtList("skins", 10, [skin]),
    nbtList("capes", 10, []),
    Buffer.from([0]),
  ]);
  return gzipSync(profile, { level: 9 }).toString("base64");
}

export class SkinService {
  private readonly skinDir: string;
  private readonly catalogSkinDir: string;
  private readonly profileCache = new Map<string, Promise<string>>();
  private readonly catalogSkinCache = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly database: AppDatabase,
    dataDir: string,
    private readonly clientDir = path.resolve(process.cwd(), "dist/client"),
  ) {
    this.skinDir = path.join(dataDir, "skins");
    this.catalogSkinDir = path.join(dataDir, "catalog-skins");
  }

  skinFile(id: string): string | null {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return path.join(this.skinDir, `${id}.png`);
  }

  async applyUpload(user: UserRecord, file: Express.Multer.File | undefined): Promise<UserRecord> {
    if (!file) throw new Error("Choose a PNG skin first.");
    if (file.size > 256 * 1024) throw new Error("Skin PNG must be smaller than 256KB.");
    return this.applySkinBuffer(user, file.buffer, "upload", "steve", "uploaded png");
  }

  async applyMinecraftUsername(user: UserRecord, usernameInput: unknown): Promise<UserRecord> {
    if (typeof usernameInput !== "string" || !/^[A-Za-z0-9_]{1,16}$/.test(usernameInput)) {
      throw new Error("Enter a valid Minecraft username.");
    }
    const profileResponse = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(usernameInput)}`,
      { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "spawnpoint/1.0" } },
    );
    if (profileResponse.status === 204 || profileResponse.status === 404) throw new Error("Minecraft username not found.");
    if (!profileResponse.ok) throw new Error("Mojang profile lookup is temporarily unavailable.");
    const profile = await profileResponse.json() as { id?: string; name?: string };
    if (!profile.id || !/^[0-9a-f]{32}$/i.test(profile.id)) throw new Error("Mojang returned an invalid profile.");

    const sessionResponse = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}?unsigned=false`,
      { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "spawnpoint/1.0" } },
    );
    if (!sessionResponse.ok) throw new Error("Mojang texture lookup is temporarily unavailable.");
    const session = await sessionResponse.json() as {
      properties?: Array<{ name?: string; value?: string }>;
    };
    const textureProperty = session.properties?.find((property) => property.name === "textures")?.value;
    if (!textureProperty) throw new Error("That Minecraft profile has no skin.");

    let textures: { textures?: { SKIN?: { url?: string; metadata?: { model?: string } } } };
    try {
      textures = JSON.parse(Buffer.from(textureProperty, "base64").toString("utf8"));
    } catch {
      throw new Error("Mojang returned an invalid skin response.");
    }
    const skinUrl = textures.textures?.SKIN?.url;
    if (!skinUrl) throw new Error("That Minecraft profile uses no custom skin.");
    const parsedUrl = new URL(skinUrl);
    if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") || parsedUrl.hostname !== "textures.minecraft.net") {
      throw new Error("Mojang returned an untrusted skin URL.");
    }
    parsedUrl.protocol = "https:";
    const model: SkinModel = textures.textures?.SKIN?.metadata?.model === "slim" ? "alex" : "steve";
    return this.applyRemoteSkin(user, parsedUrl, "mojang", model, profile.name ?? usernameInput);
  }

  async applyCatalogSkin(user: UserRecord, skinId: unknown): Promise<UserRecord> {
    if (typeof skinId !== "string") throw new Error("스킨을 선택하세요.");
    const skin = SKIN_CATALOG.flatMap((category) => category.skins).find((candidate) => candidate.id === skinId);
    const source = CATALOG_SKIN_SOURCES[skinId];
    if (!skin || !source) throw new Error("선택한 스킨을 찾을 수 없어요.");
    if (source.kind === "preset") {
      return this.database.updateSkin(user.id, "preset", source.ref, source.model, skin.label);
    }
    const body = await this.catalogSkinBuffer(skinId, source);
    return this.applySkinBuffer(user, body, "upload", source.model, skin.label);
  }

  catalogTexture(skinId: unknown): Promise<Buffer> | null {
    if (typeof skinId !== "string") return null;
    const source = CATALOG_SKIN_SOURCES[skinId];
    if (!source) return null;
    return this.catalogSkinBuffer(skinId, source).then(normalizedSkinBuffer);
  }

  private catalogSkinBuffer(skinId: string, source: CatalogSkinSource): Promise<Buffer> {
    return cachedPromise(this.catalogSkinCache, skinId, () => source.kind === "preset"
      ? fs.readFile(path.join(this.clientDir, "assets", "skins", `${source.ref}.png`))
      : this.loadCachedCatalogSkin(skinId, new URL(source.url)));
  }

  private async loadCachedCatalogSkin(skinId: string, url: URL): Promise<Buffer> {
    const cachePath = path.join(this.catalogSkinDir, `${skinId}-${CATALOG_SOURCE_CACHE_VERSION}.png`);
    try {
      return await fs.readFile(cachePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const normalized = await normalizedSkinBuffer(await this.downloadRemoteSkin(url));
    await fs.mkdir(this.catalogSkinDir, { recursive: true });
    const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, normalized);
    await fs.rename(temporary, cachePath);
    return normalized;
  }

  private async downloadRemoteSkin(url: URL): Promise<Buffer> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "spawnpoint/1.0" },
    });
    if (!response.ok) throw new Error("The skin image could not be downloaded.");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 256 * 1024) throw new Error("The skin image is unexpectedly large.");
    return body;
  }

  private async applyRemoteSkin(user: UserRecord, url: URL, skinType: SkinType, model: SkinModel, label: string): Promise<UserRecord> {
    const body = await this.downloadRemoteSkin(url);
    return this.applySkinBuffer(user, body, skinType, model, label);
  }

  private async applySkinBuffer(user: UserRecord, body: Buffer, skinType: SkinType, model: SkinModel, label: string): Promise<UserRecord> {
    const resolvedModel = skinType === "upload" ? await detectSkinModel(body) : model;
    const destination = this.skinFile(user.id);
    if (!destination) throw new Error("Invalid user ID.");
    await normalizeSkin(body, destination);
    return this.database.updateSkin(user.id, skinType, user.id, resolvedModel, label);
  }

  createClientProfile(user: UserRecord): Promise<string> {
    const cacheKey = `${user.id}:${user.gameUsername}:${user.skinType}:${user.skinRef}:${user.skinModel}:${user.skinUpdatedAt}`;
    return cachedPromise(this.profileCache, cacheKey, () => this.buildClientProfile(user), 256);
  }

  private async buildClientProfile(user: UserRecord): Promise<string> {
    const skinFile = user.skinType === "preset"
      ? path.join(this.clientDir, "assets", "skins", `${user.skinRef}.png`)
      : this.skinFile(user.id);
    if (!skinFile) throw new Error("The saved skin could not be found.");
    const { data, info } = await sharp(skinFile, { limitInputPixels: 64 * 64 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== 64 || info.height !== 64 || info.channels !== 4) {
      throw new Error("The saved skin is not a 64x64 RGBA image.");
    }
    return encodeClientProfile(user.gameUsername, user.skinModel, data);
  }
}
