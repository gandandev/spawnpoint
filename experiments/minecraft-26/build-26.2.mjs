import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, brotliCompressSync, constants } from 'node:zlib';
import { source, work, root, run } from './common.mjs';
import { buildPortalBridge262 } from './build-portal-bridge.mjs';
import { brandLoadingScreen } from './loading-screen.mjs';
import { localizeLauncher } from './localize-client.mjs';
import { applyGameAssets, assetSourceHash, brotliQuality, launcherArtifacts, releasePath } from './game-assets.mjs';

export async function build262() {
  const localAssets = process.env.GAME_ASSETS_LOCAL === 'true';
  if (localAssets && process.env.GAME_ASSETS_PUBLISH === 'true') {
    throw new Error('Local low-compression assets cannot be published as the normal asset release.');
  }
  const artifacts = JSON.parse(await fs.readFile(path.join(source, 'artifacts-26.2.json'), 'utf8'));
  for (const [name, artifact] of Object.entries(artifacts)) {
    if (!localAssets && process.env.GAME_ASSETS_PUBLISH !== 'true' && !launcherArtifacts.has(name)) continue;
    const bytes = await fs.readFile(path.join(work, artifact.file));
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
      throw new Error(`26.2 artifact changed: ${artifact.file}`);
    }
  }
  const html = createLauncher262(await fs.readFile(path.join(work, 'client-26.2/index.html'), 'utf8'));
  await fs.copyFile(path.join(root, 'vendor/fonts/galmuri/Galmuri11.woff2'), path.join(work, 'client-26.2/Galmuri11.woff2'));
  await fs.writeFile(path.join(work, 'client-26.2/launch.html'), html);
  await fs.copyFile(path.join(source, "client-26.2.js"), path.join(work, "client-26.2/client-26.2.js"));
  await fs.copyFile(path.join(source, 'escape-26.2.js'), path.join(work, 'client-26.2/escape-26.2.js'));
  await fs.copyFile(path.join(source, 'game-hud-26.2.js'), path.join(work, 'client-26.2/game-hud-26.2.js'));
  await fs.copyFile(path.join(source, 'ime-26.2.js'), path.join(work, 'client-26.2/ime-26.2.js'));
  await fs.copyFile(path.join(source, 'food-hud-26.2.js'), path.join(work, 'client-26.2/food-hud-26.2.js'));
  await fs.cp(path.join(root, 'public/game/food-hud'), path.join(work, 'client-26.2/food-hud'), { recursive: true });
  await fs.copyFile(path.join(source, "render-state-26.2.js"), path.join(work, "client-26.2/render-state-26.2.js"));
  await buildPortalBridge262();
  if (localAssets || process.env.GAME_ASSETS_PUBLISH === 'true') {
    await fs.writeFile(path.join(work, 'client-26.2/classes.wasm'), brotliDecompressSync(await fs.readFile(path.join(work, 'client-26.2/classes.wasm.br'))));
    await run('python3', [path.join(source, 'patch-client.py')]);
    const meshInput = path.join(work, 'client-26.2/mesh-worker.wasm');
    const meshOutput = path.join(work, 'client-26.2/mesh-worker-spawnpoint.wasm');
    await fs.writeFile(meshInput, brotliDecompressSync(await fs.readFile(path.join(work, 'client-26.2/mesh-worker.wasm.br'))));
    await run('python3', [path.join(source, 'native-math.py'), 'mesh', meshInput, meshOutput]);
    await fs.writeFile(`${meshOutput}.br`, brotliCompressSync(await fs.readFile(meshOutput), { params: { [constants.BROTLI_PARAM_QUALITY]: localAssets ? 4 : brotliQuality } }));
    await run('python3', [path.join(source, 'patch-food-hud.py')]);
    await run('python3', [path.join(source, 'patch-ime.py')]);
    await run('python3', [path.join(source, 'patch-ui.py')]);
    // Build and publish these bytes once, instead of repeating font rendering and
    // expensive compression on each Railway deployment or a different OS.
    await fs.writeFile(path.join(work, 'client-26.2/classes-spawnpoint.wasm.br'), brotliCompressSync(await fs.readFile(path.join(work, 'client-26.2/classes-spawnpoint.wasm')), { params: { [constants.BROTLI_PARAM_QUALITY]: localAssets ? 4 : brotliQuality } }));
    await run('python3', [path.join(source, 'build-assets.py')]);
  } else {
    const release = JSON.parse(await fs.readFile(releasePath, 'utf8'));
    if (await assetSourceHash() !== release.sourceHash) {
      throw new Error('Game asset sources changed. Run npm run deploy:game-assets before deploying Railway.');
    }
    await fs.writeFile(path.join(work, 'client-26.2/client-assets.json'), JSON.stringify(release));
    await fs.writeFile(path.join(work, 'client-26.2/launch.html'), applyGameAssets(html, release));
  }
  return artifacts;
}

export function createLauncher262(html) {
  const replaceOnce = (before, after, label) => {
    if (html.split(before).length !== 2) throw new Error(`${label} anchor changed`);
    html = html.replace(before, after);
  };
  html = brandLoadingScreen(localizeLauncher(html));
  html = html.replace('</head>', '<style>@font-face{font-family:Galmuri11;src:url("Galmuri11.woff2") format("woff2");font-display:swap}body,body *{font-family:Galmuri11,sans-serif!important;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}</style></head>');
  const overlayScripts = '<script src="escape-26.2.js"></script><script src="game-hud-26.2.js"></script><script src="food-hud-26.2.js"></script><script src="ime-26.2.js"></script>';
  const anchor = '<script type="text/javascript" src="classes.wasm-runtime.js';
  replaceOnce(anchor, `<script>window.spawnpointPreviewCloud=${process.env.PREVIEW_CLOUD === 'true'};</script><script src="/profile-26.2.js"></script><script>if(new URLSearchParams(location.search).has("launch"))document.write('<script src="portal-bridge-26.2.js"><\\/script>');</script><script src="render-state-26.2.js"></script>${overlayScripts}<script src="client-26.2.js"></script>\n` + anchor, '26.2 launcher');
  const mainAnchor = 'const main = tv.exports && tv.exports.main;';
  replaceOnce(mainAnchor, 'await Promise.all([window.spawnpoint262SettingsReady, window.spawnpoint262ServerReady]);\nwindow.__spawnpointBind262?.(tv.instance.exports);\nwindow.spawnpoint262Ime.bind(tv.instance.exports);\n' + mainAnchor, '26.2 main');
  const serverCompile = 'const serverModulePromise = true ?';
  replaceOnce(serverCompile, 'const serverModulePromise = !new URLSearchParams(location.search).has("launch") ?', 'Server worker compilation');
  html = html.replace(/^.*<link rel="preload"[^\n]*server-worker[^\n]*\n/gm, '');
  html = html.replace(/^.*<link rel="preload"[^\n]*assets\.epk[^\n]*\n/gm, '');
  html = html.replaceAll('classes.wasm.br?', 'classes-spawnpoint.wasm.br?').replaceAll('classes.wasm?', 'classes-spawnpoint.wasm?');
  html = html.replaceAll('mesh-worker.wasm.br?', 'mesh-worker-spawnpoint.wasm.br?');
  html = html.replace(/<!-- Cloudflare Pages Analytics -->[\s\S]*?<!-- Cloudflare Pages Analytics -->/, '');
  return html;
}
