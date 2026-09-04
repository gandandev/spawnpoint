import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MINECRAFT_ITEM_ATLAS_COLUMNS, MINECRAFT_ITEM_TEXTURES } from "../src/generated/minecraft-item-atlas";

function tarFiles(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive);
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const normalizedName = name.startsWith("./") ? name.slice(2) : name;
    const sizeText = tar.subarray(offset + 124, offset + 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = tar[offset + 156];
    const dataStart = offset + 512;
    if (type === 0 || type === 48) files.set(normalizedName, tar.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

describe("admin inventory texture atlas", () => {
  it("uses New Default V2 pixels and maps model-backed item IDs", async () => {
    const root = process.cwd();
    const archive = fs.readFileSync(path.join(root, "public/game/resource-packs/new-default-v2.tar.gz"));
    const files = tarFiles(archive);
    const diamond = files.get("assets/minecraft/textures/items/diamond.png")!;
    const textureIndex = MINECRAFT_ITEM_TEXTURES["item:diamond"];
    const left = textureIndex % MINECRAFT_ITEM_ATLAS_COLUMNS * 16;
    const top = Math.floor(textureIndex / MINECRAFT_ITEM_ATLAS_COLUMNS) * 16;
    const atlasCell = await sharp(path.join(root, "public/assets/minecraft/admin-inventory/items.png"))
      .extract({ left, top, width: 16, height: 16 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const packTexture = await sharp(diamond).ensureAlpha().raw().toBuffer();

    expect(atlasCell.equals(packTexture)).toBe(true);
    expect(MINECRAFT_ITEM_TEXTURES).toMatchObject({
      "item:bed_red": expect.any(Number),
      "item:crafting_table": expect.any(Number),
      "item:ender_chest": expect.any(Number),
      "item:furnace": expect.any(Number),
      "item:piston": expect.any(Number),
      "item:rail": expect.any(Number),
      "item:redstone": expect.any(Number),
    });
  });
});
