import fs from "node:fs/promises";
import { crc32 } from "node:zlib";
import { decompress } from "@napi-rs/lzma/xz";
import sharp from "sharp";

const EPW_MAGIC = "EAG$WASM";
const EPW_LENGTH_OFFSET = 8;
const EPW_CRC_OFFSET = 12;
const EPW_EPK_COUNT_OFFSET = 96;
const EPW_EPK_TABLE_OFFSET = 276;
const EPK_MAGIC = "EAGPKG$$";
const ASCII_TEXTURE = "assets/minecraft/textures/font/ascii.png";
const CELL_SIZE = 8;
const ATLAS_SIZE = 128;

function readU8String(input, offset) {
  const length = input[offset];
  const start = offset + 1;
  return [input.subarray(start, start + length), start + length];
}

function extractEpkFile(epk, targetName) {
  if (epk.subarray(0, 8).toString("ascii") !== EPK_MAGIC) {
    throw new Error("Embedded asset package is not a supported EPK file");
  }

  let offset = 8;
  [, offset] = readU8String(epk, offset);
  [, offset] = readU8String(epk, offset);
  const commentLength = epk.readUInt16BE(offset);
  offset += 2 + commentLength + 8;
  const entryCount = epk.readUInt32BE(offset);
  offset += 4;
  const compression = epk.subarray(offset, offset + 1).toString("ascii");
  offset += 1;
  if (compression !== "0") {
    throw new Error(`Unsupported inner EPK compression: ${compression}`);
  }

  for (let index = 0; index < entryCount; index += 1) {
    const kind = epk.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    let nameBytes;
    [nameBytes, offset] = readU8String(epk, offset);
    const name = nameBytes.toString("utf8");
    const storedLength = epk.readUInt32BE(offset);
    offset += 4;

    if (kind === "FILE") {
      if (storedLength < 5) throw new Error(`EPK file is incomplete: ${name}`);
      const expectedCrc = epk.readUInt32BE(offset);
      offset += 4;
      const dataLength = storedLength - 5;
      const data = epk.subarray(offset, offset + dataLength);
      offset += dataLength;
      if (crc32(data) !== expectedCrc) throw new Error(`EPK file has an invalid checksum: ${name}`);
      if (epk.subarray(offset, offset + 2).toString("ascii") !== ":>") {
        throw new Error(`EPK file has an invalid terminator: ${name}`);
      }
      offset += 2;
      if (name === targetName) return Buffer.from(data);
    } else {
      offset += storedLength;
      if (epk.subarray(offset, offset + 1).toString("ascii") !== ">") {
        throw new Error(`EPK object has an invalid terminator: ${name}`);
      }
      offset += 1;
    }
  }

  throw new Error(`EPK file is missing: ${targetName}`);
}

export async function loadMinecraftAsciiAtlas(epwPath) {
  const epw = await fs.readFile(epwPath);
  if (epw.subarray(0, 8).toString("ascii") !== EPW_MAGIC) {
    throw new Error("Input is not an Eaglercraft EPW bundle");
  }
  if (epw.readUInt32LE(EPW_LENGTH_OFFSET) !== epw.length) {
    throw new Error("EPW bundle has an invalid declared length");
  }
  if (epw.readUInt32LE(EPW_CRC_OFFSET) !== crc32(epw.subarray(16))) {
    throw new Error("EPW bundle has an invalid checksum");
  }
  if (epw.readUInt32LE(EPW_EPK_COUNT_OFFSET) < 1) {
    throw new Error("EPW bundle has no asset packages");
  }

  const assetRecord = EPW_EPK_TABLE_OFFSET + 16;
  const assetOffset = epw.readUInt32LE(assetRecord);
  const compressedLength = epw.readUInt32LE(assetRecord + 4);
  const rawLength = epw.readUInt32LE(assetRecord + 8);
  const assetEnd = assetOffset + compressedLength;
  if (assetOffset < EPW_EPK_TABLE_OFFSET || assetEnd > epw.length) {
    throw new Error("EPW asset package extends past the bundle");
  }

  const epk = Buffer.from(await decompress(epw.subarray(assetOffset, assetEnd)));
  if (epk.length !== rawLength) throw new Error("EPW asset package has an invalid raw length");
  return extractEpkFile(epk, ASCII_TEXTURE);
}

export async function renderMinecraftAsciiText(atlas, text, fontSize) {
  if (!text || !text.trim()) throw new Error("Minecraft text cannot be empty");
  const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== ATLAS_SIZE || info.height !== ATLAS_SIZE) {
    throw new Error("Minecraft ASCII atlas must be 128 by 128 pixels");
  }

  const glyphs = [];
  let cursor = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint > 0xff) throw new Error(`Minecraft ASCII atlas does not contain: ${character}`);
    const left = (codePoint & 0x0f) * CELL_SIZE;
    const top = (codePoint >> 4) * CELL_SIZE;
    let rightmost = -1;

    for (let x = CELL_SIZE - 1; x >= 0 && rightmost < 0; x -= 1) {
      for (let y = 0; y < CELL_SIZE; y += 1) {
        const alpha = data[((top + y) * info.width + left + x) * info.channels + 3];
        if (alpha > 0) {
          rightmost = x;
          break;
        }
      }
    }

    if (rightmost < 0 && character !== " ") {
      throw new Error(`Minecraft ASCII atlas has no visible glyph for: ${character}`);
    }
    const glyph = await sharp(atlas)
      .extract({ left, top, width: CELL_SIZE, height: CELL_SIZE })
      .png()
      .toBuffer();
    glyphs.push({ input: glyph, left: cursor, top: 0 });
    cursor += character === " " ? 4 : rightmost + 2;
  }

  const nativeText = await sharp({
    create: {
      width: cursor,
      height: CELL_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(glyphs)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const metadata = await sharp(nativeText).metadata();
  const scale = Math.max(1, Math.round(fontSize / CELL_SIZE));
  return sharp(nativeText)
    .resize(metadata.width * scale, metadata.height * scale, { kernel: "nearest" })
    .png()
    .toBuffer();
}
