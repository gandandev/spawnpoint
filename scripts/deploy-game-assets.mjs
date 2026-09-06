import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build262 } from '../experiments/minecraft-26/build-26.2.mjs';
import { packageGameAssets, applyGameAssets, releasePath } from '../experiments/minecraft-26/game-assets.mjs';
import { root, work, run } from '../experiments/minecraft-26/common.mjs';

// Rebuild the patched release before publishing. Never publish the upstream WASM.
process.env.GAME_ASSETS_PUBLISH = 'true';
await build262();
const output = path.join(root, 'dist/game-assets');
await fs.rm(output, { recursive: true, force: true });
const manifest = await packageGameAssets(output);
await run('npx', ['--yes', 'wrangler', 'pages', 'deploy', output,
  '--project-name', 'spawnpoint-game-assets', '--branch', manifest.branch, '--commit-dirty=true']);

// Verify decoded bytes and browser-facing headers before making Railway use them.
for (const asset of Object.values(manifest.assets)) {
  let error;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${asset.url}`);
      if (response.headers.get('access-control-allow-origin') !== '*') throw new Error('Missing asset CORS header');
      if (response.headers.get('content-type') !== asset.type) throw new Error('Incorrect asset MIME type');
      const hash = createHash('sha256');
      for await (const chunk of response.body) hash.update(chunk);
      if (hash.digest('hex') !== asset.decodedSha256) throw new Error(`CDN asset mismatch: ${asset.url}`);
      console.log(`Verified ${asset.url}`);
      error = undefined;
      break;
    } catch (failure) {
      error = failure;
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  if (error) throw error;
}
await fs.writeFile(releasePath, JSON.stringify(manifest, null, 2) + '\n');
const client = path.join(work, 'client-26.2');
await fs.writeFile(path.join(client, 'client-assets.json'), JSON.stringify(manifest));
await fs.writeFile(path.join(client, 'launch.html'), applyGameAssets(await fs.readFile(path.join(client, 'launch.html'), 'utf8'), manifest));
console.log('Verified Pages release. Commit cdn-release.json with the matching client changes before deploying Railway.');
