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
  it("keeps vanilla English while patching the Korean font and runtime", () => {
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
import hashlib, io, json, lzma, struct, sys
from PIL import Image
b = open(sys.argv[1], "rb").read()
main_offset, main_compressed, _, _ = struct.unpack_from("<IIII", b, 228)
wasm = lzma.decompress(b[main_offset:main_offset + main_compressed])
asset_offset, asset_compressed, _, _ = struct.unpack_from("<IIII", b, 292)
assets = lzma.decompress(b[asset_offset:asset_offset + asset_compressed])
def epk_file(path):
  marker = b"FILE" + bytes([len(path)]) + path
  length_offset = assets.index(marker) + len(marker)
  stored_length = int.from_bytes(assets[length_offset:length_offset + 4], "big")
  start = length_offset + 8
  return assets[start:start + stored_length - 5]
underwater_path = b"assets/minecraft/textures/misc/underwater.png"
underwater_alpha = Image.open(io.BytesIO(epk_file(underwater_path))).getchannel("A")
ascii_texture = epk_file(b"assets/minecraft/textures/font/ascii.png")
unicode_page_00 = epk_file(b"assets/minecraft/textures/font/unicode_page_00.png")
glyph_sizes = epk_file(b"assets/minecraft/font/glyph_sizes.bin")
load_screen = Image.open(io.BytesIO(epk_file(b"assets/eagler/eagtek.png"))).convert("RGB")
bacon = Image.open(sys.argv[2]).convert("RGB")
bacon.thumbnail((256, 256), Image.Resampling.LANCZOS)
expected_load_screen = Image.new("RGB", (256, 256), (11, 17, 12))
expected_load_screen.paste(
  bacon,
  ((256 - bacon.width) // 2, (256 - bacon.height) // 2),
)
ranges = [(0x38895C, 0x388A03), (0x388A2D, 0x388A86), (0x388AE1, 0x388B3D), (0x389058, 0x389076), (0x389076, 0x389098)]
disabled_control_ranges = [(0x2D0929, 0x2D0937), (0x2D0937, 0x2D0945), (0x2D0953, 0x2D0961), (0x2D0961, 0x2D096F), (0x2D098B, 0x2D0999)]
fnaw_skin_option_ranges = [(0x5BFEC3, 0x5BFEFE), (0x5BFF08, 0x5BFFC2)]
print(json.dumps({
  "menu_ranges_are_nops": all(set(wasm[start:end]) == {1} for start, end in ranges),
  "panorama_blur_chain_is_nops": set(wasm[0x4DF28A:0x4DF43A]) == {1},
  "panorama_framebuffer_is_1024": all(wasm[offset:offset + 3] == b"\\x41\\x80\\x08" for offset in (0x388851, 0x388854, 0x4DF257, 0x4DF25A)),
  "panorama_sample_count": wasm[0x5080BA],
  "disabled_control_keycodes": [wasm[0x2D050C], wasm[0x2D0709], wasm[0x2D0730]],
  "disabled_control_rows_are_nops": all(set(wasm[start:end]) == {1} for start, end in disabled_control_ranges),
  "fullbright_toggle": hashlib.sha256(wasm[0x31F766:0x31F7C3]).hexdigest(),
  "bridge_close_keycode": wasm[0x2D05A8],
  "controls_array_length": wasm[0x2D082D],
  "remaining_control_indexes": [wasm[0x2D0948], wasm[0x2D0972], wasm[0x2D0980]],
  "notification_button_range_is_nops": set(wasm[0x45A91F:0x45A9D8]) == {1},
  "fnaw_skin_option_ranges_are_nops": all(set(wasm[start:end]) == {1} for start, end in fnaw_skin_option_ranges),
  "skin_menu_done_button_y": wasm[0x5BFFF8],
  "voice_warnings_disabled": wasm[0x45B032] == 0 and wasm[0x45B03C] == 0,
  "compact_hud_renderer": hashlib.sha256(wasm[0x3240BF:0x3245F5]).hexdigest(),
  "chunk_update_deferred_list": hashlib.sha256(wasm[0x337BBC:0x337CEC]).hexdigest(),
  "version_count": wasm.count(b"spawnpoint v1.12"),
  "verbose_fps_count": wasm.count(b"fps | C: "),
  "compact_fps_count": wasm.count(b"\\x08fps | \\xc2\\xa7r"),
  "malformed_compact_fps_count": wasm.count(b"\\x09fps | \\xc2\\xa7r"),
  "old_edit_profile_count": assets.count(b"eaglercraft.menu.editProfile=Edit Profile"),
  "portal_return_label_count": assets.count("eaglercraft.menu.editProfile=포탈로 돌아가기".encode()),
  "splash_count": assets.count("대미덕에디션\\n".encode()),
  "underwater_alpha_extrema": underwater_alpha.getextrema(),
  "ascii_texture_sha256": hashlib.sha256(ascii_texture).hexdigest(),
  "unicode_page_00_sha256": hashlib.sha256(unicode_page_00).hexdigest(),
  "ascii_glyph_sizes_sha256": hashlib.sha256(glyph_sizes[:256]).hexdigest(),
  "load_screen_matches_bacon": load_screen.size == (256, 256) and load_screen.tobytes() == expected_load_screen.tobytes(),
}))
`, path.join(clients, "stable-galmuri.epw"), path.join(process.cwd(), "vendor/clients/loading-screen-bacon.jpg")], { encoding: "utf8" }));
    expect(inspection).toEqual({
      menu_ranges_are_nops: true,
      panorama_blur_chain_is_nops: true,
      panorama_framebuffer_is_1024: true,
      panorama_sample_count: 1,
      disabled_control_keycodes: [48, 0, 0],
      disabled_control_rows_are_nops: true,
      fullbright_toggle: "3a3d7e2c9d91f57cacfd278df1e3b8260a5c912e17a370763d126c9986ee6e64",
      bridge_close_keycode: 41,
      controls_array_length: 20,
      remaining_control_indexes: [17, 18, 19],
      notification_button_range_is_nops: true,
      fnaw_skin_option_ranges_are_nops: true,
      skin_menu_done_button_y: 10,
      voice_warnings_disabled: true,
      compact_hud_renderer: "d61fd78bf84b13e351568753fbb6c68d7b28c97bab69626fa46ceae1bdd7f978",
      chunk_update_deferred_list: "6a46c796868ffd4d263d1b303469ce8308f7a8a2d1c231c49572111dce560e92",
      version_count: 1,
      verbose_fps_count: 0,
      compact_fps_count: 1,
      malformed_compact_fps_count: 0,
      old_edit_profile_count: 0,
      portal_return_label_count: 1,
      splash_count: 1,
      underwater_alpha_extrema: [0, 0],
      ascii_texture_sha256: "8d3320e77d2449bc2311390fd452736c046298854377addc940e56ce4e7dda2b",
      unicode_page_00_sha256: "56855da19f265ac7675f4701793cbed95504a97c712fe1506c1e627465d6942b",
      ascii_glyph_sizes_sha256: "b47040b1ec35e88c12c3662654f674599e865d1ea0004239e0d6b73422a784f9",
      load_screen_matches_bacon: true,
    });
  }, 15_000);
});
