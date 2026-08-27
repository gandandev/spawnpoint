import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
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

function runtimeRecord(bundle: Buffer) {
  return {
    dataOffset: bundle.readUInt32LE(212),
    compressedLength: bundle.readUInt32LE(216),
    rawLength: bundle.readUInt32LE(220),
  };
}

function mainProgramRecord(bundle: Buffer) {
  return {
    dataOffset: bundle.readUInt32LE(228),
    compressedLength: bundle.readUInt32LE(232),
    rawLength: bundle.readUInt32LE(236),
  };
}

describe("in-game bitmap font client", () => {
  it("patches the runtime input and mobile launch gate while keeping the Korean locale overlay", () => {
    const base = fs.readFileSync(path.join(clients, "stable-locale-fixed.epw"));
    const patched = fs.readFileSync(path.join(clients, "stable-galmuri.epw"));

    expect(crypto.createHash("sha256").update(base).digest("hex")).toBe(
      "6c4e3a34bb72307898f2eeea407a4da84f3ff1161503bf4f1517a6fb9ed290f0",
    );
    expect(patched.subarray(0, 8).toString("ascii")).toBe("EAG$WASM");
    expect(patched.readUInt32LE(8)).toBe(patched.length);
    expect(patched.readUInt32LE(12)).toBe(crc32(patched.subarray(16)));
    expect(patched.readUInt32LE(96)).toBe(2);

    const baseAssets = epkRecord(base, 0);
    const patchedAssets = epkRecord(patched, 0);
    const baseLocale = epkRecord(base, 1);
    const patchedLocale = epkRecord(patched, 1);
    const baseRuntime = runtimeRecord(base);
    const patchedRuntime = runtimeRecord(patched);
    const baseMainProgram = mainProgramRecord(base);
    const patchedMainProgram = mainProgramRecord(patched);
    expect(patchedRuntime.dataOffset).toBe(baseRuntime.dataOffset);
    expect(patchedRuntime.rawLength).toBe(
      baseRuntime.rawLength
        - "password".length
        + "text".length
        - "!ib&&navigator.userActivation&&navigator.userActivation.hasBeenActive".length
        + "ib||navigator.userActivation&&navigator.userActivation.hasBeenActive".length,
    );
    expect(patchedRuntime.compressedLength).not.toBe(baseRuntime.compressedLength);
    expect(patchedMainProgram.rawLength).toBe(baseMainProgram.rawLength);
    expect(patchedMainProgram.compressedLength).not.toBe(baseMainProgram.compressedLength);
    expect(patchedAssets.dataOffset).toBe(
      baseAssets.dataOffset
        + patchedRuntime.compressedLength - baseRuntime.compressedLength
        + patchedMainProgram.compressedLength - baseMainProgram.compressedLength,
    );
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

    const inspection = JSON.parse(execFileSync("python3", ["-c", `
import json, lzma, struct, sys
b = open(sys.argv[1], "rb").read()
main_offset, main_compressed, _, _ = struct.unpack_from("<IIII", b, 228)
wasm = lzma.decompress(b[main_offset:main_offset + main_compressed])
asset_offset, asset_compressed, _, _ = struct.unpack_from("<IIII", b, 292)
assets = lzma.decompress(b[asset_offset:asset_offset + asset_compressed])
ranges = [(0x38895C, 0x388A03), (0x388A2D, 0x388A86), (0x388AE1, 0x388B3D), (0x389058, 0x389076), (0x389076, 0x389098)]
print(json.dumps({
  "menu_ranges_are_nops": all(set(wasm[start:end]) == {1} for start, end in ranges),
  "version_count": wasm.count(b"spawnpoint v1.12"),
  "verbose_fps_count": wasm.count(b"fps | C: "),
  "fps_only_count": wasm.count(b"fps\\xc2\\xa7r\\xc2\\xa7r"),
  "old_edit_profile_count": assets.count(b"eaglercraft.menu.editProfile=Edit Profile"),
  "menu_label_count": assets.count("eaglercraft.menu.editProfile=메뉴".encode()),
  "splash_count": assets.count("대미덕에디션\\n".encode()),
}))
`, path.join(clients, "stable-galmuri.epw")], { encoding: "utf8" }));
    expect(inspection).toEqual({
      menu_ranges_are_nops: true,
      version_count: 1,
      verbose_fps_count: 1,
      fps_only_count: 0,
      old_edit_profile_count: 0,
      menu_label_count: 1,
      splash_count: 1,
    });
  });
});
