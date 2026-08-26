import fs from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const assetDir = path.join(process.cwd(), "dist", "client", "assets");
const compressibleExtension = /\.(?:css|js|json|svg)$/i;
const files = await fs.readdir(assetDir, { withFileTypes: true });

await Promise.all(files.map(async (entry) => {
  if (!entry.isFile() || !compressibleExtension.test(entry.name)) return;
  const sourcePath = path.join(assetDir, entry.name);
  const source = await fs.readFile(sourcePath);
  if (source.length < 1_024) return;
  await Promise.all([
    fs.writeFile(`${sourcePath}.br`, brotliCompressSync(source, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
    })),
    fs.writeFile(`${sourcePath}.gz`, gzipSync(source, { level: 9 })),
  ]);
}));
