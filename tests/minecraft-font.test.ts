import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removeTextAntialiasing } from "../src/minecraft-name-tag";

describe("Skin preview name-tag font", () => {
  it("ships the full browser mark font in compressed WOFF2 form", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "vendor/fonts/galmuri/Galmuri11.ttf"));
    const compressed = fs.readFileSync(path.join(process.cwd(), "vendor/fonts/galmuri/Galmuri11.woff2"));

    expect(compressed.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(compressed.length).toBeLessThan(source.length / 5);
  });

  it("uses the browser Galmuri face for the skin preview name tag", () => {
    const renderer = fs.readFileSync(path.join(process.cwd(), "src/minecraft-name-tag.ts"), "utf8");
    const clientFontBuilder = fs.readFileSync(path.join(process.cwd(), "scripts/build-client-font.py"), "utf8");
    const nameTagFontSize = renderer.match(/^const FONT_SIZE = (\d+);$/m)?.[1];
    const clientFontSize = clientFontBuilder.match(/^FONT_SIZE = (\d+)$/m)?.[1];

    expect(renderer).toContain('"Spawnpoint Mark"');
    expect(nameTagFontSize).toBe("12");
    expect(nameTagFontSize).toBe(clientFontSize);
    expect(renderer).toContain("document.fonts.load(FONT, text)");
    expect(renderer).toContain("metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight");
    expect(renderer).toContain("metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent");
    expect(renderer).not.toContain("/fonts/minecraft-1.12");
  });

  it("uses Galmuri for every portal text role", () => {
    const styles = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).not.toContain('@import "@fontsource-variable/geist"');
    expect(styles).toContain('--font-sans: "Spawnpoint Mark", sans-serif;');
    expect(styles).toContain('--font-heading: "Spawnpoint Mark", sans-serif;');
    expect(styles).toContain('--font-mono: "Spawnpoint Mark", sans-serif;');
    expect(styles).toContain('--font-mark: "Spawnpoint Mark", sans-serif;');
  });

  it("removes partial alpha from the pixel-font glyphs", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 0,
      255, 255, 255, 127,
      255, 255, 255, 128,
      255, 255, 255, 254,
    ]);

    removeTextAntialiasing(pixels);

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([0, 0, 255, 255]);
  });
});
