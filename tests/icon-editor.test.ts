import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createIconEditor } from '../scripts/icon-editor/server.mjs';

let directory: string;
let dataPath: string;
let server: ReturnType<typeof createIconEditor>;
let url: string;
const rows = ['.....', '..#..', '.###.', '..#..', '.....'];
beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'spawnpoint-icon-test-'));
  dataPath = path.join(directory, 'icons.json');
  writeFileSync(dataPath, JSON.stringify({ Check: rows, Play: rows }));
  server = createIconEditor(dataPath);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(resolve));
  rmSync(directory, { recursive: true });
});
const read = async () => (await fetch(`${url}/icons`)).json();
const save = (revision: string, changes: unknown, origin = url) => fetch(`${url}/icons`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ revision, changes }),
});
it('saves only the edited icon and preserves the other icons', async () => {
  const { revision } = await read();
  const changed = rows.map(row => row.replaceAll('#', '.'));
  expect((await save(revision, { Check: changed })).status).toBe(200);
  expect(JSON.parse(readFileSync(dataPath, 'utf8'))).toEqual({ Check: changed, Play: rows });
});
it('does not overwrite an externally changed source', async () => {
  const { revision } = await read();
  const newer = JSON.stringify({ Check: rows, Play: [...rows].reverse() }, null, 2);
  writeFileSync(dataPath, newer);
  expect((await save(revision, { Check: rows })).status).toBe(409);
  expect(readFileSync(dataPath, 'utf8')).toBe(newer);
});
it('rejects even dimensions, ragged rows, invalid cells, and unknown names', async () => {
  const { revision } = await read();
  for (const changes of [{ Check: rows.slice(1) }, { Check: rows.map(row => row.slice(1)) }, { Check: ['...', ...rows.slice(1)] }, { Check: rows.map(row => row.replace('#', 'x')) }, { Missing: rows }]) {
    expect((await save(revision, changes)).status).toBe(400);
  }
});
it('rejects writes from a different origin', async () => {
  const { revision } = await read();
  expect((await save(revision, { Check: rows }, 'https://example.com')).status).toBe(403);
});
