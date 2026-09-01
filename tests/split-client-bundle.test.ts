import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { decompress } from "@napi-rs/lzma/xz";
import { describe, expect, it } from "vitest";
import { splitClientBundle } from "../scripts/split-client-bundle.mjs";

function record(bundle: Buffer, offset: number) {
  const dataOffset = bundle.readUInt32LE(offset);
  const compressedLength = bundle.readUInt32LE(offset + 4);
  return {
    dataOffset,
    compressedLength,
    rawLength: bundle.readUInt32LE(offset + 8),
    compressed: bundle.subarray(dataOffset, dataOffset + compressedLength),
  };
}

describe("streaming game client bundle", () => {
  it("externalizes the exact main module without invalidating TeaVM debug data", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "vendor/clients/stable-galmuri.epw"));
    const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
    const sourceMain = record(source, 228);
    const sourceDebug = record(source, 244);

    const { epw, mainWasm } = await splitClientBundle(source);
    const splitMain = record(epw, 228);
    const splitDebug = record(epw, 244);

    expect(crypto.createHash("sha256").update(source).digest("hex")).toBe(sourceHash);
    expect(crypto.createHash("sha256").update(mainWasm).digest("hex")).toBe(
      "3d05175c9cf1f4b35946b5999a728908ebe023a8df0b8b8d5b8dbf709b98d9e8",
    );
    expect(mainWasm.length).toBe(sourceMain.rawLength);
    expect(epw.length).toBe(17_588_054);
    expect(crypto.createHash("sha256").update(epw).digest("hex")).toBe(
      "edaadb639d6ae70bb1ba3e5428d63b765a6b7b99e873bbcae0c44ed82249c7ab",
    );
    expect(epw.readUInt32LE(8)).toBe(epw.length);
    expect(epw.readUInt32LE(12)).toBe(crc32(epw.subarray(16)));
    expect(splitMain.rawLength).toBe(8);
    expect(Buffer.from(await decompress(splitMain.compressed))).toEqual(
      Buffer.from("0061736d01000000", "hex"),
    );
    expect(splitDebug.compressed).toEqual(sourceDebug.compressed);
    expect(splitDebug.rawLength).toBe(sourceDebug.rawLength);

    const loaderOffset = epw.readUInt32LE(164);
    const loaderLength = epw.readUInt32LE(168);
    const loader = epw.subarray(loaderOffset, loaderOffset + loaderLength).toString("utf8");
    expect(loader).toContain("getClassesWASMURL:()=>window.__spw||d ");
    expect(loader).not.toContain("getClassesWASMURL:function(){return d}");
  });
});
