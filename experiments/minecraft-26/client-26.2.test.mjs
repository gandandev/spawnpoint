import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { gunzipSync, gzipSync } from 'node:zlib';

const code = await fs.readFile(new URL('./profile-26.2.js', import.meta.url), 'utf8');
async function launch({ profile = 'gram', width = 1200, height = 714, saved = new Map() } = {}) {
  const context = { URL, URLSearchParams, Blob, Response, CompressionStream, DecompressionStream, TextEncoder, Uint8Array,
    atob, btoa, console, devicePixelRatio: 2, innerWidth: width, innerHeight: height,
    location: new URL(`http://127.0.0.1:4262/262/?profile=${profile}`),
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    eaglercraftXOpts: {}, WebSocket: class { constructor(url, protocols) { this.url = url; this.protocols = protocols; } } };
  context.window = context;
  vm.runInNewContext(code, context);
  await context.spawnpoint262SettingsReady;
  return { context, saved, options: gunzipSync(Buffer.from(saved.get('_spawnpoint262.g'), 'base64')).toString() };
}
test('26.2 settings survive gzip storage and preserve later user choices', async () => {
  const first = await launch();
  assert.match(first.options, /^fov:0.5$/m);
  assert.match(first.options, /^guiScale:2$/m);
  assert.match(first.options, /^soundCategory_music:0.0$/m);
  first.saved.set('_spawnpoint262.g', gzipSync(first.options.replace('fov:0.5', 'fov:0.75') + 'mouseSensitivity:0.3\n').toString('base64'));
  const next = await launch({ profile: 'native', saved: first.saved });
  assert.match(next.options, /^fov:0.75$/m);
  assert.match(next.options, /^mouseSensitivity:0.3$/m);
  assert.match(next.options, /^guiScale:4$/m);
  assert.match((await launch({ width: 480, height: 800 })).options, /^guiScale:1$/m);
});
test('only the exact local HTTP gateway uses an insecure WebSocket', async () => {
  const { context } = await launch();
  assert.equal(new context.WebSocket('wss://127.0.0.1:4262/gateway').url, 'ws://127.0.0.1:4262/gateway');
  assert.equal(new context.WebSocket('wss://example.com/gateway').url, 'wss://example.com/gateway');
  assert.equal(new context.WebSocket('wss://127.0.0.1:4262/elsewhere').url, 'wss://127.0.0.1:4262/elsewhere');
  context.location = new URL('https://127.0.0.1:4262/262/');
  assert.equal(new context.WebSocket('wss://127.0.0.1:4262/gateway').url, 'wss://127.0.0.1:4262/gateway');
});
