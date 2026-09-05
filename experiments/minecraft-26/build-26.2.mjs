import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { source, work } from './common.mjs';
import { buildPortalBridge262 } from './build-portal-bridge.mjs';

export async function build262() {
  const artifacts = JSON.parse(await fs.readFile(path.join(source, 'artifacts-26.2.json'), 'utf8'));
  for (const artifact of Object.values(artifacts)) {
    const bytes = await fs.readFile(path.join(work, artifact.file));
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
      throw new Error(`26.2 artifact changed: ${artifact.file}`);
    }
  }
  let html = await fs.readFile(path.join(work, 'client-26.2/index.html'), 'utf8');
  const anchor = '<script type="text/javascript" src="classes.wasm-runtime.js';
  if (html.split(anchor).length !== 2) throw new Error('26.2 launcher anchor changed');
  html = html.replace(anchor, `<script>window.spawnpointPreviewCloud=${process.env.PREVIEW_CLOUD === 'true'};</script><script src="/profile-26.2.js"></script><script>if(new URLSearchParams(location.search).has("launch"))document.write('<script src="portal-bridge-26.2.js"><\\/script>');</script>\n` + anchor);
  const mainAnchor = 'const main = tv.exports && tv.exports.main;';
  if (html.split(mainAnchor).length !== 2) throw new Error('26.2 main anchor changed');
  html = html.replace(mainAnchor, 'await window.spawnpoint262SettingsReady;\n' + mainAnchor);
  html = html.replace(/<!-- Cloudflare Pages Analytics -->[\s\S]*?<!-- Cloudflare Pages Analytics -->/, '');
  await fs.writeFile(path.join(work, 'client-26.2/launch.html'), html);
  await fs.writeFile(path.join(work, 'client-26.2/classes.wasm'), brotliDecompressSync(await fs.readFile(path.join(work, 'client-26.2/classes.wasm.br'))));
  await buildPortalBridge262();
  return artifacts;
}
