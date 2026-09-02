export type NbtType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface NbtList {
  elementType: NbtType;
  items: NbtTag[];
}

export type NbtCompound = Map<string, NbtTag>;
export type NbtValue = number | bigint | string | Buffer | number[] | bigint[] | NbtList | NbtCompound | null;

export interface NbtTag {
  type: NbtType;
  value: NbtValue;
}

export interface NbtDocument {
  name: string;
  root: NbtTag;
}

const MAX_DEPTH = 64;
const MAX_COLLECTION_ITEMS = 1_000_000;

class NbtReader {
  private offset = 0;

  constructor(private readonly source: Buffer) {}

  private require(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.offset + bytes > this.source.length) {
      throw new Error("NBT data is truncated or invalid.");
    }
  }

  private byte(): number {
    this.require(1);
    return this.source.readInt8(this.offset++);
  }

  private unsignedByte(): number {
    this.require(1);
    return this.source.readUInt8(this.offset++);
  }

  private short(): number {
    this.require(2);
    const value = this.source.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  private unsignedShort(): number {
    this.require(2);
    const value = this.source.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  private integer(): number {
    this.require(4);
    const value = this.source.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  private long(): bigint {
    this.require(8);
    const value = this.source.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  private float(): number {
    this.require(4);
    const value = this.source.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  private double(): number {
    this.require(8);
    const value = this.source.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  private string(): string {
    const length = this.unsignedShort();
    this.require(length);
    const value = this.source.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private collectionLength(): number {
    const length = this.integer();
    if (length < 0 || length > MAX_COLLECTION_ITEMS) throw new Error("NBT collection is too large.");
    return length;
  }

  private payload(type: NbtType, depth: number): NbtValue {
    if (depth > MAX_DEPTH) throw new Error("NBT nesting is too deep.");
    switch (type) {
      case 0: return null;
      case 1: return this.byte();
      case 2: return this.short();
      case 3: return this.integer();
      case 4: return this.long();
      case 5: return this.float();
      case 6: return this.double();
      case 7: {
        const length = this.collectionLength();
        this.require(length);
        const value = Buffer.from(this.source.subarray(this.offset, this.offset + length));
        this.offset += length;
        return value;
      }
      case 8: return this.string();
      case 9: {
        const elementType = this.unsignedByte() as NbtType;
        if (elementType < 0 || elementType > 12) throw new Error("NBT list type is invalid.");
        const length = this.collectionLength();
        if (elementType === 0 && length !== 0) throw new Error("NBT end lists must be empty.");
        const items: NbtTag[] = [];
        for (let index = 0; index < length; index += 1) {
          items.push({ type: elementType, value: this.payload(elementType, depth + 1) });
        }
        return { elementType, items } satisfies NbtList;
      }
      case 10: {
        const values: NbtCompound = new Map();
        while (true) {
          const childType = this.unsignedByte() as NbtType;
          if (childType === 0) break;
          if (childType > 12) throw new Error("NBT compound type is invalid.");
          const name = this.string();
          values.set(name, { type: childType, value: this.payload(childType, depth + 1) });
        }
        return values;
      }
      case 11: {
        const length = this.collectionLength();
        const values: number[] = [];
        for (let index = 0; index < length; index += 1) values.push(this.integer());
        return values;
      }
      case 12: {
        const length = this.collectionLength();
        const values: bigint[] = [];
        for (let index = 0; index < length; index += 1) values.push(this.long());
        return values;
      }
    }
  }

  document(): NbtDocument {
    const type = this.unsignedByte() as NbtType;
    if (type !== 10) throw new Error("NBT root must be a compound.");
    const name = this.string();
    const root = { type, value: this.payload(type, 0) } satisfies NbtTag;
    if (this.offset !== this.source.length) throw new Error("NBT data has trailing bytes.");
    return { name, root };
  }
}

class NbtWriter {
  private readonly chunks: Buffer[] = [];

  private push(size: number, write: (buffer: Buffer) => void): void {
    const buffer = Buffer.allocUnsafe(size);
    write(buffer);
    this.chunks.push(buffer);
  }

  private byte(value: number): void {
    this.push(1, (buffer) => buffer.writeInt8(value));
  }

  private unsignedByte(value: number): void {
    this.push(1, (buffer) => buffer.writeUInt8(value));
  }

  private short(value: number): void {
    this.push(2, (buffer) => buffer.writeInt16BE(value));
  }

  private unsignedShort(value: number): void {
    this.push(2, (buffer) => buffer.writeUInt16BE(value));
  }

  private integer(value: number): void {
    this.push(4, (buffer) => buffer.writeInt32BE(value));
  }

  private long(value: bigint): void {
    this.push(8, (buffer) => buffer.writeBigInt64BE(value));
  }

  private float(value: number): void {
    this.push(4, (buffer) => buffer.writeFloatBE(value));
  }

  private double(value: number): void {
    this.push(8, (buffer) => buffer.writeDoubleBE(value));
  }

  private string(value: string): void {
    const encoded = Buffer.from(value, "utf8");
    if (encoded.length > 65_535) throw new Error("NBT string is too long.");
    this.unsignedShort(encoded.length);
    this.chunks.push(encoded);
  }

  private payload(tag: NbtTag, depth: number): void {
    if (depth > MAX_DEPTH) throw new Error("NBT nesting is too deep.");
    switch (tag.type) {
      case 0: return;
      case 1: this.byte(tag.value as number); return;
      case 2: this.short(tag.value as number); return;
      case 3: this.integer(tag.value as number); return;
      case 4: this.long(tag.value as bigint); return;
      case 5: this.float(tag.value as number); return;
      case 6: this.double(tag.value as number); return;
      case 7: {
        const value = tag.value as Buffer;
        this.integer(value.length);
        this.chunks.push(value);
        return;
      }
      case 8: this.string(tag.value as string); return;
      case 9: {
        const value = tag.value as NbtList;
        this.unsignedByte(value.elementType);
        this.integer(value.items.length);
        for (const item of value.items) {
          if (item.type !== value.elementType) throw new Error("NBT list contains a mismatched tag type.");
          this.payload(item, depth + 1);
        }
        return;
      }
      case 10: {
        for (const [name, child] of tag.value as NbtCompound) {
          if (child.type === 0) throw new Error("NBT compound cannot contain a named end tag.");
          this.unsignedByte(child.type);
          this.string(name);
          this.payload(child, depth + 1);
        }
        this.unsignedByte(0);
        return;
      }
      case 11: {
        const values = tag.value as number[];
        this.integer(values.length);
        for (const value of values) this.integer(value);
        return;
      }
      case 12: {
        const values = tag.value as bigint[];
        this.integer(values.length);
        for (const value of values) this.long(value);
      }
    }
  }

  document(document: NbtDocument): Buffer {
    if (document.root.type !== 10) throw new Error("NBT root must be a compound.");
    this.unsignedByte(document.root.type);
    this.string(document.name);
    this.payload(document.root, 0);
    return Buffer.concat(this.chunks);
  }
}

export function parseNbt(source: Buffer): NbtDocument {
  return new NbtReader(source).document();
}

export function encodeNbt(document: NbtDocument): Buffer {
  return new NbtWriter().document(document);
}

export function compoundTag(values: Iterable<readonly [string, NbtTag]> = []): NbtTag {
  return { type: 10, value: new Map(values) };
}

export function listTag(elementType: NbtType, items: NbtTag[] = []): NbtTag {
  return { type: 9, value: { elementType, items } };
}

export function numberTag(type: 1 | 2 | 3 | 5 | 6, value: number): NbtTag {
  return { type, value };
}

export function longTag(value: bigint | number): NbtTag {
  return { type: 4, value: typeof value === "bigint" ? value : BigInt(Math.trunc(value)) };
}

export function stringTag(value: string): NbtTag {
  return { type: 8, value };
}

export function asCompound(tag: NbtTag | undefined): NbtCompound | null {
  return tag?.type === 10 ? tag.value as NbtCompound : null;
}

export function asList(tag: NbtTag | undefined, elementType?: NbtType): NbtList | null {
  if (tag?.type !== 9) return null;
  const list = tag.value as NbtList;
  return elementType === undefined || list.elementType === elementType ? list : null;
}

export function asNumber(tag: NbtTag | undefined): number | null {
  if (!tag || ![1, 2, 3, 4, 5, 6].includes(tag.type)) return null;
  const value = tag.value;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asString(tag: NbtTag | undefined): string | null {
  return tag?.type === 8 && typeof tag.value === "string" ? tag.value : null;
}
