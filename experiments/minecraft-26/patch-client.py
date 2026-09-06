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

def chat_skin_body():
    # Read the already downloaded multiplayer skin. Never fetch or allocate here.
    get=lambda t,f:b'\xfb\x02'+u(t)+u(f)
    cast=lambda t:b'\xfb\x17'+s(t)
    local=lambda n:b'\x20'+u(n)
    fallback=local(0)+cast(24884)+get(24884,3)+b'\x0f'
    # UUID, backing array, entry, entry UUID, skin, bucket index.
    b=b'\x06'+b''.join(b'\x01\x63'+s(t) for t in [18777,10,20780,18777,22710])+b'\x01\x7f'
    b+=b'\x23'+u(176952)+b'\xd1\x04\x40'+fallback+b'\x0b'
    b+=local(0)+cast(24884)+get(24884,2)+get(19224,2)+b'\x21\x01'
    b+=b'\x23'+u(176952)+get(19945,3)+cast(20660)+get(20660,5)+get(12,2)+b'\x21\x02'
    b+=b'\x02\x40\x03\x40'+local(6)+local(2)+b'\xfb\x0f\x4f\x0d\x01'
    b+=local(2)+local(6)+b'\xfb\x0b'+u(10)+cast(20780)+b'\x21\x03'
    b+=b'\x02\x40\x03\x40'+local(3)+b'\xd1\x0d\x01'
    b+=local(3)+get(20780,2)+b'\xfb\x14'+s(18777)+b'\x04\x40'
    b+=local(3)+get(20780,2)+cast(18777)+b'\x21\x04'
    b+=local(1)+get(18777,2)+local(4)+get(18777,2)+b'\x51'+local(1)+get(18777,3)+local(4)+get(18777,3)+b'\x51\x71\x04\x40'
    b+=local(3)+get(20780,3)+cast(27036)+get(27036,2)+b'\x22\x05\xd1\x04\x40\x05'+local(5)+b'\x0f\x0b\x0b\x0b'
    b+=local(3)+get(20780,5)+b'\x21\x03\x0c\x00\x0b\x0b'
    b+=local(6)+b'\x41\x01\x6a\x21\x06\x0c\x00\x0b\x0b'+fallback+b'\x0b'
    return b

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
        if tag==3:
            count,q=uleb(payload,0);payload=u(count+1)+payload[q:]+u(16)
        elif tag==6:
            count,q=uleb(payload,0)
            if count!=callback:raise ValueError('Global index changed')
            payload=u(count+2)+payload[q:]+b'\x6f\x01\xd0\x6f\x0b\x63'+s(19945)+b'\x01\xd0'+s(19945)+b'\x0b'
        elif tag==7:
            count,q=uleb(payload,0);key=b'spawnpoint.screenChanged'
            payload=u(count+1)+payload[q:]+u(len(key))+key+b'\x03'+u(callback)
        elif tag==10:
            count,q=uleb(payload,0);code=bytearray(u(count+1))
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
                if index+98==140195:
                    if hashlib.sha256(body).hexdigest()!='211ab706c76046b36914ab56b64fb427c21baa89bc4dac16cf6eddb6af76963d':raise ValueError('Skin cache constructor changed')
                    at=body.index(b'\x10'+u(107))
                    body=body[:at]+b'\x20\x00\xd1\x04\x40\x05\x20\x00\x24'+u(176952)+b'\x0b'+body[at:]
                if index+98 in (93170,169087):
                    anchor=b'\xfb\x02'+u(24884)+u(3)
                    if body.count(anchor)!=1:raise ValueError('Head skin access changed')
                    body=body.replace(anchor,b'\x10'+u(179540)+b'\xfb\x16'+s(22710))
                code+=u(len(body))+body
            head=chat_skin_body();code+=u(len(head))+head
            payload=bytes(code)
        out+=section(tag,payload);p=end
    if not changed:raise ValueError('Screen function missing')
    return bytes(out)

SCREEN_BODY_SHA256='2a8df673634c960dd9786b3833e594cd522e6940ef01f89ef2960ce1119b92fe'
if __name__=='__main__':
    result=patch(SOURCE.read_bytes())
    (SOURCE.parent/'classes-spawnpoint.wasm').write_bytes(result)
