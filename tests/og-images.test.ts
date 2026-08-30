import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const publicDir = path.join(process.cwd(), "public");
const imageFiles = [
  "og-image.jpg",
  "og-image-spawnpoint.jpg",
  "og-image-yege.jpg",
  "og-image-bacon.jpg",
];

describe("Open Graph images", () => {
  it.each(imageFiles)("builds %s as a full-size landscape JPEG", async (file) => {
    const imagePath = path.join(publicDir, file);
    const [metadata, stats] = await Promise.all([
      sharp(imagePath).metadata(),
      fs.stat(imagePath),
    ]);

    expect(metadata).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
    expect(stats.size).toBeGreaterThan(100_000);
  });

  it("keeps the embedded game loading screen independent from the social image", async () => {
    const [socialImage, loadingScreen] = await Promise.all([
      fs.readFile(path.join(publicDir, "og-image-bacon.jpg")),
      fs.readFile(path.join(process.cwd(), "vendor", "clients", "loading-screen-bacon.jpg")),
    ]);

    expect(socialImage.equals(loadingScreen)).toBe(false);
  });
});
