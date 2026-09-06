import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const source = readFileSync('experiments/minecraft-26/profile-26.2.js', 'utf8');
async function launch(profile: string, saved?: string, hardware = { hardwareConcurrency: 4, deviceMemory: 4, maxTouchPoints: 0 }) {
  const namespace = '_spawnpoint262_test';
  const storage = new Map<string, string>();
  if (saved !== undefined) {
    storage.set(namespace + '.g', gzipSync(saved).toString('base64'));
    storage.set(namespace + '.defaults.v2', '1');
  }
  const runtime = {
    eaglercraftXOpts: { assetsURI: [{ url: 'assets.epk' }] },
    location: { search: `?launch=qa&account=test&profile=${profile}`, protocol: 'https:', host: 'localhost', href: 'https://localhost/game/' },
    navigator: hardware,
    devicePixelRatio: 2, innerWidth: 1470, innerHeight: 956,
    WebSocket: class {},
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    fetch: async () => Response.json({ server: { phase: 'online' } }),
    URL, URLSearchParams, Response, Blob, CompressionStream, DecompressionStream,
    TextEncoder, Uint8Array, AbortSignal, setTimeout, btoa, atob,
    console: { warn: (message: string, error: unknown) => { throw new Error(message, { cause: error }); } },
  };
  const context = Object.assign(runtime, { window: runtime }) as typeof runtime & { spawnpoint262SettingsReady: Promise<void> };
  vm.runInNewContext(source, context);
  await context.spawnpoint262SettingsReady;
  const text = gunzipSync(Buffer.from(storage.get(namespace + '.g')!, 'base64')).toString();
  return new Map(text.trim().split('\n').map(line => { const colon = line.indexOf(':'); return [line.slice(0, colon), line.slice(colon + 1)]; }));
}

describe('modern display frame pacing', () => {
  it.each(['native', 'gram', 'tablet'])('uses VSync and the unlimited sentinel on a new %s profile', async profile => {
    const settings = await launch(profile);
    expect(settings.get('enableVsync')).toBe('true');
    expect(settings.get('maxFps')).toBe('260');
    expect(settings.get('fov')).toBe('0.5');
  });
  it.each(['60', '120', '240'])('migrates a saved %s FPS cap without resetting other preferences', async cap => {
    const settings = await launch('native', `maxFps:${cap}\nenableVsync:false\nfov:0.75\nsoundCategory_master:0.7\n`);
    expect(settings.get('enableVsync')).toBe('true');
    expect(settings.get('maxFps')).toBe('260');
    expect(settings.get('fov')).toBe('0.75');
    expect(settings.get('soundCategory_master')).toBe('0.7');
  });
});

it('selects view distance from hardware and keeps texture antialiasing enabled', async () => {
  const low = await launch('auto');
  const high = await launch('auto', undefined, { hardwareConcurrency: 12, deviceMemory: 8, maxTouchPoints: 0 });
  expect(low.get('renderDistance')).toBe('4');
  expect(high.get('renderDistance')).toBe('10');
  expect(low.get('textureFiltering')).toBe('1');
  expect(high.get('textureFiltering')).toBe('1');
});
it('migrates an unsupported Chinese selection without changing volume or field of view', async () => {
  const settings = await launch('native', 'lang:zh_cn\nfov:0.75\nsoundCategory_master:0.4\n');
  expect(settings.get('lang')).toBe('ko_kr');
  expect(settings.get('fov')).toBe('0.75');
  expect(settings.get('soundCategory_master')).toBe('0.4');
});
