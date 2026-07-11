import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AppDatabase } from "./db.js";
import type { PublicUser, SkinModel, UserRecord } from "./types.js";

export const PRESET_SKINS = [
  { id: "moss", name: "moss", model: "steve" as const },
  { id: "ember", name: "ember", model: "alex" as const },
  { id: "slate", name: "slate", model: "steve" as const },
  { id: "violet", name: "violet", model: "alex" as const },
];

const PRESET_IDS = new Set(PRESET_SKINS.map((skin) => skin.id));

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

function assertModel(model: unknown): SkinModel {
  if (model !== "steve" && model !== "alex") throw new Error("Skin model must be steve or alex.");
  return model;
}

export class SkinService {
  private readonly skinDir: string;

  constructor(private readonly database: AppDatabase, dataDir: string) {
    this.skinDir = path.join(dataDir, "skins");
  }

  skinFile(id: string): string | null {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return path.join(this.skinDir, `${id}.png`);
  }

  async applyPreset(user: UserRecord, presetId: unknown): Promise<UserRecord> {
    if (typeof presetId !== "string" || !PRESET_IDS.has(presetId)) throw new Error("Unknown preset skin.");
    const preset = PRESET_SKINS.find((item) => item.id === presetId)!;
    return this.database.updateSkin(user.id, "preset", preset.id, preset.model, preset.name);
  }

  async applyUpload(user: UserRecord, file: Express.Multer.File | undefined, modelInput: unknown): Promise<UserRecord> {
    if (!file) throw new Error("Choose a PNG skin first.");
    if (file.size > 256 * 1024) throw new Error("Skin PNG must be smaller than 256KB.");
    const model = assertModel(modelInput);
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
}
