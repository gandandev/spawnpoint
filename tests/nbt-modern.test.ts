import { describe, expect, it } from 'vitest';
import { asCompound, asString, compoundTag, encodeNbt, parseNbt, stringTag } from '../server/nbt';

describe('Java NBT string compatibility', () => {
  it('reads Java modified UTF-8 nulls and surrogate pairs without replacing item names', () => {
    // TAG_Compound, unnamed root, TAG_String named x, Java writeUTF("것불🔥\\0").
    const bytes = Buffer.from('0a000008000178000eeab283ebb688eda0bdedb4a5c08000', 'hex');
    const document = parseNbt(bytes);
    expect(asString(asCompound(document.root)?.get('x'))).toBe('것불🔥\0');
    expect(encodeNbt(document)).toEqual(bytes);
  });
  it('preserves Korean names, emoji, nulls and lone UTF-16 code units', () => {
    const name = '이름 🔥\0\ud800';
    const document = { name, root: compoundTag([[name, stringTag(name)]]) };
    expect(parseNbt(encodeNbt(document))).toEqual(document);
  });
  it('rejects truncated UTF-8 sequences instead of silently corrupting an item', () => {
    expect(() => parseNbt(Buffer.from('0a0000080001780001ed00', 'hex'))).toThrow('encoding');
  });
});
