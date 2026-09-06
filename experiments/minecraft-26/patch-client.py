"""Hash-guarded adaptations of the pinned 26.2 TeaVM client."""
from pathlib import Path
import hashlib
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'work/minecraft-26/client-26.2/classes.wasm'

def uleb(data,p):
    value=shift=0
    while True:
        byte=data[p];p+=1;value|=(byte&127)<<shift;shift+=7
        if byte<128:return value,p

def u(value):
    out=bytearray()
    while True:
        byte=value&127;value>>=7;out.append(byte|128 if value else byte)
        if not value:return bytes(out)

def s(value):
    out=bytearray()
    while True:
        byte=value&127;value>>=7
        done=(value==0 and not byte&64) or (value==-1 and byte&64)
        out.append(byte if done else byte|128)
        if done:return bytes(out)

def section(tag,payload):return bytes([tag])+u(len(payload))+payload

def patch(data):
    # All indices below belong only to the artifact verified by build-26.2.mjs.
    callback=176951
    get=lambda n:b'\x23'+u(n)
    struct_get=lambda t,f:b'\xfb\x02'+u(t)+u(f)
    # A profile wrapper already contains its fully initialized destination.
    unwrap=(b'\x20\x01\xfb\x14'+s(24003)+b'\x04\x40\x20\x01\xfb\x16'+s(24003)+struct_get(24003,19)+b'\x21\x01\x0b')
    # Deliver the real Java screen class name to the existing portal bridge.
    name=(b'\x20\x01\xd1\x04\x6f\xd0\x6f\x05\x20\x01'+struct_get(20319,0)+struct_get(24,0)+struct_get(15,19)+struct_get(22,2)+struct_get(21,2)+b'\x41\x00\x20\x01'+struct_get(20319,0)+struct_get(24,0)+struct_get(15,19)+struct_get(22,2)+struct_get(21,2)+b'\xfb\x0f\x10'+u(72)+b'\x0b')
    hook=get(callback)+b'\xd1\x04\x40\x05'+unwrap+get(callback)+name+b'\x10\x05\x1a\x0b'
    out=bytearray(data[:8]);p=8;changed=False
    while p<len(data):
        tag=data[p];size,start=uleb(data,p+1);end=start+size;payload=data[start:end]
        if tag==6:
            count,q=uleb(payload,0)
            if count!=callback:raise ValueError('Global index changed')
            payload=u(count+1)+payload[q:]+b'\x6f\x01\xd0\x6f\x0b'
        elif tag==7:
            count,q=uleb(payload,0);key=b'spawnpoint.screenChanged'
            payload=u(count+1)+payload[q:]+u(len(key))+key+b'\x03'+u(callback)
        elif tag==10:
            count,q=uleb(payload,0);code=bytearray(u(count))
            for index in range(count):
                length,q=uleb(payload,q);body=payload[q:q+length];q+=length
                if index+98==242:
                    digest=hashlib.sha256(body).hexdigest()
                    if digest!=SCREEN_BODY_SHA256:raise ValueError('Screen function changed: '+digest)
                    anchor=b'\x05\x41\x00\x21\x13\x0b\x02\x40'
                    if body.count(anchor)!=1:raise ValueError('Screen resume boundary changed')
                    body=body.replace(anchor,anchor[:-2]+hook+anchor[-2:]);changed=True
                if index+98==57541:
                    # The upstream relay link is an absolute-positioned widget, not a menu row.
                    for field in (8,9):
                        anchor=b'\x20\x01\xfb\x17'+s(19393)+b'\x41\x01\xfb\x05'+u(19393)+u(field)
                        if body.count(anchor)!=2:raise ValueError('Relay widget flags changed')
                        body=body.replace(anchor,anchor.replace(b'\x41\x01',b'\x41\x00'),1)
                code+=u(len(body))+body
            payload=bytes(code)
        out+=section(tag,payload);p=end
    if not changed:raise ValueError('Screen function missing')
    return bytes(out)

SCREEN_BODY_SHA256='2a8df673634c960dd9786b3833e594cd522e6940ef01f89ef2960ce1119b92fe'
if __name__=='__main__':
    result=patch(SOURCE.read_bytes())
    (SOURCE.parent/'classes-spawnpoint.wasm').write_bytes(result)
