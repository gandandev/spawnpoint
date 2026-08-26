import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fontRoot = path.join(process.cwd(), "public/fonts/minecraft-1.12");

describe("Minecraft 1.12 name-tag font", () => {
  it("contains the exact bitmap pages and widths needed for Korean names", () => {
    const sizes = fs.readFileSync(path.join(fontRoot, "glyph_sizes.bin"));
    expect(sizes).toHaveLength(65_536);

    for (const character of "텔레그램") {
      const codePoint = character.codePointAt(0)!;
      const size = sizes[codePoint];
      expect(size).not.toBe(0);
      expect((size & 0x0f) + 1 - (size >>> 4)).toBe(15);
      const page = (codePoint >>> 8).toString(16).padStart(2, "0");
      const png = fs.readFileSync(path.join(fontRoot, `unicode_page_${page}.png`));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  });
});
