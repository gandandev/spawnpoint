"""Opt-in food HUD probe for the pinned 26.2 client, after patch-client.py.

The published client stays unchanged. GAME_ASSETS_LOCAL=true enables this
experiment so its native render hook can be tested before a CDN release.
"""
from pathlib import Path
import hashlib
import importlib.util

spec = importlib.util.spec_from_file_location('client_patch', Path(__file__).with_name('patch-client.py'))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
u, uleb = client.u, client.uleb
FOOD_FUNCTION = 38284
FOOD_BODY_SHA256 = '544605fceb53e5f4c3f6acc815e00ed86ba38ea2be095b74e2f67a6e98718ca2'
CALLBACK = 176952
# All hooks run after TeaVM restores coroutine locals, on native render paths.
HEART_FUNCTION = 38283
ITEM_TOOLTIP_FUNCTION = 1796
TOOLTIP_FUNCTION = 10357
CALLBACKS = ('foodRendered', 'heartsRendered', 'foodHovered', 'tooltipRendered', 'guiWidth')
BODY_HASHES = {
    FOOD_FUNCTION: FOOD_BODY_SHA256,
    38283: 'edced02f0f78bd8d517c5330e19e147c050edc2e6a9e6121651cadd2e133e27d',
    1796: '5488f8b15681324899ac0779e69c3df994611e508092c4678d4c52c46ffc3b5e',
    10357: '81f54f5c5a33bf6afc3c5d4e641cba168d4a3fc2544fa2abf96a43e47ed12779',
}



def local(n): return b'\x20' + u(n)
def get(n): return b'\x23' + u(n)
def field(t, n): return b'\xfb\x02' + u(t) + u(n)
def cast(t): return b'\xfb\x17' + client.s(t)
def call(n): return b'\x10' + u(n)
def boxed(n): return local(n) + call(3)

def callback(offset, args):
    g = get(CALLBACK + offset)
    return g + b'\xd1\x04\x40\x05' + g + b''.join(args) + call({1: 5, 2: 16, 3: 8, 4: 33}[len(args)]) + b'\x1a\x0b'

def insert(body, anchor, code):
    if body.count(anchor) != 1:
        raise ValueError('Native hook boundary changed')
    return body.replace(anchor, anchor + code)

def patch_body(function, body):
    if function == FOOD_FUNCTION:
        return insert(body, field(19228, 2) + b'\x21\x05', callback(0, [boxed(n) for n in (4, 3, 5)]))
    if function == HEART_FUNCTION:
        anchor = b'\x21\x0c\x02\x63' + client.s(19924)
        if body.count(anchor) != 1: raise ValueError('Heart renderer boundary changed')
        return body.replace(anchor, anchor[:2] + callback(1, [boxed(n) for n in (3, 4, 5, 8)]) + anchor[2:])
    if function == ITEM_TOOLTIP_FUNCTION:
        # ItemStack.components is the effective patched component map, including
        # custom item values. Its get implementation is synchronous and read-only.
        # Reuse a dead ref local (6) after the native tooltip-style lookup.
        component_map = local(5) + cast(18842) + field(18842, 5)
        def component(g):
            return component_map + get(g) + component_map + field(11, 0) + cast(21110) + field(21110, 301) + b'\x14' + u(25)
        code = callback(2, [b'\x41\x7f' + call(3), b'\x43\x00\x00\x00\x00' + call(31)])
        code += component(7569) + b'\xd1\x04\x40\x05'
        code += component(8101) + b'\x21\x06' + local(6) + b'\xfb\x14' + client.s(23080) + b'\x04\x40'
        code += callback(2, [local(6) + cast(23080) + field(23080, 2) + call(3),
                             local(6) + cast(23080) + field(23080, 3) + call(31)])
        code += b'\x0b\x0b'
        anchor = b'\x21\x04\x02\x63' + client.s(20378)
        if body.count(anchor) != 1: raise ValueError('Item tooltip boundary changed')
        return body.replace(anchor, b'\x21\x04' + code + anchor[2:])
    if function == TOOLTIP_FUNCTION:
        code = callback(4, [local(12) + field(20251, 22) + call(3)])
        code += callback(3, [boxed(n) for n in (14, 15, 7, 8)])
        return insert(body, local(13) + field(18408, 3) + b'\x21\x0f', code)
    raise ValueError(function)


def patch(data):
    out = bytearray(data[:8])
    p = 8
    changed = set()
    while p < len(data):
        tag = data[p]
        size, start = uleb(data, p + 1)
        end = start + size
        payload = data[start:end]
        if tag == 6:
            count, q = uleb(payload, 0)
            if count != CALLBACK:
                raise ValueError('Expected the pinned client after patch-client.py')
            payload = u(count + len(CALLBACKS)) + payload[q:] + b'\x6f\x01\xd0\x6f\x0b' * len(CALLBACKS)
        elif tag == 7:
            count, q = uleb(payload, 0)
            exports = bytearray(u(count + len(CALLBACKS)) + payload[q:])
            for offset, name in enumerate(CALLBACKS):
                key = ('spawnpoint.' + name).encode()
                exports += u(len(key)) + key + b'\x03' + u(CALLBACK + offset)
            payload = bytes(exports)
        elif tag == 10:
            count, q = uleb(payload, 0)
            code = bytearray(u(count))
            for index in range(count):
                length, q = uleb(payload, q)
                body = payload[q:q + length]
                q += length
                function = index + 98
                if function in BODY_HASHES:
                    if hashlib.sha256(body).hexdigest() != BODY_HASHES[function]:
                        raise ValueError(f'Native renderer {function} changed')
                    body = patch_body(function, body)
                    changed.add(function)
                code += u(len(body)) + body
            payload = bytes(code)
        out += client.section(tag, payload)
        p = end
    if changed != set(BODY_HASHES):
        raise ValueError('Food renderer missing')
    return bytes(out)


if __name__ == '__main__':
    target = client.SOURCE.with_name('classes-spawnpoint.wasm')
    target.write_bytes(patch(target.read_bytes()))
