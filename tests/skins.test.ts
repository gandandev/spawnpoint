import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../server/db.js";
import { encodeClientProfile, SKIN_CATALOG, SkinService, skinPathForUser } from "../server/skins.js";

const dataDirectories: string[] = [];

function createDatabase(): AppDatabase {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-skins-"));
  dataDirectories.push(dataDir);
  return new AppDatabase(dataDir);
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dataDir of dataDirectories.splice(0)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("account skin storage", () => {
  it("uses the Spawnpoint catalog skin as the default for new accounts", () => {
    const database = createDatabase();
    const user = database.createUser("newplayer", Buffer.from("hash"), Buffer.from("salt"));

    expect(user.skinType).toBe("preset");
    expect(user.skinRef).toBe("spawnpoint");
    expect(user.skinModel).toBe("steve");
    expect(user.skinLabel).toBe("spawnpoint");
    expect(user.displayName).toBe("newplayer");
    expect(user.gameUsername).toBe("newplayer");
    expect(skinPathForUser(user)).toBe("/assets/skins/spawnpoint.png");
    database.close();
  });

  it("adds the default skin to the stable catalog choices", () => {
    expect(SKIN_CATALOG).toHaveLength(1);
    expect(SKIN_CATALOG[0].label).toBe("유명");
    expect(SKIN_CATALOG[0].skins).toHaveLength(26);
    expect(SKIN_CATALOG[0].skins[0].id).toBe("spawnpoint");
    expect(SKIN_CATALOG[0].skins.at(-1)?.id).toBe("saved-16");
    expect(new Set(SKIN_CATALOG[0].skins.map((skin) => skin.id)).size).toBe(26);
    expect(SKIN_CATALOG[0].skins.every((skin) => skin.textureUrl.endsWith("?v=texture-v1"))).toBe(true);
  });

  it("serves normalized skin textures for the real 3D renderer", async () => {
    const database = createDatabase();
    const service = new SkinService(database, dataDirectories[0], path.join(process.cwd(), "public"));
    const texture = await service.catalogTexture("spawnpoint");
    const metadata = await sharp(texture).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
    database.close();
  });

  it("serves the locally saved catalog skins", async () => {
    const database = createDatabase();
    const service = new SkinService(database, dataDirectories[0], path.join(process.cwd(), "public"));

    for (let index = 1; index <= 16; index += 1) {
      const texture = await service.catalogTexture(`saved-${String(index).padStart(2, "0")}`);
      const metadata = await sharp(texture).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(64);
    }
    database.close();
  });

  it("reuses downloaded catalog skins across service restarts", async () => {
    const database = createDatabase();
    const source = fs.readFileSync(path.join(process.cwd(), "public", "assets", "skins", "spawnpoint.png"));
    const fetchMock = vi.fn(async () => new Response(source, { status: 200, headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    await new SkinService(database, dataDirectories[0], path.join(process.cwd(), "public")).catalogTexture("famous-1");
    await new SkinService(database, dataDirectories[0], path.join(process.cwd(), "public")).catalogTexture("famous-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(dataDirectories[0], "catalog-skins", "famous-1-source-v1.png"))).toBe(true);
    database.close();
  });

  it("updates account identity and invalidates old sessions after password changes", () => {
    const database = createDatabase();
    const user = database.createUser("oldplayer", Buffer.from("old-hash"), Buffer.from("old-salt"));
    const renamed = database.updateIdentity(user.id, "newplayer", "새 플레이어");
    const passwordChanged = database.updatePassword(user.id, Buffer.from("new-hash"), Buffer.from("new-salt"));

    expect(renamed.username).toBe("newplayer");
    expect(renamed.gameUsername).toBe("oldplayer");
    expect(renamed.displayName).toBe("새 플레이어");
    expect(passwordChanged.sessionVersion).toBe(1);
    database.close();
  });

  it("keeps each account's skin separate and survives a database restart", () => {
    const database = createDatabase();
    const first = database.createUser("mossrunner", Buffer.from("first-hash"), Buffer.from("first-salt"));
    const second = database.createUser("emberrunner", Buffer.from("second-hash"), Buffer.from("second-salt"));

    const updatedFirst = database.updateSkin(first.id, "upload", first.id, "alex", "first upload");
    const updatedSecond = database.updateSkin(second.id, "preset", "slate", "steve", "slate");

    expect(skinPathForUser(updatedFirst)).toMatch(new RegExp(`^/api/skins/${first.id}\\.png\\?v=`));
    expect(skinPathForUser(updatedSecond)).toBe("/assets/skins/slate.png");
    expect(database.getUserById(first.id)?.skinLabel).toBe("first upload");
    expect(database.getUserById(second.id)?.skinLabel).toBe("slate");

    database.close();
    const reopened = new AppDatabase(dataDirectories[0]);
    expect(reopened.getUserById(first.id)?.skinRef).toBe(first.id);
    expect(reopened.getUserById(second.id)?.skinRef).toBe("slate");
    reopened.close();
  });

  it("creates the Eagler profile with the saved username and custom skin", async () => {
    const database = createDatabase();
    const user = database.createUser("mossrunner", Buffer.from("hash"), Buffer.from("salt"));
    const service = new SkinService(database, dataDirectories[0], path.join(process.cwd(), "public"));

    const encoded = await service.createClientProfile(user);
    const profile = gunzipSync(Buffer.from(encoded, "base64"));

    expect(profile[0]).toBe(10);
    expect(profile.includes(Buffer.from("username\0\nmossrunner", "utf8"))).toBe(true);
    expect(profile.includes(Buffer.from("presetSkin"))).toBe(true);
    expect(profile.includes(Buffer.from("customSkin"))).toBe(true);
    expect(profile.includes(Buffer.from("skins"))).toBe(true);
    expect(profile.length).toBeGreaterThan(64 * 64 * 4);
    database.close();
  });

  it("reuses a generated profile until the skin changes", async () => {
    const database = createDatabase();
    const user = database.createUser("cacheplayer", Buffer.from("hash"), Buffer.from("salt"));
    const service = new SkinService(database, dataDirectories[0], path.join(process.cwd(), "public"));

    const first = service.createClientProfile(user);
    const second = service.createClientProfile(user);
    expect(second).toBe(first);
    expect(await second).toBe(await first);

    const updated = database.updateSkin(user.id, "preset", "moss", "steve", "moss");
    expect(service.createClientProfile(updated)).not.toBe(first);
    database.close();
  });

  it("converts browser RGBA pixels to the client's ARGB layout", () => {
    const rgba = Buffer.alloc(64 * 64 * 4);
    rgba.set([17, 34, 51, 68]);
    const profile = gunzipSync(Buffer.from(encodeClientProfile("mossrunner", "alex", rgba), "base64"));
    const byteArrayTag = Buffer.from([7, 0, 4, 100, 97, 116, 97]);
    const tagOffset = profile.indexOf(byteArrayTag);

    expect(tagOffset).toBeGreaterThan(0);
    expect(profile.readInt32BE(tagOffset + byteArrayTag.length)).toBe(64 * 64 * 4);
    expect([...profile.subarray(tagOffset + byteArrayTag.length + 4, tagOffset + byteArrayTag.length + 8)])
      .toEqual([68, 17, 34, 51]);
  });

  it("disables the unsupported vanilla skin cache", () => {
    const settings = fs.readFileSync(path.join(process.cwd(), "server-runtime/seed/plugins/EaglercraftXServer/settings.yml"), "utf8");
    expect(settings).toMatch(/download_vanilla_skins_to_clients:\s*false/);
  });
});
