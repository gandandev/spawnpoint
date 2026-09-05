// Run explicitly on the existing backend while Minecraft is off. Never changes game files.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Database from '/app/node_modules/better-sqlite3/lib/index.js';
import { execFileSync } from 'node:child_process';
const base = '/data/preview-26-source-20260905';
const health = async () => (await (await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`)).json()).server;
if (await health() !== 'off') throw Error('Minecraft must be idle for the snapshot');
await fs.mkdir(base, { recursive: false, mode: 0o700 });
const hashes = async () => {
  const result = {};
  for (const file of (await fs.readdir('/data/minecraft/world/playerdata')).sort()) {
    if (file.endsWith('.dat')) result[file] = crypto.createHash('sha256').update(await fs.readFile(`/data/minecraft/world/playerdata/${file}`)).digest('hex');
  }
  return result;
};
const before = await hashes();
await fs.cp('/data/minecraft/world', `${base}/world`, { recursive: true });
const db = new Database('/data/spawnpoint.sqlite', { readonly: true });
await db.backup(`${base}/spawnpoint.sqlite`);
db.close();
for (const file of ['banned-ips.json', 'banned-players.json', 'ops.json', 'whitelist.json', 'server.properties']) {
  await fs.copyFile(`/data/minecraft/${file}`, `${base}/${file}`);
}
if (await health() !== 'off' || JSON.stringify(before) !== JSON.stringify(await hashes())) throw Error('Source changed during snapshot; do not use this copy');
await fs.writeFile(`${base}/snapshot.json`, JSON.stringify({ at: new Date().toISOString(), players: before, source: 'production 1.12.2', server: 'off' }, null, 2));
execFileSync('tar', ['-czf', `${base}.tar.gz`, '-C', '/data', base.split('/').pop()]);
console.log(JSON.stringify({ archive: `${base}.tar.gz`, players: Object.keys(before).length, size: (await fs.stat(`${base}.tar.gz`)).size }));
