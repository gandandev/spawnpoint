"""Expose the focused EditBox caret without changing its text or IME commits."""
from pathlib import Path
import hashlib
import importlib.util

spec = importlib.util.spec_from_file_location('client_patch', Path(__file__).with_name('patch-client.py'))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
u = client.u
FUNCTION = 4922
BODY_SHA256 = 'c7f2a93e3ec389b51a102304e261f96cacd986dad1c6798364e7c9bd9b6ff481'
CALLBACK = 176957  # After the screen and food HUD hooks.


def field(t, n): return b'\xfb\x02' + u(t) + u(n)
def local(n): return b'\x20' + u(n)


def patch_body(body):
    if hashlib.sha256(body).hexdigest() != BODY_SHA256:
        raise ValueError('IME: EditBox renderer changed')
    # At the native preedit overlay boundary all coroutine locals are restored.
    # 29 is cursorX; field 35 is textY; AbstractWidget field 12 is focused.
    anchor = local(0) + field(19396, 32) + b'\x21\x06'
    if body.count(anchor) != 1:
        raise ValueError('IME: preedit render boundary changed')
    callback = b'\x23' + u(CALLBACK)
    window = local(5) + b'\xfb\x17' + client.s(20378) + field(20378, 2) + field(20374, 14)
    args = [local(29), local(0) + field(19396, 35), window + field(20251, 22), window + field(20251, 23)]
    code = local(0) + b'\xfb\x04' + u(19396) + u(12) + b'\x04\x40'
    code += callback + b'\xd1\x04\x40\x05' + callback
    code += b''.join(arg + b'\x10\x03' for arg in args) + b'\x10\x21\x1a\x0b\x0b'
    return body.replace(anchor, code + anchor)


def patch(data):
    out = bytearray(data[:8])
    p = 8
    changed = False
    while p < len(data):
        tag = data[p]
        size, start = client.uleb(data, p + 1)
        end = start + size
        payload = data[start:end]
        if tag == 6:
            count, q = client.uleb(payload, 0)
            if count != CALLBACK:
                raise ValueError('IME: expected client after food HUD patch')
            payload = u(count + 1) + payload[q:] + b'\x6f\x01\xd0\x6f\x0b'
        elif tag == 7:
            count, q = client.uleb(payload, 0)
            key = b'spawnpoint.textInputRendered'
            payload = u(count + 1) + payload[q:] + u(len(key)) + key + b'\x03' + u(CALLBACK)
        elif tag == 10:
            count, q = client.uleb(payload, 0)
            code = bytearray(u(count))
            for index in range(count):
                length, q = client.uleb(payload, q)
                body = payload[q:q + length]
                q += length
                if index + 98 == FUNCTION:
                    body = patch_body(body)
                    changed = True
                code += u(len(body)) + body
            payload = bytes(code)
        out += client.section(tag, payload)
        p = end
    if not changed:
        raise ValueError('IME: EditBox renderer missing')
    return bytes(out)


if __name__ == '__main__':
    target = client.SOURCE.with_name('classes-spawnpoint.wasm')
    target.write_bytes(patch(target.read_bytes()))
