import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const data = process.env.DATA_DIR || '/data';
const incoming = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !incoming.startsWith(data + '/') || incoming === data) throw Error('Incoming package must be a separate data directory');
const health = await (await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`)).json();
if (health.server !== 'off') throw Error('Stop Minecraft before installing');
for (const name of ['runtime', '.migration-ready.json']) if (await fs.stat(path.join(data, name)).catch(() => null)) throw Error(`Refusing to replace ${name}`);
const manifest = JSON.parse(await fs.readFile(path.join(incoming, 'install-manifest.json'), 'utf8'));
if (manifest.minecraft !== '26.2' || !manifest.players || !manifest.sourceFiles) throw Error('Invalid manifest');
async function verify(base, files) {
  for (const [relative, expected] of Object.entries(files)) {
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + '/') || !(await fs.lstat(file)).isFile()) throw Error('Unsafe file path');
    if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== expected) throw Error(`Source or package changed: ${relative}`);
  }
}
await verify(path.join(data, 'minecraft'), manifest.sourceFiles);
await verify(incoming, manifest.files);
const players = (await fs.readdir(path.join(incoming, 'runtime/world/players/data'))).filter(f => f.endsWith('.dat'));
if (players.length !== manifest.players) throw Error('Player count mismatch');
if ((await (await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`)).json()).server !== 'off') throw Error('Server restarted during verification');
await fs.rename(path.join(incoming, 'runtime'), path.join(data, 'runtime'));
await fs.copyFile(path.join(incoming, 'transfer-report.json'), path.join(data, 'transfer-report-26.2.json'));
await fs.writeFile(path.join(data, '.migration-ready.json'), JSON.stringify({...manifest, installedAt:new Date().toISOString()}), {flag:'wx',mode:0o600});
console.log(JSON.stringify({installed:true,minecraft:'26.2',players:players.length,items:manifest.itemCount,spawn:manifest.spawn}));
