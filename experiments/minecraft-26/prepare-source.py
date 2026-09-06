"""Recover local 26.2 rendering sources and inventory installed FO mods.

Generated game sources and third-party binaries stay under ignored work/.
Prism instances, settings, accounts and worlds are never modified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
VINEFLOWER_URL = 'https://github.com/Vineflower/vineflower/releases/download/1.12.0/vineflower-1.12.0.jar'
VINEFLOWER_SHA256 = '1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d'


def digest(path):
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
        return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prism-home', type=Path, default=Path.home() / 'Library/Application Support/PrismLauncher')
    parser.add_argument('--instance', default='Fabulously Optimized 14.0.0-beta.2 for 26.2')
    parser.add_argument('--java', default='java')
    parser.add_argument('--all', action='store_true', help='Decompile all game classes instead of rendering classes only')
    parser.add_argument('--mod', action='append', default=[], help='Also decompile this installed Fabric mod ID, repeatable')
    args = parser.parse_args()
    client = args.prism_home / 'libraries/com/mojang/minecraft/26.2/minecraft-26.2-client.jar'
    with zipfile.ZipFile(client) as archive:
        version = json.loads(archive.read('version.json'))
        if version['id'] != '26.2' or version['protocol_version'] != 776:
            raise ValueError('Expected the unmodified Minecraft Java 26.2 client')
    instance = args.prism_home / 'instances' / args.instance
    pack = json.loads((instance / 'mmc-pack.json').read_text())
    if not any(component['uid'] == 'net.minecraft' and component['version'] == '26.2' for component in pack['components']):
        raise ValueError('Selected Prism instance does not use 26.2')
    mods = []
    for jar in sorted((instance / 'minecraft/mods').glob('*.jar')):
        with zipfile.ZipFile(jar) as archive:
            if 'fabric.mod.json' not in archive.namelist():
                continue
            # Some installed manifests contain literal newlines in descriptions.
            metadata = json.loads(archive.read('fabric.mod.json'), strict=False)
            mods.append({'id': metadata['id'], 'version': metadata['version'], 'file': jar.name,
                         'sha256': digest(jar), 'sources': metadata.get('contact', {}).get('sources')})
    work = ROOT / 'work/minecraft-26/source-work'
    work.mkdir(parents=True, exist_ok=True)
    decompiler = work / 'vineflower-1.12.0.jar'
    if not decompiler.exists():
        with urllib.request.urlopen(VINEFLOWER_URL, timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != VINEFLOWER_SHA256:
            raise ValueError('Decompiler download hash mismatch')
        decompiler.write_bytes(data)
    if digest(decompiler) != VINEFLOWER_SHA256:
        raise ValueError('Decompiler hash mismatch')
    destination = work / ('vanilla-26.2-all' if args.all else 'vanilla-26.2')
    args_java = [args.java, '-Xmx2g', '-jar', str(decompiler), '--thread-count=4', '--skip-extra-files=true']
    if not args.all:
        args_java += ['--only=net/minecraft/client/renderer', '--only=com/mojang/blaze3d']
    with (work / 'decompile.log').open('w') as log:
        subprocess.run(args_java + ['--folder', str(client), str(destination)], stdout=log, stderr=subprocess.STDOUT, check=True)
    required = ['net/minecraft/client/renderer/LevelRenderer.java',
                'net/minecraft/client/renderer/entity/EntityRenderDispatcher.java',
                'com/mojang/blaze3d/opengl/GlRenderPass.java']
    for file in required:
        if not (destination / file).is_file():
            raise ValueError('Missing decompiled rendering source: ' + file)
    recovered_mods = []
    for mod_id in dict.fromkeys(args.mod):
        matches = [mod for mod in mods if mod['id'] == mod_id]
        if len(matches) != 1 or not all(c.isalnum() or c in '_-' for c in mod_id):
            raise ValueError('Expected exactly one installed mod for ID: ' + mod_id)
        mod = matches[0]
        mod_dir = work / ('mod-' + mod_id)
        command = [args.java, '-Xmx2g', '-jar', str(decompiler), '--thread-count=4',
                   '--skip-extra-files=true', '-e=' + str(client), '--folder',
                   str(instance / 'minecraft/mods' / mod['file']), str(mod_dir)]
        with (work / ('decompile-' + mod_id + '.log')).open('w') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        count = sum(1 for _ in mod_dir.rglob('*.java'))
        if count == 0:
            raise ValueError('No Java sources recovered for mod: ' + mod_id)
        recovered_mods.append({'id': mod_id, 'javaFiles': count, 'directory': str(mod_dir)})
    manifest = {'minecraft': version, 'clientSha256': digest(client), 'decompilerSha256': VINEFLOWER_SHA256,
                'javaFiles': sum(1 for _ in destination.rglob('*.java')), 'allClasses': args.all,
                'mods': mods, 'recoveredMods': recovered_mods, 'sourceDirectory': str(destination)}
    (work / 'source-inputs.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'version': version['id'], 'javaFiles': manifest['javaFiles'], 'mods': len(mods),
                      'sourceDirectory': str(destination), 'recoveredMods': recovered_mods}, ensure_ascii=False))


if __name__ == '__main__':
    main()
