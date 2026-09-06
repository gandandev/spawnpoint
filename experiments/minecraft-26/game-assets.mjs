import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { source, work, root } from './common.mjs';

export const cdnOrigin = 'https://spawnpoint-game-assets.pages.dev';
export const releasePath = path.join(source, 'cdn-release.json');
export const brotliQuality = 11;
export const launcherArtifacts = new Set(['index.html', 'classes.wasm-runtime.js', 'worker-bootstrap.js']);
const files = [
  'classes-spawnpoint.wasm.br', 'mesh-worker.wasm.br', 'server-worker.wasm.br',
  'assets-spawnpoint-vanilla.epk', 'assets-spawnpoint.epk', 'sounds.epk',
];

export async function assetSourceHash() {
  const hash = createHash('sha256').update(`brotli-quality:${brotliQuality}\n`);
  for (const file of [
    'experiments/minecraft-26/artifacts-26.2.json',
    'experiments/minecraft-26/patch-client.py', 'experiments/minecraft-26/build-assets.py',
    'experiments/minecraft-26/eagler-ko_kr.json', 'experiments/minecraft-26/minecraft-ko_kr-overrides.json',
    'vendor/fonts/galmuri/Galmuri11.ttf', 'vendor/fonts/galmuri/Galmuri11-Bold.ttf',
    'vendor/clients/stable-galmuri.epw',
  ]) {
    hash.update(file).update('\0').update(await fs.readFile(path.join(root, file)));
  }
  return hash.digest('hex');
}

export async function packageGameAssets(output = path.join(root, 'dist/game-assets')) {
  await fs.mkdir(output, { recursive: true });
  const assets = {};
  let headers = '/*\n  Access-Control-Allow-Origin: *\n  Cross-Origin-Resource-Policy: cross-origin\n  Timing-Allow-Origin: *\n  Cache-Control: public, max-age=31536000, immutable, no-transform\n  X-Content-Type-Options: nosniff\n';
  for (const file of files) {
    const bytes = await fs.readFile(path.join(work, 'client-26.2', file));
    if (bytes.length > 25 * 1024 * 1024) throw new Error(`Pages asset exceeds 25 MiB: ${file}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const wasm = file.endsWith('.wasm.br');
    const outputName = `${file.replace(/\.wasm\.br$|\.epk$/g, '')}-${hash.slice(0, 16)}${wasm ? '.wasm' : '.epk'}`;
    const type = wasm ? 'application/wasm' : 'application/octet-stream';
    await fs.writeFile(path.join(output, outputName), bytes);
    headers += `\n/${outputName}\n  Content-Type: ${type}\n${wasm ? '  Content-Encoding: br\n' : ''}`;
    assets[file] = { url: `${cdnOrigin}/${outputName}`, type, sha256: hash,
      decodedSha256: createHash('sha256').update(wasm ? brotliDecompressSync(bytes) : bytes).digest('hex') };
  }
  await fs.writeFile(path.join(output, '_headers'), headers);
  await fs.writeFile(path.join(output, '404.html'), '<!doctype html><title>Not found</title>Not found');
  const release = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 16);
  const branch = `r-${release}`;
  for (const asset of Object.values(assets)) asset.url = asset.url.replace(cdnOrigin, `https://${branch}.spawnpoint-game-assets.pages.dev`);
  return { sourceHash: await assetSourceHash(), branch, assets, preload: ['classes-spawnpoint.wasm.br', 'mesh-worker.wasm.br', 'assets-spawnpoint-vanilla.epk', 'sounds.epk'] };
}

export function applyGameAssets(html, manifest) {
  const once = (before, after) => {
    if (html.split(before).length !== 2) throw new Error(`Game asset launcher anchor changed: ${before.slice(0, 80)}`);
    html = html.replace(before, after);
  };
  // The shared cache owns these requests. HTML preload would bypass it.
  html = html.replace(/^.*<link rel="preload"[^\n]*\n/gm, '');
  const start = html.indexOf('\t\t\t\t\tlet module;');
  const end = html.indexOf('\t\t\t\t\t// Finish the two worker images', start);
  if (start < 0 || end < start) throw new Error('26.2 compile block changed');
  html = html.slice(0, start) + `
          const mainModulePromise = window.spawnpointCompileWasm('classes-spawnpoint.wasm.br');
          const meshModulePromise = window.spawnpointCompileWasm('mesh-worker.wasm.br');
          const serverModulePromise = new URLSearchParams(location.search).has('launch')
            ? Promise.resolve(null) : window.spawnpointCompileWasm('server-worker.wasm.br');
          const [module] = await Promise.all([mainModulePromise, meshModulePromise, serverModulePromise]);
` + html.slice(end);
  html = html.replace(/^.*<script type="module" src="brotli-loader\.js[^\n]*\n/gm, '');
  once('<script src="/profile-26.2.js"></script>', `<script src="/game-asset-loader.js"></script><script>
window.spawnpointAssetManifest=${JSON.stringify(manifest)};
window.spawnpointGameAssets.install(window.spawnpointAssetManifest);
window.eaglercraftXOpts.assetsURI = [
  {url: window.spawnpointAssetManifest.assets['assets-spawnpoint.epk'].url, path: ''},
  {url: window.spawnpointAssetManifest.assets['sounds.epk'].url, path: ''}
];
</script><script src="/profile-26.2.js"></script><script>
window.spawnpointAssetsReady = window.spawnpointPrepareAssets(window.eaglercraftXOpts);
window.spawnpointAssetsReady.catch(() => {});
</script>`);
  once('await Promise.all([window.spawnpoint262SettingsReady, window.spawnpoint262ServerReady]);',
    'await Promise.all([window.spawnpoint262SettingsReady, window.spawnpoint262ServerReady, window.spawnpointAssetsReady]);');
  html = html.replace(/"classes-spawnpoint\.wasm\?[^"\s]+"/g, JSON.stringify(manifest.assets['classes-spawnpoint.wasm.br'].url));
  if (html.includes('__eagFetchBrotliWasm(')) throw new Error('Unconverted Brotli loader call');
  return html;
}
