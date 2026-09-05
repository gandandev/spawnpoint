import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { source, work, java, flags, run } from './common.mjs';
import { buildClient } from './build-client.mjs';
import { build262 } from './build-26.2.mjs';
import { compileTools } from './common.mjs';

const artifacts = { ...JSON.parse(await fs.readFile(path.join(source, 'artifacts.json'), 'utf8')),
  ...Object.fromEntries(Object.entries(JSON.parse(await fs.readFile(path.join(source, 'artifacts-26.2.json'), 'utf8'))).map(([key, value]) => [`262-${key}`, value])) };
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
for (const [name, artifact] of Object.entries(artifacts)) {
  if (process.env.PREVIEW_BUILD === 'true' && ['client', 'assets'].includes(name)) continue;
  const file = path.join(work, artifact.file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    if (await hash(file) === artifact.sha256) { console.log(`Verified ${name}`); continue; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`Downloading ${name}`);
  const response = await fetch(artifact.url, { headers: { 'User-Agent': 'SpawnpointPrototype/0.1 (local development)' }, signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
  const temporary = `${file}.${process.pid}.download`;
  try {
    await pipeline(response.body, createWriteStream(temporary, { flags: 'wx' }));
    if (await hash(temporary) !== artifact.sha256) {
      throw new Error(`${name}: checksum mismatch, refusing changed upstream artifact`);
    }
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
// Download the hash-pinned Mojang cache with Node's bounded fetch above, avoiding
// Paperclip's unbounded URL.openStream on transient builder TLS failures.
// Paperclip expands its checked server/libraries without starting a world or accepting the EULA.
for (let attempt = 1; ; attempt++) {
  try {
    await run(java, [...flags, '-Dsun.net.client.defaultConnectTimeout=30000', '-Dsun.net.client.defaultReadTimeout=60000', '-Dpaperclip.patchonly=true', '-jar', 'paper-26.2-121.jar'], { cwd: path.join(work, 'runtime') });
    break;
  } catch (error) {
    if (attempt >= 3) throw error;
    console.warn(`Paperclip preparation failed; retrying (${attempt}/3)`);
    await new Promise(resolve => setTimeout(resolve, attempt * 3000));
  }
}
await compileTools();
if (process.env.PREVIEW_BUILD !== 'true') await buildClient();
await build262();
console.log('Prepared the isolated prototype and inventory converter. No world was reset.');
