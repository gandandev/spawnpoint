"""Check the opt-in 26.2 food hook without a source rebuild or server."""
from pathlib import Path
import importlib.util
import hashlib
import argparse
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('food_patch', ROOT / 'experiments/minecraft-26/patch-food-hud.py')
food = importlib.util.module_from_spec(spec)
spec.loader.exec_module(food)
base = food.client.patch(food.client.SOURCE.read_bytes())
patched = food.patch(base)


def sections(data):
    result = []
    p = 8
    while p < len(data):
        tag = data[p]
        size, start = food.uleb(data, p + 1)
        result.append((tag, data[start:start + size]))
        p = start + size
    return result


def functions(payload):
    count, p = food.uleb(payload, 0)
    result = []
    for _ in range(count):
        size, p = food.uleb(payload, p)
        result.append(payload[p:p + size])
        p += size
    return result


before_sections, after_sections = sections(base), sections(patched)
assert [tag for tag, _ in before_sections] == [tag for tag, _ in after_sections]
assert [tag for (tag, a), (_, b) in zip(before_sections, after_sections) if a != b] == [6, 7, 10]
before, after = dict(before_sections), dict(after_sections)
a, b = functions(before[10]), functions(after[10])
assert len(a) == len(b)
assert [i + 98 for i, (x, y) in enumerate(zip(a, b)) if x != y] == sorted(food.BODY_HASHES)
for name in food.CALLBACKS:
    assert ('spawnpoint.' + name).encode() in after[7]
try:
    food.patch(patched)
    raise AssertionError('Double patch accepted')
except ValueError:
    pass
for function in food.BODY_HASHES:
    original = a[function - 98]
    broken = base.replace(original, original[:-1] + b'\x00', 1)
    try:
        food.patch(broken)
        raise AssertionError('Changed renderer accepted')
    except ValueError:
        pass
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check-built', action='store_true', help='Also compare the current local build to the verified hook')
args = parser.parse_args()
if args.check_built:
    assert patched == food.client.SOURCE.with_name('classes-spawnpoint.wasm').read_bytes()
with tempfile.TemporaryDirectory(prefix='spawnpoint-food-hud-') as directory:
    output = Path(directory) / 'food-hud.wasm'
    output.write_bytes(patched)
    subprocess.run(['wasm-tools', 'validate', '--features', 'all', str(output)], check=True)
    subprocess.run(['node', '--input-type=module', '-', str(output)], input="""
import fs from 'node:fs';
await WebAssembly.compile(fs.readFileSync(process.argv[2]), {builtins:['js-string']});
""", text=True, check=True)
print(f'Food hook verified: only functions {sorted(food.BODY_HASHES)} changed; stale and duplicate patches rejected; sha256={hashlib.sha256(patched).hexdigest()}')
