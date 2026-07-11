import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import type { AppDatabase } from "./db.js";
import type { PublicUser, SkinModel, UserRecord } from "./types.js";

export function skinPathForUser(user: UserRecord): string {
  if (user.skinType === "preset") return `/assets/skins/${user.skinRef}.png`;
  return `/api/skins/${user.id}.png?v=${user.skinUpdatedAt}`;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    skin: {
      type: user.skinType,
      model: user.skinModel,
      label: user.skinLabel,
      previewUrl: skinPathForUser(user),
    },
  };
}

async function normalizeSkin(input: Buffer, outputPath: string): Promise<void> {
  const source = sharp(input, { limitInputPixels: 64 * 64 });
  const metadata = await source.metadata();
  if (metadata.format !== "png") throw new Error("Skin must be a PNG file.");
  if (metadata.width !== 64 || (metadata.height !== 64 && metadata.height !== 32)) {
    throw new Error("Skin must be 64x64 or legacy 64x32 pixels.");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  if (metadata.height === 64) {
    await source.ensureAlpha().png({ compressionLevel: 9 }).toFile(temporary);
  } else {
    const upper = await source.ensureAlpha().png().toBuffer();
    await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: upper, top: 0, left: 0 }]).png({ compressionLevel: 9 }).toFile(temporary);
  }
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

  constructor(
    private readonly database: AppDatabase,
    dataDir: string,
    private readonly clientDir = path.resolve(process.cwd(), "dist/client"),
  ) {
    this.skinDir = path.join(dataDir, "skins");
  }

  skinFile(id: string): string | null {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return path.join(this.skinDir, `${id}.png`);
  }

  async applyUpload(user: UserRecord, file: Express.Multer.File | undefined): Promise<UserRecord> {
    if (!file) throw new Error("Choose a PNG skin first.");
    if (file.size > 256 * 1024) throw new Error("Skin PNG must be smaller than 256KB.");
    const model = await detectSkinModel(file.buffer);
    const destination = this.skinFile(user.id);
    if (!destination) throw new Error("Invalid user ID.");
    await normalizeSkin(file.buffer, destination);
    return this.database.updateSkin(user.id, "upload", user.id, model, "uploaded png");
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
    const skinResponse = await fetch(parsedUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "spawnpoint/1.0" },
    });
    if (!skinResponse.ok) throw new Error("The Minecraft skin image could not be downloaded.");
    const body = Buffer.from(await skinResponse.arrayBuffer());
    if (body.length > 256 * 1024) throw new Error("The Minecraft skin image is unexpectedly large.");
    const destination = this.skinFile(user.id);
    if (!destination) throw new Error("Invalid user ID.");
    await normalizeSkin(body, destination);
    const model: SkinModel = textures.textures?.SKIN?.metadata?.model === "slim" ? "alex" : "steve";
    return this.database.updateSkin(user.id, "mojang", user.id, model, profile.name ?? usernameInput);
  }

  async createClientProfile(user: UserRecord): Promise<string> {
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
    return encodeClientProfile(user.username, user.skinModel, data);
  }
}
