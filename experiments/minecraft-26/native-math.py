"""Lower pinned TeaVM Math imports to equivalent Wasm instructions.

Offsets are instruction boundaries decoded by wasm-tools, not byte-pattern
matches. Keep the two-byte instruction footprint (native op + nop), preserving
function indices, body lengths, and all metadata. No approximate arithmetic,
render-distance changes, or JavaScript callback is introduced.
"""
from pathlib import Path
import hashlib
import json

MANIFEST = Path(__file__).with_name('native-math.json')
OPCODES = {'floor': 0x9c, 'ceil': 0x9b, 'sqrt': 0x9f}


def patch(data, module='client'):
    spec = json.loads(MANIFEST.read_text())[module]
    if hashlib.sha256(data).hexdigest() != spec['sha256']:
        raise ValueError(f'Native math: {module} input changed or already patched')
    result = bytearray(data)
    seen = set()
    for name, entry in spec['operations'].items():
        index = entry['import']
        if not 0 <= index < 128:
            raise ValueError('Native math requires a two-byte call instruction')
        for value in entry['offsets']:
            offset = int(value, 16)
            if offset in seen or data[offset:offset + 2] != bytes([0x10, index]):
                raise ValueError(f'Native math: invalid {name} instruction at {value}')
            seen.update((offset, offset + 1))
            result[offset:offset + 2] = bytes([OPCODES[name], 0x01])
    if hashlib.sha256(result).hexdigest() != spec['patchedSha256']:
        raise ValueError(f'Native math: {module} output does not match decoded patch')
    return bytes(result)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('module', choices=('client', 'mesh'))
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_bytes(patch(args.input.read_bytes(), args.module))
