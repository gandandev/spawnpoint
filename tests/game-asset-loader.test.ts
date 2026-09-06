import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync('public/game-asset-loader.js', 'utf8');
const asset = { url: 'https://r-test.spawnpoint-game-assets.pages.dev/sounds-hash.epk', type: 'application/octet-stream' };
const wasm = { url: 'https://r-test.spawnpoint-game-assets.pages.dev/classes-hash.wasm', type: 'application/wasm' };
const manifest = { assets: { sounds: asset, wasm }, preload: ['sounds', 'wasm'] };
function fixture(parent?: any) {
  const fetch = vi.fn(async (input: string) => input.endsWith('client-assets.json') ? Response.json(manifest)
    : new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), { headers: { 'Content-Type': input.endsWith('.wasm') ? 'application/wasm' : asset.type } }));
  const runtime: any = { fetch, URL, Response, AbortSignal, Map, WebAssembly,
    location: { href: 'https://portal.test/game/stable.html' } };
  runtime.window = runtime;
  runtime.parent = parent || runtime;
  vm.runInNewContext(script, runtime);
  return { runtime, fetch, api: runtime.spawnpointGameAssets };
}

describe('game asset preloading', () => {
  it('reuses in-flight downloads and compiled modules across the portal and game frame with no HTTP cache', async () => {
    const portal = fixture();
    const warming = portal.api.warm();
    const frame = fixture(portal.runtime);
    frame.api.install(manifest);
    const module = frame.runtime.spawnpointCompileWasm('wasm');
    const options = { assetsURI: [{ url: asset.url }, { url: '/api/game/heads.epk' }] };
    const first = frame.runtime.spawnpointPrepareAssets(options);
    await warming;
    expect(await module).toBe(await portal.api.compile(wasm));
    await first;
    expect(options.assetsURI[0].url).toMatch(/^blob:/);
    expect(options.assetsURI[1].url).toBe('/api/game/heads.epk');
    const bytes = await (await fetch(options.assetsURI[0].url)).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(await (await portal.api.load(asset)).arrayBuffer()));
    URL.revokeObjectURL(options.assetsURI[0].url);
    expect(portal.fetch.mock.calls.filter(([url]) => url === asset.url)).toHaveLength(1);
    expect(portal.fetch.mock.calls.filter(([url]) => url === wasm.url)).toHaveLength(1);
    expect(frame.fetch).not.toHaveBeenCalled();
  });

  it('does not intercept account APIs, unknown resources, or customized requests', async () => {
    const frame = fixture();
    frame.api.install(manifest);
    await frame.runtime.fetch('/api/game/heads.epk');
    await frame.runtime.fetch(asset.url, { method: 'POST' });
    await frame.runtime.fetch(asset.url, { signal: AbortSignal.abort() });
    expect(frame.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a failed preload during launch instead of caching the failure', async () => {
    const frame = fixture();
    frame.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(frame.api.load(asset)).rejects.toThrow('offline');
    expect((await frame.api.load(asset)).size).toBe(8);
    expect(frame.fetch).toHaveBeenCalledTimes(2);
  });

  it('uses byte compilation on Safari so string builtin options are honored', async () => {
    const frame = fixture();
    // Navigator is read when the loader is installed, like a real browser.
    frame.runtime.spawnpointGameAssets = undefined;
    frame.runtime.navigator = { userAgent: 'iPhone', vendor: 'Apple Computer, Inc.' };
    const compile = vi.fn(WebAssembly.compile);
    const compileStreaming = vi.fn().mockRejectedValue(new Error('unsupported options'));
    frame.runtime.WebAssembly = { compileStreaming, compile };
    vm.runInNewContext(script, frame.runtime);
    expect(await frame.runtime.spawnpointGameAssets.compile(wasm)).toBeInstanceOf(WebAssembly.Module);
    expect(compileStreaming).not.toHaveBeenCalled();
    expect(compile).toHaveBeenCalledWith(expect.any(ArrayBuffer), { builtins: ['js-string'] });
    expect(frame.fetch).toHaveBeenCalledTimes(1);
  });

  it('serializes mobile compiles and avoids eager portal downloads', async () => {
    const frame = fixture();
    frame.runtime.spawnpointGameAssets = undefined;
    frame.runtime.navigator = { userAgent: 'Android' };
    let release!: (module: WebAssembly.Module) => void;
    const first = new Promise<WebAssembly.Module>(resolve => { release = resolve; });
    const compileStreaming = vi.fn().mockReturnValueOnce(first).mockImplementation(WebAssembly.compileStreaming);
    frame.runtime.WebAssembly = { compileStreaming };
    vm.runInNewContext(script, frame.runtime);
    const api = frame.runtime.spawnpointGameAssets;
    await api.warm();
    expect(frame.fetch).not.toHaveBeenCalled();
    const main = api.compile(wasm);
    const mesh = api.compile({ ...wasm, url: 'https://cdn.test/mesh.wasm' });
    await vi.waitFor(() => expect(compileStreaming).toHaveBeenCalledTimes(1));
    expect(frame.fetch).toHaveBeenCalledTimes(1);
    release(await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])));
    await Promise.all([main, mesh]);
    expect(compileStreaming).toHaveBeenCalledTimes(2);
  });

  it('does not clone or recompile a stream after a compiler failure', async () => {
    const frame = fixture();
    const response = new Response(new Uint8Array([0]), { headers: { 'Content-Type': 'application/wasm' } });
    const clone = vi.spyOn(response, 'clone');
    frame.fetch.mockResolvedValueOnce(response);
    const compile = vi.fn();
    frame.runtime.WebAssembly = { compileStreaming: vi.fn().mockRejectedValue(new Error('bad wasm')), compile };
    await expect(frame.api.compile(wasm)).rejects.toThrow('bad wasm');
    expect(clone).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });
});

it('keeps Safari modules in the game realm while sharing downloaded asset blobs', async () => {
  const portal = fixture();
  const frame = fixture(portal.runtime);
  frame.runtime.spawnpointGameAssets = undefined;
  frame.runtime.navigator = { vendor: 'Apple Computer, Inc.', userAgent: 'iPhone' };
  vm.runInNewContext(script, frame.runtime);
  const local = frame.runtime.spawnpointGameAssets;
  local.install(manifest);
  const parentCompile = vi.spyOn(portal.api, 'compile');
  const module = await frame.runtime.spawnpointCompileWasm('wasm');
  expect(module).toBeInstanceOf(WebAssembly.Module);
  expect(parentCompile).not.toHaveBeenCalled();
  expect(frame.fetch).toHaveBeenCalledWith(wasm.url, expect.anything());
  const options = { assetsURI: [{ url: asset.url }] };
  await frame.runtime.spawnpointPrepareAssets(options);
  expect(portal.fetch).toHaveBeenCalledWith(asset.url, expect.anything());
  URL.revokeObjectURL(options.assetsURI[0].url);
});
