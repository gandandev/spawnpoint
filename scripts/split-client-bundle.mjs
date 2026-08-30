import { crc32 } from "node:zlib";
import { decompress } from "@napi-rs/lzma/xz";

const EPW_MAGIC = "EAG$WASM";
const EPW_LENGTH_OFFSET = 8;
const EPW_CRC_OFFSET = 12;
const EPW_EPK_COUNT_OFFSET = 96;
const EPW_LOADER_OFFSET = 164;
const EPW_LOADER_LENGTH_OFFSET = 168;
const EPW_MAIN_WASM_RECORD_OFFSET = 228;
const EPW_EPK_TABLE_OFFSET = 276;
const EPW_EPK_RECORD_SIZE = 32;

const WASM_MAGIC = Buffer.from("0061736d01000000", "hex");
const MINIMAL_WASM_XZ = Buffer.from(
  "/Td6WFoAAAFpIt42BMAMCCEBFgAAAAAAAAAAAKx3qqQBAAcAYXNtAQAAAADOM0scAAEkCL/ctd+QQpkNAQAAAAABWVo=",
  "base64",
);
const EMBEDDED_WASM_LOADER = Buffer.from("getClassesWASMURL:function(){return d}");
const STREAMING_WASM_LOADER = Buffer.from("getClassesWASMURL:()=>window.__spw||d ");

function epwSliceOffsetFields(epw) {
  const fields = [];
  for (let offset = 24; offset < 88; offset += 8) fields.push(offset);
  fields.push(180, 196, 212, 228, 244, 260);
  const epkCount = epw.readUInt32LE(EPW_EPK_COUNT_OFFSET);
  for (let index = 0; index < epkCount; index += 1) {
    const record = EPW_EPK_TABLE_OFFSET + index * EPW_EPK_RECORD_SIZE;
    fields.push(record, record + 8, record + 16);
  }
  return fields;
}

function patchLoader(epw) {
  if (EMBEDDED_WASM_LOADER.length !== STREAMING_WASM_LOADER.length) {
    throw new Error("Streaming WASM loader patch must preserve the EPW byte layout");
  }
  const loaderOffset = epw.readUInt32LE(EPW_LOADER_OFFSET);
  const loaderLength = epw.readUInt32LE(EPW_LOADER_LENGTH_OFFSET);
  const loaderEnd = loaderOffset + loaderLength;
  const match = epw.indexOf(EMBEDDED_WASM_LOADER, loaderOffset);
  const secondMatch = epw.indexOf(EMBEDDED_WASM_LOADER, match + 1);
  if (
    match < loaderOffset
    || match + EMBEDDED_WASM_LOADER.length > loaderEnd
    || (secondMatch !== -1 && secondMatch < loaderEnd)
  ) {
    throw new Error("EPW loader does not contain exactly one supported main WASM URL hook");
  }
  STREAMING_WASM_LOADER.copy(epw, match);
}

export async function splitClientBundle(input) {
  const epw = Buffer.from(input);
  if (epw.subarray(0, 8).toString("ascii") !== EPW_MAGIC) {
    throw new Error("Input is not an Eaglercraft EPW bundle");
  }
  if (epw.readUInt32LE(EPW_LENGTH_OFFSET) !== epw.length) {
    throw new Error("EPW bundle has an invalid declared length");
  }
  if (epw.readUInt32LE(EPW_CRC_OFFSET) !== crc32(epw.subarray(16))) {
    throw new Error("EPW bundle has an invalid checksum");
  }

  const mainOffset = epw.readUInt32LE(EPW_MAIN_WASM_RECORD_OFFSET);
  const mainCompressedLength = epw.readUInt32LE(EPW_MAIN_WASM_RECORD_OFFSET + 4);
  const mainRawLength = epw.readUInt32LE(EPW_MAIN_WASM_RECORD_OFFSET + 8);
  const mainReserved = epw.readUInt32LE(EPW_MAIN_WASM_RECORD_OFFSET + 12);
  const mainEnd = mainOffset + mainCompressedLength;
  if (mainOffset < EPW_EPK_TABLE_OFFSET || mainEnd > epw.length) {
    throw new Error("EPW main WASM record extends past the bundle");
  }

  const mainWasm = Buffer.from(await decompress(epw.subarray(mainOffset, mainEnd)));
  if (mainWasm.length !== mainRawLength || !mainWasm.subarray(0, 8).equals(WASM_MAGIC)) {
    throw new Error("EPW main WASM record is invalid");
  }

  patchLoader(epw);
  const delta = MINIMAL_WASM_XZ.length - mainCompressedLength;
  const output = Buffer.concat([
    epw.subarray(0, mainOffset),
    MINIMAL_WASM_XZ,
    epw.subarray(mainEnd),
  ]);

  for (const field of epwSliceOffsetFields(epw)) {
    if (field === EPW_MAIN_WASM_RECORD_OFFSET) continue;
    const oldOffset = epw.readUInt32LE(field);
    if (oldOffset >= mainEnd) output.writeUInt32LE(oldOffset + delta, field);
  }

  output.writeUInt32LE(mainOffset, EPW_MAIN_WASM_RECORD_OFFSET);
  output.writeUInt32LE(MINIMAL_WASM_XZ.length, EPW_MAIN_WASM_RECORD_OFFSET + 4);
  output.writeUInt32LE(WASM_MAGIC.length, EPW_MAIN_WASM_RECORD_OFFSET + 8);
  output.writeUInt32LE(mainReserved, EPW_MAIN_WASM_RECORD_OFFSET + 12);
  output.writeUInt32LE(output.length, EPW_LENGTH_OFFSET);
  output.writeUInt32LE(0, EPW_CRC_OFFSET);
  output.writeUInt32LE(crc32(output.subarray(16)), EPW_CRC_OFFSET);

  return { epw: output, mainWasm };
}
