import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [base, output] = process.argv.slice(2).map(value => path.resolve(value));
if (!base || !output) throw Error('Pass the migration directory and a new package directory');
const snapshotDirectory = path.join(base, 'preview-26-source-20260905');
const snapshot = JSON.parse(await fs.readFile(path.join(snapshotDirectory, 'snapshot.json'), 'utf8'));
const report = JSON.parse(await fs.readFile(path.join(base, 'export/transfer-report.json'), 'utf8'));
const generation = await fs.readFile(path.join(base, 'fresh-generation.log'), 'utf8');
if (report.minecraft !== '26.2' || report.dataVersion !== 4903 || !generation.includes(`VERIFIED_FRESH_SPAWN ${report.spawn.join(' ')}`)) throw Error('Fresh spawn verification missing');
if (report.players.length !== Object.keys(snapshot.players).length) throw Error('Player count mismatch');
for (const player of report.players) {
  if (snapshot.players[`${player.uuid}.dat`] !== player.sourceSha256) throw Error('Snapshot player checksum mismatch');
}
await fs.mkdir(output, { recursive: false, mode: 0o700 });
await fs.mkdir(path.join(output, 'runtime'));
await fs.cp(path.join(base, 'fresh-runtime/world'), path.join(output, 'runtime/world'), { recursive: true });
await fs.cp(path.join(base, 'export/world'), path.join(output, 'runtime/world'), { recursive: true });
await fs.copyFile(path.join(snapshotDirectory, 'spawnpoint.sqlite'), path.join(output, 'spawnpoint.sqlite'));
await fs.chmod(path.join(output, 'spawnpoint.sqlite'), 0o600);
for (const file of ['banned-ips.json', 'banned-players.json', 'ops.json', 'whitelist.json']) {
  await fs.copyFile(path.join(snapshotDirectory, file), path.join(output, 'runtime', file));
}
await fs.copyFile(path.join(base, 'export/transfer-report.json'), path.join(output, 'transfer-report.json'));
const files = {};
async function hashTree(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashTree(file);
    else if (entry.isFile()) files[path.relative(output, file)] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    else throw Error('Package contains a special file');
  }
}
await hashTree(output);
await fs.writeFile(path.join(output, 'install-manifest.json'), JSON.stringify({ minecraft: '26.2', players: report.players.length,
  sourceSnapshot: snapshot.at, spawn: report.spawn, itemCount: report.players.reduce((sum, player) => sum + player.itemCount, 0), files }, null, 2));
console.log(JSON.stringify({ players: report.players.length, spawn: report.spawn, files: Object.keys(files).length }));
