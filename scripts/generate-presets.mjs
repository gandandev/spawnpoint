import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const palettes = {
  steve: { skin: "b77a5c", dark: "353535", cloth: "00a6a6", accent: "00a6a6", hair: "2b1b12", eye: "8dcbff" },
  moss: { skin: "c9916b", dark: "3d4b2c", cloth: "728f45", accent: "b9d96a", hair: "332b22", eye: "9fdaef" },
  ember: { skin: "ad735d", dark: "381d18", cloth: "8d382b", accent: "e3a24a", hair: "251715", eye: "d8e8df" },
  slate: { skin: "d2a078", dark: "20272a", cloth: "526069", accent: "a8c2c7", hair: "3b302d", eye: "78c6d0" },
  violet: { skin: "8b5d4a", dark: "251c31", cloth: "644b7d", accent: "c79ae8", hair: "1d1722", eye: "b4e5db" },
};

function rgba(hex, alpha = 255) {
  const value = Number.parseInt(hex, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}

function paint(buffer, x, y, width, height, color) {
  const pixel = rgba(color);
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const index = (py * 64 + px) * 4;
      buffer.set(pixel, index);
    }
  }
}

function makeSkin(palette, slim) {
  const pixels = Buffer.alloc(64 * 64 * 4, 0);
  paint(pixels, 0, 0, 32, 16, palette.skin);
  paint(pixels, 8, 8, 8, 8, palette.skin);
  paint(pixels, 8, 8, 8, 3, palette.hair);
  paint(pixels, 8, 11, 2, 1, palette.hair);
  paint(pixels, 10, 12, 1, 1, palette.eye);
  paint(pixels, 13, 12, 1, 1, palette.eye);
  paint(pixels, 0, 16, 16, 16, palette.dark);
  paint(pixels, 16, 16, 24, 16, palette.cloth);
  paint(pixels, 40, 16, 16, 16, palette.skin);
  paint(pixels, 20, 20, 8, 4, palette.cloth);
  paint(pixels, 20, 24, 8, 1, palette.accent);
  paint(pixels, 4, 20, 4, 12, palette.dark);
  paint(pixels, 44, 20, slim ? 3 : 4, 8, palette.cloth);
  paint(pixels, 44, 28, slim ? 3 : 4, 4, palette.skin);
  paint(pixels, 0, 32, 16, 16, palette.dark);
  paint(pixels, 16, 32, 24, 16, palette.cloth);
  paint(pixels, 40, 32, 16, 16, palette.skin);
  paint(pixels, 0, 48, 16, 16, palette.dark);
  paint(pixels, 16, 48, 24, 16, palette.dark);
  paint(pixels, 40, 48, 16, 16, palette.skin);
  paint(pixels, 20, 52, 4, 12, palette.dark);
  paint(pixels, 36, 52, slim ? 3 : 4, 8, palette.cloth);
  paint(pixels, 36, 60, slim ? 3 : 4, 4, palette.skin);
  paint(pixels, 40, 8, 8, 3, palette.hair);
  paint(pixels, 40, 11, 1, 5, palette.hair);
  paint(pixels, 47, 11, 1, 5, palette.hair);
  return pixels;
}

const outputDir = path.join(process.cwd(), "public/assets/skins");
await fs.mkdir(outputDir, { recursive: true });
for (const [name, palette] of Object.entries(palettes)) {
  await sharp(makeSkin(palette, name === "ember" || name === "violet"), { raw: { width: 64, height: 64, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, `${name}.png`));
  console.log(`generated ${name}.png`);
}
