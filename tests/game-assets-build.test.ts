import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { build262, createLauncher262 } from '../experiments/minecraft-26/build-26.2.mjs';
import { applyGameAssets, assetSourceHash, packageGameAssets } from '../experiments/minecraft-26/game-assets.mjs';

it('keeps the published release tied to the checked-in asset sources', async () => {
  const release = JSON.parse(readFileSync('experiments/minecraft-26/cdn-release.json', 'utf8'));
  expect(await assetSourceHash()).toBe(release.sourceHash);
});

it('refuses to publish a local food HUD experiment as the normal CDN release', async () => {
  vi.stubEnv('GAME_ASSETS_LOCAL', 'true');
  vi.stubEnv('GAME_ASSETS_PUBLISH', 'true');
  try {
    await expect(build262()).rejects.toThrow('Local food HUD experiments cannot be published');
  } finally {
    vi.unstubAllEnvs();
  }
});

// This integration check uses the optional, hash-pinned 26.2 download.
describe.skipIf(!existsSync('work/minecraft-26/client-26.2/index.html'))('Pages game launcher', () => {
  it('loads the food overlay script only for the local experiment', () => {
    const input = readFileSync('work/minecraft-26/client-26.2/index.html', 'utf8');
    try {
      vi.stubEnv('GAME_ASSETS_LOCAL', 'false');
      expect(createLauncher262(input)).not.toContain('src="food-hud-26.2.js"');
      vi.stubEnv('GAME_ASSETS_LOCAL', 'true');
      expect(createLauncher262(input)).toContain('src="food-hud-26.2.js"');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('loads the optimized mesh worker in a local build', () => {
    const html = createLauncher262(readFileSync('work/minecraft-26/client-26.2/index.html', 'utf8'));
    expect(html).toContain('mesh-worker-spawnpoint.wasm.br?');
    expect(html).not.toContain('"mesh-worker.wasm.br?');
  });
  it('shares precompiled modules, prepares EPKs before main, and keeps authenticated requests on the portal', () => {
    const input = readFileSync('work/minecraft-26/client-26.2/index.html', 'utf8');
    const release = JSON.parse(readFileSync('experiments/minecraft-26/cdn-release.json', 'utf8'));
    const html = applyGameAssets(createLauncher262(input), release);
    expect(html).not.toContain('__eagFetchBrotliWasm(');
    expect(html).not.toContain('src="brotli-loader.js');
    expect(html).not.toContain('<link rel="preload"');
    expect(html).toContain("window.spawnpointCompileWasm('classes-spawnpoint.wasm.br')");
    expect(html).toContain("window.spawnpointCompileWasm('mesh-worker.wasm.br')");
    expect(html).toContain('window.spawnpointAssetsReady = window.spawnpointPrepareAssets(window.eaglercraftXOpts)');
    expect(html).toContain('await Promise.all([window.spawnpoint262SettingsReady, window.spawnpoint262ServerReady, window.spawnpointAssetsReady])');
    expect(html).toContain('<script src="/profile-26.2.js"></script>');
    expect(html).toContain("? Promise.resolve(null) : window.spawnpointCompileWasm('server-worker.wasm.br')");
  });
});

it.skipIf(!existsSync('work/minecraft-26/client-26.2/mesh-worker-spawnpoint.wasm.br'))('packages the patched worker under the shared loader key', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'spawnpoint-math-assets-'));
  try {
    const release = await packageGameAssets(output);
    const original = readFileSync('work/minecraft-26/client-26.2/mesh-worker.wasm.br');
    const patched = readFileSync('work/minecraft-26/client-26.2/mesh-worker-spawnpoint.wasm.br');
    const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(release.assets['mesh-worker.wasm.br'].sha256).toBe(sha(patched));
    expect(release.assets['mesh-worker.wasm.br'].decodedSha256).toBe(sha(brotliDecompressSync(patched)));
    expect(sha(brotliDecompressSync(patched))).not.toBe(sha(brotliDecompressSync(original)));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
