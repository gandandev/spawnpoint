#!/usr/bin/env python3
"""Verify the native-math manifest against decoded original Wasm instructions.

Requires the pinned local 26.2 artifacts, wasm-tools, and Node. Decode the whole
original instruction stream so constants/data containing call-like bytes cannot
be mistaken for call sites. Also verify fail-closed guards and compiled outputs.
"""
from pathlib import Path
import importlib.util
import json
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_math', ROOT / 'experiments/minecraft-26/native-math.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
manifest = json.loads(native.MANIFEST.read_text())

with tempfile.TemporaryDirectory(prefix='spawnpoint-native-math-') as directory:
    scratch = Path(directory)
    # The mesh input stays compressed and unmodified in the normal build tree.
    subprocess.run(['node', '--input-type=module', '-', str(ROOT), str(scratch)], input='''
import fs from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
fs.writeFileSync(path.join(process.argv[3], 'mesh.wasm'), brotliDecompressSync(
  fs.readFileSync(path.join(process.argv[2], 'work/minecraft-26/client-26.2/mesh-worker.wasm.br'))));
''', text=True, check=True)
    for name, source in [('client', ROOT / 'work/minecraft-26/client-26.2/classes.wasm'), ('mesh', scratch / 'mesh.wasm')]:
        entry = manifest[name]
        declared = {int(offset, 16): operation['import']
                    for operation in entry['operations'].values() for offset in operation['offsets']}
        imports = {operation['import']: operation_name for operation_name, operation in entry['operations'].items()}
        decoded, found_imports = {}, {}
        with subprocess.Popen(['wasm-tools', 'dump', str(source)], stdout=subprocess.PIPE, text=True) as process:
            for line in process.stdout:
                match = re.search(r'import \[func (\d+)\].*module: "teavmMath", name: "(floor|ceil|sqrt)"', line)
                if match:
                    found_imports[int(match[1])] = match[2]
                match = re.match(r'\s*(0x[0-9a-f]+).*\| call function_index:(\d+)\s*$', line)
                if match and int(match[2]) in imports:
                    decoded[int(match[1], 16)] = int(match[2])
            if process.wait() != 0:
                raise RuntimeError(f'Could not decode {name}')
        assert found_imports == imports, (name, found_imports, imports)
        assert decoded == declared, f'{name}: manifest must cover exactly the decoded Math calls'
        before = source.read_bytes()
        after = native.patch(before, name)
        assert len(before) == len(after)
        # Every changed byte belongs to one of the two-byte decoded calls.
        restored = bytearray(after)
        for offset in declared:
            restored[offset:offset + 2] = before[offset:offset + 2]
        assert restored == before, f'{name}: unrelated bytes changed'
        for invalid in (after, bytes([before[0] ^ 1]) + before[1:]):
            try:
                native.patch(invalid, name)
            except ValueError:
                pass
            else:
                raise AssertionError(f'{name}: stale or double patch accepted')
        output = scratch / f'{name}-patched.wasm'
        output.write_bytes(after)
        subprocess.run(['wasm-tools', 'validate', '--features', 'all', str(output)], check=True)
        subprocess.run(['node', '--input-type=module', '-', str(output)], input='''
import fs from 'node:fs';
await WebAssembly.compile(fs.readFileSync(process.argv[2]), {builtins:['js-string']});
''', text=True, check=True)
        print(json.dumps({'module': name, 'decodedCallSites': len(decoded), 'bytes': len(after),
                          'unchangedLayout': True, 'staleAndDuplicateRejected': True,
                          'compiledByV8': True}), flush=True)
