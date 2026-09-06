#!/usr/bin/env python3
"""Verify the caller-local ChunkSectionLayer.values() cache patch.

The production patch replaces one direct call in LevelRenderer.prepareChunkRenders
with a read of the already initialized enum backing array. This verifier checks
the pinned Wasm body and call graph, validates the patched module, and exercises
the same read-only sharing rule in a small Wasm GC module.
"""

from __future__ import annotations

from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "work/minecraft-26/client-26.2/classes.wasm"
LEVEL_RENDERER = (
    ROOT
    / "work/minecraft-26/source-work/vanilla-26.2/net/minecraft/client/renderer/LevelRenderer.java"
)
NATIVE_MATH = ROOT / "experiments/minecraft-26/native-math.py"
PATCH_CLIENT = ROOT / "experiments/minecraft-26/patch-client.py"

EXPECTED_PATCH = {
    "SECTION_LAYER_CACHE_FUNCTION": 37669,
    "SECTION_LAYER_CACHE_BODY_SHA256": "d425aa32f9201d4d6f47469e8da996098dcdc78b8e308c01bfd7a6b7df575935",
    "SECTION_LAYER_CACHE_OFFSET": 0x1420,
    "SECTION_LAYER_CACHE_BEFORE": bytes.fromhex("10 eb a8 02"),
    "SECTION_LAYER_CACHE_AFTER": bytes.fromhex("23 c3 71 01"),
}
IMPORT_COUNT = 98
VALUES_INDEX = 37995
BACKING_GLOBAL = 14531


def uleb(value: int) -> bytes:
    result = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        result.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(result)


def read_uleb(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7


def code_bodies(module: bytes) -> list[tuple[int, int]]:
    offset = 8
    while offset < len(module):
        section_id = module[offset]
        section_size, payload_start = read_uleb(module, offset + 1)
        payload_end = payload_start + section_size
        if section_id == 10:
            count, cursor = read_uleb(module, payload_start)
            bodies = []
            for _ in range(count):
                body_size, body_start = read_uleb(module, cursor)
                body_end = body_start + body_size
                bodies.append((body_start, body_end))
                cursor = body_end
            if cursor != payload_end:
                raise ValueError("Code section length did not match its function bodies")
            return bodies
        offset = payload_end
    raise ValueError("Wasm module has no code section")


def function_exports(module: bytes) -> list[int]:
    offset = 8
    while offset < len(module):
        section_id = module[offset]
        section_size, payload_start = read_uleb(module, offset + 1)
        payload_end = payload_start + section_size
        if section_id == 7:
            count, cursor = read_uleb(module, payload_start)
            result = []
            for _ in range(count):
                name_size, cursor = read_uleb(module, cursor)
                cursor += name_size
                kind = module[cursor]
                cursor += 1
                index, cursor = read_uleb(module, cursor)
                if kind == 0:
                    result.append(index)
            if cursor != payload_end:
                raise ValueError("Export section length did not match its entries")
            return result
        offset = payload_end
    return []


def element_function_indexes(module: bytes) -> list[int]:
    """Read the pinned module's single declarative funcidx element segment."""
    offset = 8
    while offset < len(module):
        section_id = module[offset]
        section_size, payload_start = read_uleb(module, offset + 1)
        payload_end = payload_start + section_size
        if section_id == 9:
            segment_count, cursor = read_uleb(module, payload_start)
            if segment_count != 1:
                raise ValueError("Enum cache: element segment layout changed")
            flags, cursor = read_uleb(module, cursor)
            if flags != 3 or module[cursor] != 0:
                raise ValueError("Enum cache: expected a declarative funcref segment")
            cursor += 1
            count, cursor = read_uleb(module, cursor)
            indexes = []
            for _ in range(count):
                index, cursor = read_uleb(module, cursor)
                indexes.append(index)
            if cursor != payload_end:
                raise ValueError("Element section length did not match its entries")
            return indexes
        offset = payload_end
    return []


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Required tool is missing: {name}")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"Could not load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_source_shape() -> bool:
    if not LEVEL_RENDERER.exists():
        return False
    source = LEVEL_RENDERER.read_text()
    start = source.index("public ChunkSectionsToRender prepareChunkRenders")
    end = source.index("\n   private ", start)
    method = source[start:end]
    loop = "for (ChunkSectionLayer layer : ChunkSectionLayer.values())"
    if method.count(loop) != 2:
        raise ValueError("LevelRenderer layer loops changed")
    if "ChunkSectionLayer.values()[" in method:
        raise ValueError("LevelRenderer mutates or indexes the returned values array")
    return True


# In the pinned original WAT, function 37669 first runs global 5434 with
# call_ref 0, then reads global 14531 for the outer layer loop. Only later,
# inside the visible-section loop after uboIndex becomes -1, it calls function
# 37995 for the inner layer loop. The first access dominates the patched access,
# so the class initializer has completed. The extracted 26.2 Java above uses
# both results only as enhanced-for inputs and never exposes or mutates them.


GC_WAT = """(module
  (type $items (array (mut i32)))
  (type $wrapper (struct (field (ref $items))))
  (global $backing (mut (ref null $wrapper)) (ref.null $wrapper))
  (func $make (result (ref $wrapper))
    i32.const 3
    i32.const 5
    i32.const 7
    array.new_fixed $items 3
    struct.new $wrapper)
  (func $start
    call $make
    global.set $backing)
  (start $start)
  (func $cached (result (ref $wrapper))
    global.get $backing
    ref.as_non_null)
  (func $sum (param $wrapper (ref $wrapper)) (result i32)
    local.get $wrapper
    struct.get $wrapper 0
    i32.const 0
    array.get $items
    local.get $wrapper
    struct.get $wrapper 0
    i32.const 1
    array.get $items
    i32.add
    local.get $wrapper
    struct.get $wrapper 0
    i32.const 2
    array.get $items
    i32.add)
  (func (export "freshSum") (result i32)
    call $make
    call $sum)
  (func (export "cachedSum") (result i32)
    call $cached
    call $sum)
  (func (export "freshSame") (result i32)
    call $make
    call $make
    ref.eq)
  (func (export "cachedSame") (result i32)
    call $cached
    call $cached
    ref.eq))
"""


def main() -> None:
    require_tool("wasm-tools")
    require_tool("node")
    original = CLIENT.read_bytes()
    native_math = load_module("spawnpoint_native_math", NATIVE_MATH)
    patch_client = load_module("spawnpoint_patch_client", PATCH_CLIENT)
    for name, expected in EXPECTED_PATCH.items():
        if getattr(patch_client, name) != expected:
            raise ValueError(f"Enum cache: production patch constant changed: {name}")
    caller_index = patch_client.SECTION_LAYER_CACHE_FUNCTION
    caller_body_sha256 = patch_client.SECTION_LAYER_CACHE_BODY_SHA256
    caller_patch_offset = patch_client.SECTION_LAYER_CACHE_OFFSET
    call_values = patch_client.SECTION_LAYER_CACHE_BEFORE
    get_backing = patch_client.SECTION_LAYER_CACHE_AFTER
    expected_input_sha = json.loads(native_math.MANIFEST.read_text())["client"]["sha256"]
    if hashlib.sha256(original).hexdigest() != expected_input_sha:
        raise ValueError("Enum cache: client input changed")

    bodies = code_bodies(original)
    caller_ordinal = caller_index - IMPORT_COUNT
    caller_start, caller_end = bodies[caller_ordinal]
    caller = original[caller_start:caller_end]
    if hashlib.sha256(caller).hexdigest() != caller_body_sha256:
        raise ValueError("Enum cache: caller body changed")

    if len(call_values) != len(get_backing) or len(call_values) != 4:
        raise ValueError("Enum cache: patch no longer preserves instruction length")
    if caller[caller_patch_offset : caller_patch_offset + 4] != call_values:
        raise ValueError("Enum cache: caller instruction changed")
    patched_caller = patch_client.patch_section_layer_cache(caller)
    if patched_caller[caller_patch_offset : caller_patch_offset + 4] != get_backing:
        raise ValueError("Enum cache: production helper wrote the wrong instruction")
    for invalid in (patched_caller, bytes([caller[0] ^ 1]) + caller[1:]):
        try:
            patch_client.patch_section_layer_cache(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("Enum cache: stale or duplicate caller patch accepted")

    direct_calls = []
    for ordinal, (body_start, body_end) in enumerate(bodies):
        body = original[body_start:body_end]
        cursor = 0
        while True:
            cursor = body.find(call_values, cursor)
            if cursor < 0:
                break
            direct_calls.append((ordinal + IMPORT_COUNT, cursor))
            cursor += len(call_values)
    if direct_calls != [(caller_index, caller_patch_offset)]:
        raise ValueError(f"Enum cache: values() call graph changed: {direct_calls}")
    if (b"\xd2" + uleb(VALUES_INDEX)) in original:
        raise ValueError("Enum cache: values() gained a ref.func reference")
    if VALUES_INDEX in function_exports(original):
        raise ValueError("Enum cache: values() gained an export")
    if VALUES_INDEX in element_function_indexes(original):
        raise ValueError("Enum cache: values() gained an element-table reference")
    source_verified = verify_source_shape()

    baseline = native_math.patch(original, "client")
    patched = bytearray(baseline)
    absolute_offset = caller_start + caller_patch_offset
    if patched[absolute_offset : absolute_offset + 4] != call_values:
        raise ValueError("Enum cache: native Math changed the caller")
    patched[caller_start:caller_end] = patch_client.patch_section_layer_cache(
        bytes(patched[caller_start:caller_end])
    )
    restored = bytearray(patched)
    restored[absolute_offset : absolute_offset + 4] = call_values
    if restored != baseline:
        raise ValueError("Enum cache: unrelated production bytes changed")

    with tempfile.TemporaryDirectory(prefix="spawnpoint-enum-cache-") as directory:
        scratch = Path(directory)
        production = scratch / "client-patched.wasm"
        # Validate the complete production patch path, including native Math and
        # the existing screen and relay adaptations.
        production.write_bytes(patch_client.patch(original))
        subprocess.run(
            ["wasm-tools", "validate", "--features", "all", str(production)], check=True
        )
        subprocess.run(
            ["node", "--input-type=module", "-", str(production)],
            input="""
import fs from 'node:fs';
await WebAssembly.compile(fs.readFileSync(process.argv[2]), {builtins:['js-string']});
""",
            text=True,
            check=True,
        )

        gc_wat = scratch / "enum-cache.wat"
        gc_wasm = scratch / "enum-cache.wasm"
        gc_wat.write_text(GC_WAT)
        subprocess.run(["wasm-tools", "parse", str(gc_wat), "-o", str(gc_wasm)], check=True)
        subprocess.run(
            ["wasm-tools", "validate", "--features", "all", str(gc_wasm)], check=True
        )
        completed = subprocess.run(
            ["node", "--input-type=module", "-", str(gc_wasm)],
            input="""
import fs from 'node:fs';
const {instance} = await WebAssembly.instantiate(fs.readFileSync(process.argv[2]));
const e = instance.exports;
if (e.freshSum() !== 15 || e.cachedSum() !== 15) throw new Error('read parity failed');
if (e.freshSame() !== 0 || e.cachedSame() !== 1) throw new Error('identity test failed');
""",
            text=True,
            check=True,
        )

    print(
        json.dumps(
            {
                "callerFunction": caller_index,
                "valuesFunction": VALUES_INDEX,
                "backingGlobal": BACKING_GLOBAL,
                "bodySha256": caller_body_sha256,
                "bodyOffset": hex(caller_patch_offset),
                "absoluteOffset": hex(absolute_offset),
                "replacement": f"{call_values.hex(' ')} -> {get_backing.hex(' ')}",
                "directCallers": direct_calls,
                "refFuncReferences": 0,
                "exports": 0,
                "elementTableReferences": 0,
                "sourceReadOnlyVerified": source_verified,
                "sourceLayerLoops": 2 if source_verified else None,
                "staleAndDuplicateRejected": True,
                "productionValidated": True,
                "compiledByV8": True,
                "wasmGcReadParity": True,
                "wasmGcSharedIdentity": True,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
