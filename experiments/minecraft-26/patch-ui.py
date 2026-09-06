"""Guarded GUI scale, reconnect arguments, and vanilla experience-font hooks."""
from pathlib import Path
import hashlib
import importlib.util
spec = importlib.util.spec_from_file_location('client', Path(__file__).with_name('patch-client.py'))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
u, s = client.u, client.s
BASE = 176958
TYPES = (20319, 20374, 24820, 19612, None, 26638)
HASHES = {2710: '50c0458ad5fcced8a997044b2484b9c675eb064cd173139e8848ffee0c075256',
          37962: 'a9bee6fb24d5aec315ba39f60bd8a63921d0734d302b202e2556745edff26bc7',
          5971: '9524481de185b72cf23d37bd451d8df42764db083a83d8568d476817806ea51d'}
def get(n): return b'\x23' + u(n)
def field(t,n): return b'\xfb\x02' + u(t) + u(n)
def patch(data):
    out=bytearray(data[:8]);p=8;changed=set()
    while p<len(data):
        tag=data[p];size,start=client.uleb(data,p+1);end=start+size;payload=data[start:end]
        if tag==6:
            count,q=client.uleb(payload,0)
            if count!=BASE: raise ValueError('UI patch requires the IME-patched client')
            extra=b''
            for t in TYPES:
                extra += b'\x7f\x01\x41\x00\x0b' if t is None else b'\x63'+s(t)+b'\x01\xd0'+s(t)+b'\x0b'
            payload=u(count+7)+payload[q:]+extra+b'\x6f\x01\xd0\x6f\x0b'
        elif tag==7:
            count,q=client.uleb(payload,0);extra=b''
            for i in range(6):
                key=('spawnpoint.connectArg'+str(i)).encode();extra+=u(len(key))+key+b'\x03'+u(BASE+i)
            key=b'spawnpoint.reconnect';extra+=u(len(key))+key+b'\x00'+u(2710)
            key=b'spawnpoint.experienceRendered';extra+=u(len(key))+key+b'\x03'+u(BASE+6)
            payload=u(count+8)+payload[q:]+extra
        elif tag==10:
            count,q=client.uleb(payload,0);code=bytearray(u(count))
            for i in range(count):
                length,q=client.uleb(payload,q);body=payload[q:q+length];q+=length;n=i+98
                if n in HASHES:
                    if hashlib.sha256(body).hexdigest()!=HASHES[n]:raise ValueError(f'UI function {n} changed')
                    changed.add(n)
                    if n==2710:
                        anchor=b'\x10\x6b\x21\x1f'
                        capture=b'\x20\x01\xd1\x04\x40\x05'+b''.join(b'\x20'+u(i)+b'\x24'+u(BASE+i) for i in range(6))+b'\x0b'
                        if body.count(anchor)!=1: raise ValueError('Connect entry changed')
                        body=body.replace(anchor,capture+anchor)
                    elif n==5971:
                        anchor=b'\x41'+s(240)
                        if body.count(anchor)!=1:raise ValueError('GUI minimum height changed')
                        body=body.replace(anchor,b'\x41'+s(180))
                    else:
                        # A synchronous browser callback replaces only the XP number.
                        anchor=b'\x10\x6b'
                        if body.count(anchor)!=1:raise ValueError('Experience entry changed')
                        window=b'\x20\x00'+field(20378,2)+field(20374,14)
                        args=b'\x20\x02\x10\x03'+window+field(20251,22)+b'\x10\x03'+window+field(20251,23)+b'\x10\x03'
                        callback=get(BASE+6)
                        hook=callback+b'\xd1\x04\x40\x05'+callback+args+b'\x10\x08\x10\x12\x04\x40\x0f\x0b\x0b'
                        body=body.replace(anchor,hook+anchor)
                code+=u(len(body))+body
            payload=bytes(code)
        out+=client.section(tag,payload);p=end
    if changed!=set(HASHES):raise ValueError('UI functions missing')
    return bytes(out)
if __name__=='__main__':
    target=client.SOURCE.with_name('classes-spawnpoint.wasm');target.write_bytes(patch(target.read_bytes()))
