"""Overlay the maintained portal font and textures onto current-version assets."""
from pathlib import Path
import gzip, lzma, struct, zlib, json, tarfile
ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'work/minecraft-26/client-26.2'

def parse(data):
    assert data[:8] == b'EAGPKG$$' and data[-8:] == b':::YEE:>'
    pos = 8
    for _ in range(2): pos += 1 + data[pos]
    pos += 2 + int.from_bytes(data[pos:pos+2], 'big') + 8
    prefix = data[:pos]
    count = int.from_bytes(data[pos:pos+4], 'big'); kind = data[pos+4:pos+5]
    body = data[pos+5:-8]
    if kind == b'G': body = gzip.decompress(body)
    else: assert kind == b'0'
    entries = []; pos = 0
    for _ in range(count):
        kind = body[pos:pos+4]; pos += 4
        length = body[pos]; pos += 1
        name = body[pos:pos+length].decode(); pos += length
        length = int.from_bytes(body[pos:pos+4], 'big'); pos += 4
        if kind == b'FILE':
            crc = int.from_bytes(body[pos:pos+4], 'big'); value = body[pos+4:pos+length-1]; pos += length-1
            assert zlib.crc32(value) & 0xffffffff == crc
            assert body[pos:pos+2] == b':>'; pos += 2
        else:
            value = body[pos:pos+length]; pos += length
            assert body[pos:pos+1] == b'>'; pos += 1
        entries.append((kind, name, value))
    assert body[pos:] == b'END$'
    return prefix, entries

def write(prefix, entries, name):
    body = bytearray()
    for kind, key, value in entries:
        key = key.encode(); assert len(key) < 256
        body += kind + bytes([len(key)]) + key
        if kind == b'FILE': body += struct.pack('>II',len(value)+5,zlib.crc32(value)&0xffffffff)+value+b':>'
        else: body += struct.pack('>I',len(value))+value+b'>'
    body += b'END$'
    (WORK/name).write_bytes(prefix+struct.pack('>I',len(entries))+b'G'+gzip.compress(body,compresslevel=9,mtime=0)+b':::YEE:>')

prefix, entries = parse((WORK/'assets.epk').read_bytes())
assets = {name:value for kind,name,value in entries if kind == b'FILE'}
epw = (ROOT/'vendor/clients/stable-galmuri.epw').read_bytes()
offset,length = struct.unpack_from('<II',epw,276+16)
_, old_entries = parse(lzma.decompress(epw[offset:offset+length]))
old = {name:value for kind,name,value in old_entries if kind == b'FILE'}
assets['assets/minecraft/lang/ko_kr.json'] = (WORK/'ko_kr.json').read_bytes()
providers = []
sizes = old['assets/minecraft/font/glyph_sizes.bin']
for number in range(1,256):
    key = f'assets/minecraft/textures/font/unicode_page_{number:02x}.png'
    if key not in old: continue
    chars = [''.join(chr(number*256+y*16+x) if sizes[number*256+y*16+x] and not 0xd800 <= number*256+y*16+x <= 0xdfff else '\0' for x in range(16)) for y in range(16)]
    if not any(c.strip('\0') for c in chars): continue
    assets[key] = old[key]
    providers.append({'type':'bitmap','file':f'minecraft:font/unicode_page_{number:02x}.png','height':8,'ascent':7,'chars':chars})
font=json.loads(assets['assets/minecraft/font/default.json'])
font['providers']=providers+font['providers']
assets['assets/minecraft/font/default.json']=json.dumps(font,ensure_ascii=True).encode()
for key,value in old.items():
    if key.startswith('assets/spawnpoint/fonts/') or key == 'assets/eagler/eagtek.png': assets[key]=value

original_names = {e[1] for e in entries}
def merged():
    return [(kind,name,assets[name] if kind==b'FILE' else value) for kind,name,value in entries]+[(b'FILE',name,value) for name,value in assets.items() if name not in original_names]
write(prefix,merged(),'assets-spawnpoint-vanilla.epk')
count=0
with tarfile.open(ROOT/'public/game/resource-packs/new-default-v2.tar.gz') as archive:
    for member in archive:
        if not member.isfile(): continue
        name=member.name.removeprefix('./').replace('/textures/blocks/','/textures/block/').replace('/textures/items/','/textures/item/')
        if name.startswith('assets/minecraft/textures/') and name in assets and name.endswith('.png'):
            assets[name]=archive.extractfile(member).read();count+=1
write(prefix,merged(),'assets-spawnpoint.epk')
print(json.dumps({'fontPages':len(providers),'currentVersionTexturesOverlaid':count}))
