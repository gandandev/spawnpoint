#!/usr/bin/env python3
"""Compare TeaVM Math imports with equal-size native Wasm replacements.

The benchmark times only a synthetic Wasm kernel. It is not a whole-client or
FPS benchmark. Temporary WAT, Wasm, and JavaScript inputs are removed on exit.
"""

from __future__ import annotations

from pathlib import Path
import importlib.util
import json
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
NATIVE_MATH_HELPER = ROOT / "experiments/minecraft-26/native-math.py"


def load_native_math_opcodes() -> dict[str, int]:
    spec = importlib.util.spec_from_file_location("spawnpoint_native_math", NATIVE_MATH_HELPER)
    if spec is None or spec.loader is None:
        raise ValueError(f"Could not load native Math helper: {NATIVE_MATH_HELPER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    opcodes = module.OPCODES
    if set(opcodes) != {"floor", "ceil", "sqrt"} or not all(
        isinstance(opcode, int) and 0 <= opcode <= 0xFF for opcode in opcodes.values()
    ):
        raise ValueError(f"Invalid native Math opcode map: {opcodes!r}")
    return opcodes


OPCODES = load_native_math_opcodes()
MATH_IMPORTS = [
    "floor",
    "unused1",
    "unused2",
    "unused3",
    "ceil",
    "unused5",
    "unused6",
    "unused7",
    "unused8",
    "unused9",
    "unused10",
    "unused11",
    "sqrt",
]

# Every replacement is two bytes, like the imported call it replaces. The nop
# keeps all following instructions and byte offsets in the harness unchanged.
REPLACEMENTS = {
    bytes.fromhex("10 00"): bytes([OPCODES["floor"], 0x01]),
    bytes.fromhex("10 04"): bytes([OPCODES["ceil"], 0x01]),
    bytes.fromhex("10 0c"): bytes([OPCODES["sqrt"], 0x01]),
}


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"Required tool is missing: {name}")


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
            bodies: list[tuple[int, int]] = []
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


def patch_math_calls(module: bytes) -> tuple[bytes, dict[str, int]]:
    patched = bytearray(module)
    counts: dict[str, int] = {}
    for original, native in REPLACEMENTS.items():
        count = 0
        for body_start, body_end in code_bodies(module):
            cursor = body_start
            while True:
                cursor = module.find(original, cursor, body_end)
                if cursor < 0:
                    break
                patched[cursor : cursor + len(original)] = native
                count += 1
                cursor += len(original)
        counts[original.hex(" ")] = count
    if set(counts.values()) != {2}:
        raise ValueError(f"Expected two call sites for each Math import, got {counts}")
    if len(patched) != len(module):
        raise ValueError("Native Math patch changed the module length")
    return bytes(patched), counts


def make_wat() -> str:
    imports = "\n".join(
        f'  (import "teavmMath" "{name}" (func ${name} (param f64) (result f64)))'
        for name in MATH_IMPORTS
    )
    return f"""(module
{imports}
  (func (export "floor") (param f64) (result f64)
    local.get 0
    call $floor)
  (func (export "ceil") (param f64) (result f64)
    local.get 0
    call $ceil)
  (func (export "sqrt") (param f64) (result f64)
    local.get 0
    call $sqrt)
  (func (export "mixed") (param $count i32) (param $seed f64) (result f64)
    (local $index i32)
    (local $value f64)
    (local $sum f64)
    local.get $seed
    local.set $value
    block $done
      loop $next
        local.get $index
        local.get $count
        i32.ge_u
        br_if $done

        local.get $value
        f64.const 1.0000000000000002
        f64.mul
        local.get $index
        i32.const 1023
        i32.and
        f64.convert_i32_u
        f64.const 0.0009765625
        f64.mul
        f64.add
        local.tee $value

        call $floor
        local.get $value
        call $ceil
        f64.add
        local.get $value
        f64.abs
        f64.const 1
        f64.add
        call $sqrt
        f64.add
        local.get $sum
        f64.add
        local.set $sum

        local.get $value
        f64.const 1024
        f64.ge
        if
          local.get $value
          f64.const 1024
          f64.sub
          local.set $value
        end
        local.get $index
        i32.const 1
        i32.add
        local.set $index
        br $next
      end
    end
    local.get $sum)
)"""


NODE_HARNESS = r"""
import fs from 'node:fs';
import path from 'node:path';

const directory = process.argv[2];
const originalBytes = fs.readFileSync(path.join(directory, 'math-import.wasm'));
const nativeBytes = fs.readFileSync(path.join(directory, 'math-native.wasm'));
const unused = value => value;
const teavmMath = {
  floor: Math.floor,
  unused1: unused,
  unused2: unused,
  unused3: unused,
  ceil: Math.ceil,
  unused5: unused,
  unused6: unused,
  unused7: unused,
  unused8: unused,
  unused9: unused,
  unused10: unused,
  unused11: unused,
  sqrt: Math.sqrt,
};
const imports = { teavmMath };
const original = (await WebAssembly.instantiate(originalBytes, imports)).instance.exports;
const native = (await WebAssembly.instantiate(nativeBytes, imports)).instance.exports;

const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
const fromBits = bits => {
  view.setBigUint64(0, bits, true);
  return view.getFloat64(0, true);
};
const toBits = value => {
  view.setFloat64(0, value, true);
  return view.getBigUint64(0, true);
};
const bitsHex = value => `0x${toBits(value).toString(16).padStart(16, '0')}`;
const sameF64 = (left, right) =>
  Number.isNaN(left) && Number.isNaN(right) || Object.is(left, right);

function nextUp(value) {
  if (Number.isNaN(value) || value === Infinity) return value;
  if (Object.is(value, -0)) return Number.MIN_VALUE;
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  bits += value >= 0 ? 1n : -1n;
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

function nextDown(value) {
  if (Number.isNaN(value) || value === -Infinity) return value;
  if (Object.is(value, 0)) return -Number.MIN_VALUE;
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  bits += value > 0 ? -1n : 1n;
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

const adjacentBases = [
  -Math.pow(2, 53), -Math.pow(2, 52), -1, 0, 1,
  Math.pow(2, 52), Math.pow(2, 53),
];
const cases = [
  0, -0, Infinity, -Infinity,
  Number.MIN_VALUE, -Number.MIN_VALUE,
  Math.pow(2, -1022), -Math.pow(2, -1022),
  nextDown(Math.pow(2, -1022)), -nextDown(Math.pow(2, -1022)),
  Number.MAX_VALUE, -Number.MAX_VALUE,
  ...adjacentBases.flatMap(value => [nextDown(value), value, nextUp(value)]),
  fromBits(0x7ff8000000000001n),
  fromBits(0xfff8000000000001n),
  fromBits(0x7ff0000000000001n),
  fromBits(0xffffffffffffffffn),
];

let randomState = 0x6a09e667f3bcc909n;
const mask64 = (1n << 64n) - 1n;
function randomBits() {
  randomState ^= randomState >> 12n;
  randomState ^= randomState << 25n & mask64;
  randomState ^= randomState >> 27n;
  randomState &= mask64;
  return randomState * 0x2545f4914f6cdd1dn & mask64;
}
const randomCases = 50000;
for (let index = 0; index < randomCases; index++) cases.push(fromBits(randomBits()));

const operations = ['floor', 'ceil', 'sqrt'];
let comparisons = 0;
for (const input of cases) {
  for (const operation of operations) {
    const importedResult = original[operation](input);
    const nativeResult = native[operation](input);
    if (!sameF64(importedResult, nativeResult)) {
      throw new Error(
        `${operation} mismatch for ${bitsHex(input)}: ` +
        `import=${bitsHex(importedResult)}, native=${bitsHex(nativeResult)}`
      );
    }
    comparisons++;
  }
}

const benchmarkIterations = 5000000;
const warmupIterations = 1000000;
const seed = 0.125;
function runKernel(exports) {
  const start = process.hrtime.bigint();
  const result = exports.mixed(benchmarkIterations, seed);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { elapsedMs, result };
}
function assertKernelParity(left, right) {
  if (!sameF64(left, right)) {
    throw new Error(`Mixed-kernel result mismatch: ${bitsHex(left)} != ${bitsHex(right)}`);
  }
}

// Use the same ABBA order during warmup and measurement to balance tiering and
// thermal drift between the imported and native variants.
for (let block = 0; block < 3; block++) {
  const results = [
    original.mixed(warmupIterations, seed),
    native.mixed(warmupIterations, seed),
    native.mixed(warmupIterations, seed),
    original.mixed(warmupIterations, seed),
  ];
  assertKernelParity(results[0], results[1]);
  assertKernelParity(results[2], results[3]);
}

const importedTimes = [];
const nativeTimes = [];
for (let block = 0; block < 7; block++) {
  const a1 = runKernel(original);
  const b1 = runKernel(native);
  const b2 = runKernel(native);
  const a2 = runKernel(original);
  assertKernelParity(a1.result, b1.result);
  assertKernelParity(b2.result, a2.result);
  importedTimes.push(a1.elapsedMs, a2.elapsedMs);
  nativeTimes.push(b1.elapsedMs, b2.elapsedMs);
}
const median = values => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const importedMedianMs = median(importedTimes);
const nativeMedianMs = median(nativeTimes);

console.log(JSON.stringify({
  parity: {
    inputs: cases.length,
    randomBitPatterns: randomCases,
    operations,
    comparisons,
    rule: 'Object.is for non-NaN values; all NaN payloads are equivalent',
  },
  benchmark: {
    scope: 'kernel-only synthetic Wasm loop; excludes compile and instantiate time',
    order: 'ABBA',
    warmupBlocks: 3,
    warmupIterationsPerSample: warmupIterations,
    measuredBlocks: 7,
    samplesPerVariant: importedTimes.length,
    iterationsPerSample: benchmarkIterations,
    operationsPerIteration: operations.length,
    importedMedianMs,
    nativeMedianMs,
    speedup: importedMedianMs / nativeMedianMs,
  },
}));
"""


def main() -> None:
    require_tool("wasm-tools")
    require_tool("node")
    with tempfile.TemporaryDirectory(prefix="spawnpoint-wasm-math-") as directory:
        scratch = Path(directory)
        wat_path = scratch / "math-import.wat"
        original_path = scratch / "math-import.wasm"
        native_path = scratch / "math-native.wasm"
        wat_path.write_text(make_wat())
        subprocess.run(
            ["wasm-tools", "parse", str(wat_path), "-o", str(original_path)],
            check=True,
        )

        original = original_path.read_bytes()
        original_bodies = code_bodies(original)
        expected_original = [
            bytes.fromhex("00 20 00 10 00 0b"),
            bytes.fromhex("00 20 00 10 04 0b"),
            bytes.fromhex("00 20 00 10 0c 0b"),
        ]
        if [original[start:end] for start, end in original_bodies[:3]] != expected_original:
            raise ValueError("wasm-tools changed the expected import wrapper byte shapes")

        native, counts = patch_math_calls(original)
        native_path.write_bytes(native)
        native_bodies = code_bodies(native)
        expected_native = [
            bytes.fromhex("00 20 00") + bytes([OPCODES["floor"], 0x01, 0x0B]),
            bytes.fromhex("00 20 00") + bytes([OPCODES["ceil"], 0x01, 0x0B]),
            bytes.fromhex("00 20 00") + bytes([OPCODES["sqrt"], 0x01, 0x0B]),
        ]
        if [native[start:end] for start, end in native_bodies[:3]] != expected_native:
            raise ValueError("Native Math replacement bytes did not match the expected shapes")

        for path in (original_path, native_path):
            subprocess.run(
                ["wasm-tools", "validate", "--features", "all", str(path)],
                check=True,
            )

        completed = subprocess.run(
            ["node", "--input-type=module", "-", str(scratch)],
            input=NODE_HARNESS,
            text=True,
            check=True,
            capture_output=True,
        )
        result = json.loads(completed.stdout)
        result["patch"] = {
            "opcodeSource": str(NATIVE_MATH_HELPER.relative_to(ROOT)),
            "moduleLengthUnchanged": len(original) == len(native),
            "moduleBytes": len(original),
            "callSiteCounts": counts,
            "fragments": {
                "floor": f"call 0 (10 00) -> f64.floor; nop ({OPCODES['floor']:02x} 01)",
                "ceil": f"call 4 (10 04) -> f64.ceil; nop ({OPCODES['ceil']:02x} 01)",
                "sqrt": f"call 12 (10 0c) -> f64.sqrt; nop ({OPCODES['sqrt']:02x} 01)",
            },
        }
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
