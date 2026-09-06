import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLauncher262 } from '../experiments/minecraft-26/build-26.2.mjs';
import { applyGameAssets, assetSourceHash } from '../experiments/minecraft-26/game-assets.mjs';

it('keeps the published release tied to the checked-in asset sources', async () => {
  const release = JSON.parse(readFileSync('experiments/minecraft-26/cdn-release.json', 'utf8'));
  expect(await assetSourceHash()).toBe(release.sourceHash);
});

// This integration check uses the optional, hash-pinned 26.2 download.
describe.skipIf(!existsSync('work/minecraft-26/client-26.2/index.html'))('Pages game launcher', () => {
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
