"""Build Galmuri11 fonts and portal labels into current-version vanilla assets."""
from pathlib import Path
import gzip, lzma, struct, zlib, json, io
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
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
metadata = json.loads(assets['pack.mcmeta'])
metadata.setdefault('language', {})['ko_kr'] = {'name':'한국어','region':'대한민국','bidirectional':False}
assets['pack.mcmeta'] = json.dumps(metadata,ensure_ascii=False).encode()
eagler_english = json.loads(assets['assets/eagler/lang/en_us.json'])
eagler_korean = json.loads((ROOT/'experiments/minecraft-26/eagler-ko_kr.json').read_text())
if set(eagler_korean) != set(eagler_english):
    missing = sorted(set(eagler_english) - set(eagler_korean))
    extra = sorted(set(eagler_korean) - set(eagler_english))
    raise ValueError(f'Eaglercraft Korean locale mismatch: missing={missing}, extra={extra}')
assets['assets/eagler/lang/ko_kr.json'] = json.dumps(eagler_korean, ensure_ascii=False).encode()

minecraft_english = json.loads(assets['assets/minecraft/lang/en_us.json'])
minecraft_korean = json.loads(assets['assets/minecraft/lang/ko_kr.json'])
minecraft_overrides = json.loads((ROOT/'experiments/minecraft-26/minecraft-ko_kr-overrides.json').read_text())
unknown_overrides = sorted(set(minecraft_overrides) - set(minecraft_english))
if unknown_overrides:
    raise ValueError(f'Unknown Minecraft Korean locale overrides: {unknown_overrides}')
missing_visible = sorted(
    key for key, value in minecraft_english.items()
    if key not in minecraft_korean and value
)
untranslated = sorted(set(missing_visible) - set(minecraft_overrides))
if untranslated:
    raise ValueError(f'Minecraft Korean locale is missing visible text: {untranslated}')
minecraft_korean.update(minecraft_overrides)
assets['assets/minecraft/lang/ko_kr.json'] = json.dumps(minecraft_korean, ensure_ascii=False).encode()

for language in ('en_us', 'ko_kr'):
    key = f'assets/minecraft/lang/{language}.json'
    translations = json.loads(assets[key])
    translations['menu.disconnect'] = '포탈로 돌아가기' if language == 'ko_kr' else 'Return to Portal'
    translations['menu.returnToMenu'] = translations['menu.disconnect']
    assets[key] = json.dumps(translations, ensure_ascii=False).encode()
# Build every supported glyph from Galmuri11, including Latin and digits.
def font_providers(font_path, stem):
    font = ImageFont.truetype(str(font_path), 12, layout_engine=ImageFont.Layout.BASIC)
    cmap = TTFont(font_path).getBestCmap()
    providers = [{'type':'space','advances':{' ':4,'\u00a0':4}}]
    for page in sorted({code >> 8 for code in cmap if 32 < code <= 65535 and not 0xd800 <= code <= 0xdfff}):
        image = Image.new('RGBA',(256,256),(255,255,255,0))
        draw = ImageDraw.Draw(image)
        rows = [['\0']*16 for _ in range(16)]
        for slot in range(256):
            code = page*256+slot
            if code not in cmap or code <= 32 or code == 160 or 0xd800 <= code <= 0xdfff: continue
            character = chr(code)
            left,_,right,_ = font.getbbox(character)
            if right-left > 16: continue
            x,y = slot%16*16,slot//16*16
            draw.text((x-left,y+1),character,font=font,fill=(255,255,255,255))
            if image.crop((x,y,x+16,y+16)).getchannel('A').getbbox(): rows[slot//16][slot%16]=character
        if not any(c != '\0' for row in rows for c in row): continue
        key=f'assets/minecraft/textures/font/{stem}_{page:02x}.png'
        output=io.BytesIO();image.save(output,format='PNG',optimize=True)
        assets[key]=output.getvalue()
        providers.append({'type':'bitmap','file':f'minecraft:font/{stem}_{page:02x}.png','height':8,'ascent':7,'chars':[''.join(row) for row in rows]})
    return providers

providers = font_providers(ROOT/'vendor/fonts/galmuri/Galmuri11.ttf', 'galmuri11')
bold_providers = font_providers(ROOT/'vendor/fonts/galmuri/Galmuri11-Bold.ttf', 'galmuri11_bold')
assets['assets/minecraft/font/galmuri11_bold.json'] = json.dumps({'providers': bold_providers + [{'type':'reference','id':'minecraft:default'}]}, ensure_ascii=True).encode()
for name in ('default','uniform','alt'):
    assets[f'assets/minecraft/font/{name}.json']=json.dumps({'providers':providers},ensure_ascii=True).encode()
for key,value in old.items():
    if key.startswith('assets/spawnpoint/fonts/') or key == 'assets/eagler/eagtek.png': assets[key]=value

original_names = {e[1] for e in entries}
def merged():
    return [(kind,name,assets[name] if kind==b'FILE' else value) for kind,name,value in entries]+[(b'FILE',name,value) for name,value in assets.items() if name not in original_names]
write(prefix,merged(),'assets-spawnpoint-vanilla.epk')
# Keep the compatibility filename vanilla too, including cached launch preferences.
write(prefix,merged(),'assets-spawnpoint.epk')
print(json.dumps({'fontPages':len(providers),'currentVersionTexturesOverlaid':0}))
