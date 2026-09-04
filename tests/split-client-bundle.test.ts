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
  it("waits for Spawnpoint preparation before starting the generated client", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/game/stable.html"), "utf8");
    const preparation = html.indexOf("Promise.resolve(window.__spawnpointPrepareClient)");
    const clientStart = html.indexOf("main();", preparation);

    expect(preparation).toBeGreaterThan(-1);
    expect(clientStart).toBeGreaterThan(preparation);
  });

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
      "f82132af1b3e338ca6c5047e37df1dda83fd1c571ce7afcf12999cd93303291f",
    );
    expect(mainWasm.length).toBe(sourceMain.rawLength);
    expect(epw.length).toBe(17_587_882);
    expect(crypto.createHash("sha256").update(epw).digest("hex")).toBe(
      "f626eb2a784e670445292fe1ef7024f0ef8340fcd14295cd0f29aa55416ccd28",
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
