import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
if (process.env.PREVIEW_CLOUD !== 'true') throw Error('This installer only runs inside the isolated preview service');
const data = process.env.PREVIEW_DATA;
const source = path.resolve(process.argv[2] || '');
if (!data || !process.argv[2] || source === data || !source.startsWith(data + '/')) throw Error('Package must be in a separate incoming directory on the preview volume');
for (const name of ['runtime', 'spawnpoint.sqlite', '.migration-ready.json']) {
  if (await fs.stat(path.join(data, name)).catch(() => null)) throw Error(`Refusing to overwrite existing ${name}`);
}
const manifest = JSON.parse(await fs.readFile(path.join(source, 'install-manifest.json'), 'utf8'));
if (manifest.minecraft !== '26.2' || !manifest.players || !manifest.sourceSnapshot) throw Error('Invalid package manifest');
for (const [relative, digest] of Object.entries(manifest.files)) {
  const file = path.resolve(source, relative);
  if (!file.startsWith(source + '/') || !(await fs.lstat(file)).isFile()) throw Error('Unsafe package path');
  if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== digest) throw Error(`Checksum mismatch: ${relative}`);
}
const players = (await fs.readdir(path.join(source, 'runtime/world/players/data'))).filter(file => file.endsWith('.dat'));
if (players.length !== manifest.players) throw Error('Installed player count differs');
// Activation marker is written last. The server remains closed during installation.
await fs.rename(path.join(source, 'runtime'), path.join(data, 'runtime'));
await fs.rename(path.join(source, 'spawnpoint.sqlite'), path.join(data, 'spawnpoint.sqlite'));
await fs.copyFile(path.join(source, 'install-manifest.json'), path.join(data, 'install-manifest.json'));
await fs.copyFile(path.join(source, 'transfer-report.json'), path.join(data, 'transfer-report.json'));
await fs.writeFile(path.join(data, '.migration-ready.json'), JSON.stringify({ ...manifest, installedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ installed: true, players: players.length, minecraft: '26.2', spawn: manifest.spawn }));
