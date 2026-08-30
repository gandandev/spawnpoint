import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Skin preview name-tag font", () => {
  it("ships the full browser mark font in compressed WOFF2 form", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "vendor/fonts/galmuri/Galmuri11.ttf"));
    const compressed = fs.readFileSync(path.join(process.cwd(), "vendor/fonts/galmuri/Galmuri11.woff2"));

    expect(compressed.subarray(0, 4).toString("ascii")).toBe("wOF2");
    expect(compressed.length).toBeLessThan(source.length / 5);
  });

  it("uses the browser Galmuri face for the skin preview name tag", () => {
    const renderer = fs.readFileSync(path.join(process.cwd(), "src/minecraft-name-tag.ts"), "utf8");

    expect(renderer).toContain('"Spawnpoint Mark"');
    expect(renderer).toContain("document.fonts.load(FONT, text)");
    expect(renderer).toContain("metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight");
    expect(renderer).toContain("metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent");
    expect(renderer).not.toContain("/fonts/minecraft-1.12");
  });
});
