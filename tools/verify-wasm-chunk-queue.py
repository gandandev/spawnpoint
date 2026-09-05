#!/usr/bin/env python3
"""Execute the shipped chunk-search bytes against the original loop using real WASM GC types.

Requires wasm-tools and Node with WASM GC support. The indexed-get helper only
models its result, so this is a correctness/lookup-count check, not an FPS or
whole-client timing benchmark. No generated harness files remain in the repo.
"""
from pathlib import Path
import atexit
import lzma
import struct
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
scratch = tempfile.TemporaryDirectory(prefix="spawnpoint-wasm-queue-")
atexit.register(scratch.cleanup)
tmp = Path(scratch.name)
base_epw = (root / "vendor/clients/stable-locale-fixed.epw").read_bytes()
o, n = struct.unpack_from("<II", base_epw, 228)
(tmp / "base.wasm").write_bytes(lzma.decompress(base_epw[o:o + n]))
subprocess.run(["wasm-tools", "print", str(tmp / "base.wasm"), "-o", str(tmp / "base.wat")], check=True)
wat = (tmp / "base.wat").read_text()
types = wat[:wat.index('  (import ')]
# The real GC types are retained. Only unrelated functions are stubbed out.
funcs = "\n".join(
    "(func (result (ref null 3)) unreachable)" if index in (269, 271) else "(func)"
    for index in range(3317)
)
# Function 3317 is the indexed-get helper called by the unchanged original loop.
# It returns the same node value; unrelated game methods are never invoked.
getter='''
(func (type 7432) (param $list (ref null 2723)) (param $index i32) (result (ref null 3))
 (local $node (ref null 2725))
 global.get $lookups i32.const 1 i32.add global.set $lookups
 local.get $list ref.cast (ref null 2726) struct.get 2726 3 local.set $node
 block loop
  local.get $index i32.eqz br_if 1
  local.get $node struct.get 2725 3 local.set $node
  local.get $index i32.const 1 i32.sub local.set $index br 0
 end end
 local.get $node struct.get 2725 2)
(func $search (param (ref null 1910) (ref null 3131)) (result i32) unreachable)
(func (export "lookups") (result i32) global.get $lookups)
(func (export "check") (param $size i32) (param $match i32) (result i32)
 (local $manager (ref null 1910)) (local $list (ref null 2726))
 (local $node (ref null 2725)) (local $head (ref null 2725))
 (local $task (ref null 3132)) (local $chunk (ref null 3131))
 (local $target (ref null 3131)) (local $i i32)
 i32.const 0 global.set $lookups
 struct.new_default 1910 local.set $manager
 struct.new_default 2726 local.set $list
 struct.new_default 3131 local.set $target
 local.get $manager local.get $list struct.set 1910 10
 local.get $list local.get $size struct.set 2726 5
 local.get $size local.set $i
 block loop
  local.get $i i32.eqz br_if 1
  local.get $i i32.const 1 i32.sub local.set $i
  struct.new_default 3131 local.set $chunk
  local.get $i local.get $match i32.eq
  if local.get $chunk local.set $target end
  struct.new_default 3132 local.set $task
  local.get $task local.get $chunk struct.set 3132 2
  struct.new_default 2725 local.set $node
  local.get $node local.get $task struct.set 2725 2
  local.get $node local.get $head struct.set 2725 3
  local.get $head ref.is_null i32.eqz
  if local.get $head local.get $node struct.set 2725 4
  else local.get $list local.get $node struct.set 2726 4 end
  local.get $node local.set $head
  br 0
 end end
 local.get $list local.get $head struct.set 2726 3
 local.get $manager local.get $target call $search)
)
'''
(tmp / "harness.wat").write_text(
    types + '(tag (param (ref null 3)))\n'
    + '(global $lookups (mut i32) (i32.const 0))\n' + funcs + getter
)
subprocess.run(
    ["wasm-tools", "parse", str(tmp / "harness.wat"), "-o", str(tmp / "harness.wasm")],
    check=True,
)


def read_uleb(data: bytes, offset: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
        shift += 7


def encode_uleb(value: int) -> bytes:
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def replace_search_body(module: bytes, body: bytes) -> bytes:
    offset = 8
    output = bytearray(module[:8])
    replaced = False
    while offset < len(module):
        section_id = module[offset]
        size, start = read_uleb(module, offset + 1)
        end = start + size
        payload = module[start:end]
        if section_id == 10:
            count, cursor = read_uleb(module, start)
            payload = bytearray(encode_uleb(count))
            for index in range(count):
                old_size, body_start = read_uleb(module, cursor)
                old_body = module[body_start:body_start + old_size]
                new_body = body if index == 3318 else old_body
                replaced |= index == 3318
                payload.extend(encode_uleb(len(new_body)))
                payload.extend(new_body)
                cursor = body_start + old_size
        output.append(section_id)
        output.extend(encode_uleb(len(payload)))
        output.extend(payload)
        offset = end
    if not replaced:
        raise ValueError("Harness search function was not found")
    return bytes(output)


base = (tmp / "base.wasm").read_bytes()
epw = (root / "vendor/clients/stable-galmuri.epw").read_bytes()
program_offset, compressed_size = struct.unpack_from("<II", epw, 228)
patched = lzma.decompress(epw[program_offset:program_offset + compressed_size])
harness = (tmp / "harness.wasm").read_bytes()
# The earlier chat-head patch inserts 431 bytes before this method. These
# offsets also have independent hash checks in tests/client-font.test.ts.
for name, wasm, shift in [("before", base, 0), ("after", patched, 431)]:
    local_declarations = wasm[0x337B1B + shift:0x337B52 + shift]
    search = wasm[0x337E1B + shift:0x337EA4 + shift]
    # Initialize the manager and target locals, execute the exact shipped
    # instructions, then return the boolean result stored in local 5.
    body = (
        local_declarations + bytes.fromhex("20 00 21 03 20 01 21 0b")
        + search + bytes.fromhex("20 05 0b")
    )
    (tmp / f"{name}-harness.wasm").write_bytes(replace_search_body(harness, body))

subprocess.run(["node", "--input-type=module", "-", str(tmp)], input=r"""
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const before = (await WebAssembly.instantiate(fs.readFileSync(path.join(dir, 'before-harness.wasm')))).instance.exports;
const after = (await WebAssembly.instantiate(fs.readFileSync(path.join(dir, 'after-harness.wasm')))).instance.exports;
let cases = 0;
for (let size = 0; size <= 100; size++) {
  for (let match = -1; match <= size; match++) {
    const expected = match >= 0 && match < size ? 1 : 0;
    if (before.check(size, match) !== expected || after.check(size, match) !== expected) {
      throw new Error(`Queue search mismatch: size=${size}, match=${match}`);
    }
    if (after.lookups() !== 0) throw new Error('The patched loop still calls indexed get');
    cases++;
  }
}
before.check(100, -1);
after.check(100, -1);
console.log(JSON.stringify({ cases, indexedLookupsBefore: before.lookups(), indexedLookupsAfter: after.lookups() }));
""", text=True, check=True)
