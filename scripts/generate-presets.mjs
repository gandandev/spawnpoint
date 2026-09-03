import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const palettes = {
  moss: { skin: "c9916b", dark: "3d4b2c", cloth: "728f45", accent: "b9d96a", hair: "332b22", eye: "9fdaef" },
  ember: { skin: "ad735d", dark: "381d18", cloth: "8d382b", accent: "e3a24a", hair: "251715", eye: "d8e8df" },
  slate: { skin: "d2a078", dark: "20272a", cloth: "526069", accent: "a8c2c7", hair: "3b302d", eye: "78c6d0" },
  violet: { skin: "8b5d4a", dark: "251c31", cloth: "644b7d", accent: "c79ae8", hair: "1d1722", eye: "b4e5db" },
};

// Mojang's official 64x64 Steve template. Keep this separate from the generated
// color presets so the default skin cannot turn back into the old imitation.
const STEVE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFDUlEQVR42u2a20sUURzH97G0LKMotPuWbVpslj1olJXdjCgyisowsSjzgrB0gSKyC5UF1ZNQWEEQSBQ9dHsIe+zJ/+nXfM/sb/rN4ZwZ96LOrnPgyxzP/M7Z+X7OZc96JpEISfWrFhK0YcU8knlozeJKunE4HahEqSc2nF6zSEkCgGCyb+82enyqybtCZQWAzdfVVFgBJJNJn1BWFgC49/VpwGVlD0CaxQiA5HSYEwBM5sMAdKTqygcAG9+8coHKY/XXAZhUNgDYuBSPjJL/GkzVVhAEU5tqK5XZ7cnFtHWtq/TahdSw2l0HUisr1UKIWJQBAMehDuqiDdzndsP2EZECAG1ZXaWMwOCODdXqysLf++uXUGv9MhUHIByDOijjdiSAoH3ErANQD73C7TXXuGOsFj1d4YH4OTJAEy8y9Hd0mCaeZ5z8dfp88zw1bVyiYhCLOg1ZeAqC0ybaDttHRGME1DhDeVWV26u17lRAPr2+mj7dvULfHw2q65fhQRrLXKDfIxkau3ZMCTGIRR3URR5toU38HbaPiMwUcKfBAkoun09PzrbQ2KWD1JJaqswjdeweoR93rirzyCMBCmIQizqoizZkm2H7iOgAcHrMHbbV9KijkUYv7qOn55sdc4fo250e+vUg4329/Xk6QB/6DtOws+dHDGJRB3XRBve+XARt+4hIrAF4UAzbnrY0ve07QW8uHfB+0LzqanMM7qVb+3f69LJrD90/1axiEIs6qIs21BTIToewfcSsA+Bfb2x67OoR1aPPzu2i60fSNHRwCw221Suz0O3jO+jh6V1KyCMGse9721XdN5ePutdsewxS30cwuMjtC860T5JUKpXyKbSByUn7psi5l+juDlZYGh9324GcPKbkycaN3jUSAGxb46IAYPNZzW0AzgiQ5tVnzLUpUDCAbakMQXXrOtX1UMtHn+Q9/X5L4wgl7t37r85OSrx+TYl379SCia9KXjxRpiTjIZTBFOvrV1f8ty2eY/T7XJ81FQAwmA8ASH1ob68r5PnBsxA88/xAMh6SpqW4HRnLBrkOA9Xv5wPAZjAUgOkB+SHxgBgR0qSMh0zmZRsmwDJm1gFg2PMDIC8/nAHIMls8x8GgzOsG5WiaqREgYzDvpTwjLDy8NM15LpexDEA3LepjU8Z64my+8PtDCmUyRr+fFwA2J0eAFYA0AxgSgMmYBMZTwFQnO9RNAEaHOj2DXF5UADmvAToA2ftyxZYA5BqgmZZApDkdAK4mAKo8GzPlr8G8AehzMAyA/i1girUA0HtYB2CaIkUBEHQ/cBHSvwF0AKZFS5M0ZwMQtEaEAmhtbSUoDADH9ff3++QZ4o0I957e+zYAMt6wHkhzpjkuAcgpwNcpA7AZDLsvpwiuOkBvxygA6Bsvb0HlaeKIF2EbADZpGiGzBsA0gnwQHGOhW2snRpbpPexbAB2Z1oicAMQpTnGKU5ziFKc4xSlOcYpTnOIUpzgVmgo+XC324WfJAdDO/+ceADkCpuMFiFKbApEHkOv7BfzfXt+5gpT8V7rpfYJcDz+jAsB233r6yyBsJ0mlBCDofuBJkel4vOwBFPv8fyYAFPJ+wbSf/88UANNRVy4Awo6+Ig2gkCmgA5DHWjoA+X7AlM//owLANkX0w0359od++pvX8fdMAcj3/QJ9iJsAFPQCxHSnQt8vMJ3v2wCYpkhkAOR7vG7q4aCXoMoSgG8hFAuc/grMdAD4B/kHl9da7Ne9AAAAAElFTkSuQmCC";

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
await fs.writeFile(path.join(outputDir, "steve.png"), Buffer.from(STEVE_PNG_BASE64, "base64"));
console.log("generated steve.png from Mojang's official template");
for (const [name, palette] of Object.entries(palettes)) {
  await sharp(makeSkin(palette, name === "ember" || name === "violet"), { raw: { width: 64, height: 64, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, `${name}.png`));
  console.log(`generated ${name}.png`);
}
