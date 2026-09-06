import { crc32, gzipSync } from "node:zlib";
import sharp from "sharp";

function integer(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function string(value: string): Buffer {
  const bytes = Buffer.from(value);
  if (bytes.length > 255) throw new Error("EPK filename is too long");
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

export async function headImage(skin: Buffer): Promise<Buffer> {
  const face = await sharp(skin).extract({ left: 8, top: 8, width: 8, height: 8 }).png().toBuffer();
  const hat = await sharp(skin).extract({ left: 40, top: 8, width: 8, height: 8 }).png().toBuffer();
  return sharp(face).composite([{ input: hat }]).png().toBuffer();
}

export function chatHeadPack(heads: Array<{ uuid: string; png: Buffer }>): Buffer {
  const entries = [Buffer.concat([Buffer.from("HEAD"), string("file-type"), integer(13), Buffer.from("epk/resources>")])];
  function file(name: string, data: Buffer) {
    entries.push(Buffer.concat([Buffer.from("FILE"), string(name), integer(data.length + 5), integer(crc32(data)), data, Buffer.from(":>")]));
  }
  for (const { uuid, png } of heads) {
    if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error("Invalid head UUID");
    const name = `spawnpoint/head_${uuid}`;
    file(`assets/minecraft/textures/${name}.png`, png);
    file(`assets/minecraft/font/${name}.json`, Buffer.from(JSON.stringify({ providers: [
      { type: "bitmap", file: `minecraft:${name}.png`, height: 8, ascent: 7, chars: ["\ue000"] },
    ] })));
  }
  return Buffer.concat([
    Buffer.from("EAGPKG$$"), string("ver2.0"), string("portal-heads.epk"), Buffer.alloc(10),
    integer(entries.length), Buffer.from("G"), gzipSync(Buffer.concat([...entries, Buffer.from("END$")])), Buffer.from(":::YEE:>"),
  ]);
}
