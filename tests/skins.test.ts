import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../server/db.js";
import { encodeClientProfile, SkinService, skinPathForUser } from "../server/skins.js";

const dataDirectories: string[] = [];

function createDatabase(): AppDatabase {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-skins-"));
  dataDirectories.push(dataDir);
  return new AppDatabase(dataDir);
}

afterEach(() => {
  for (const dataDir of dataDirectories.splice(0)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("account skin storage", () => {
  it("uses Steve as the default skin", () => {
    const database = createDatabase();
    const user = database.createUser("newplayer", Buffer.from("hash"), Buffer.from("salt"));

    expect(user.skinType).toBe("preset");
    expect(user.skinRef).toBe("steve");
    expect(user.skinModel).toBe("steve");
    expect(user.skinLabel).toBe("steve");
    expect(skinPathForUser(user)).toBe("/assets/skins/steve.png");
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
