import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clients = path.join(process.cwd(), "vendor/clients");

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function epkRecord(bundle: Buffer, index: number) {
  const offset = 276 + index * 32;
  return {
    dataOffset: bundle.readUInt32LE(offset + 16),
    compressedLength: bundle.readUInt32LE(offset + 20),
    rawLength: bundle.readUInt32LE(offset + 24),
  };
}

describe("in-game bitmap font client", () => {
  it("patches only the base asset package and keeps the Korean locale overlay", () => {
    const base = fs.readFileSync(path.join(clients, "stable-locale-fixed.epw"));
    const patched = fs.readFileSync(path.join(clients, "stable-galmuri.epw"));

    expect(patched.subarray(0, 8).toString("ascii")).toBe("EAG$WASM");
    expect(patched.readUInt32LE(8)).toBe(patched.length);
    expect(patched.readUInt32LE(12)).toBe(crc32(patched.subarray(16)));
    expect(patched.readUInt32LE(96)).toBe(2);

    const baseAssets = epkRecord(base, 0);
    const patchedAssets = epkRecord(patched, 0);
    const baseLocale = epkRecord(base, 1);
    const patchedLocale = epkRecord(patched, 1);
    expect(patchedAssets.dataOffset).toBe(baseAssets.dataOffset);
    expect(patchedAssets.rawLength).not.toBe(baseAssets.rawLength);
    expect(patched.subarray(patchedAssets.dataOffset, patchedAssets.dataOffset + 17)).toEqual(
      base.subarray(baseAssets.dataOffset, baseAssets.dataOffset + 17),
    );
    expect(patchedLocale.dataOffset).toBe(
      patchedAssets.dataOffset + patchedAssets.compressedLength,
    );
    expect(patched.length).toBe(patchedLocale.dataOffset + patchedLocale.compressedLength);

    const baseLocaleBytes = base.subarray(
      baseLocale.dataOffset,
      baseLocale.dataOffset + baseLocale.compressedLength,
    );
    const patchedLocaleBytes = patched.subarray(
      patchedLocale.dataOffset,
      patchedLocale.dataOffset + patchedLocale.compressedLength,
    );
    expect(crypto.createHash("sha256").update(patchedLocaleBytes).digest("hex")).toBe(
      crypto.createHash("sha256").update(baseLocaleBytes).digest("hex"),
    );
  });
});
