import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
const directory = process.env.PREVIEW_DATA;
if (process.env.PREVIEW_CLOUD !== 'true' || !directory || !path.isAbsolute(directory)) throw Error('Isolated preview configuration required');
await fs.mkdir(directory, { recursive: true });
const marker = path.join(directory, '.migration-ready.json');
if (!await fs.stat(marker).catch(() => null)) {
  // First deployment is deliberately closed until the verified migration is installed.
  const maintenance = http.createServer((request, response) => {
    response.writeHead(request.url === '/healthz' ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: request.url === '/healthz', preview: true, migration: 'awaiting-verified-data' }));
  });
  maintenance.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  await once(maintenance, 'listening');
  console.log('Preview is closed pending verified migration data. Production is not connected.');
  while (!await fs.stat(marker).catch(() => null)) await new Promise(resolve => setTimeout(resolve, 2000));
  maintenance.closeAllConnections();
  await new Promise(resolve => maintenance.close(resolve));
}
const receipt = JSON.parse(await fs.readFile(marker, 'utf8'));
if (receipt.minecraft !== '26.2' || !receipt.players || !receipt.sourceSnapshot) throw Error('Invalid migration receipt');
await import('./start.mjs');
