import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  loadMinecraftAsciiAtlas,
  renderMinecraftAsciiText,
} from "../scripts/minecraft-ascii-font.mjs";
import { SPAWNPOINT_MINECRAFT_WORDMARK_ROWS } from "../src/lib/minecraft-wordmark";

const clientPath = path.join(process.cwd(), "vendor", "clients", "stable-locale-fixed.epw");

describe("Minecraft ASCII font", () => {
  it("extracts the original 1.12 ASCII atlas from the base client", async () => {
    const atlas = await loadMinecraftAsciiAtlas(clientPath);
    const metadata = await sharp(atlas).metadata();
    const digest = crypto.createHash("sha256").update(atlas).digest("hex");

    expect(metadata).toMatchObject({ format: "png", width: 128, height: 128 });
    expect(digest).toBe("8d3320e77d2449bc2311390fd452736c046298854377addc940e56ce4e7dda2b");
  });

  it("renders ASCII text with nearest-neighbor pixel edges", async () => {
    const atlas = await loadMinecraftAsciiAtlas(clientPath);
    const rendered = await renderMinecraftAsciiText(atlas, "spawnpoint", 82);
    const { data, info } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaValues = new Set(
      Array.from({ length: info.width * info.height }, (_, index) => data[index * info.channels + 3]),
    );

    expect(info).toMatchObject({ width: 540, height: 80, channels: 4 });
    expect([...alphaValues].sort((a, b) => a - b)).toEqual([0, 255]);

    const rows = Array.from({ length: info.height / 10 }, (_, y) => (
      Array.from({ length: info.width / 10 }, (_, x) => (
        data[((y * 10) * info.width + x * 10) * info.channels + 3] > 0 ? "#" : "."
      )).join("")
    ));
    expect(rows).toEqual(SPAWNPOINT_MINECRAFT_WORDMARK_ROWS);
  });

  it("rejects characters outside the bundled ASCII atlas", async () => {
    const atlas = await loadMinecraftAsciiAtlas(clientPath);
    await expect(renderMinecraftAsciiText(atlas, "스폰포인트", 82)).rejects.toThrow(
      "Minecraft ASCII atlas does not contain",
    );
  });
});
