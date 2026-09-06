import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { headImage } from "../server/chat-head-pack.js";

describe("portal chat heads", () => {
  it("keeps face colors and composites only the hat face", async () => {
    const face = Buffer.alloc(8 * 8 * 4);
    for (let i = 0; i < face.length; i += 4) face.set([23, 71, 143, 255], i);
    const hat = Buffer.alloc(8 * 8 * 4);
    hat.set([241, 11, 61, 255]);
    const skin = await sharp({ create: { width: 64, height: 64, channels: 4, background: "transparent" } })
      .composite([{ input: face, raw: { width: 8, height: 8, channels: 4 }, left: 8, top: 8 },
        { input: hat, raw: { width: 8, height: 8, channels: 4 }, left: 40, top: 8 }]).png().toBuffer();
    const result = await sharp(await headImage(skin)).raw().toBuffer();
    expect([...result.subarray(0, 8)]).toEqual([241, 11, 61, 255, 23, 71, 143, 255]);
    expect(result.length).toBe(256);
  });
});
