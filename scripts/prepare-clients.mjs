import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";

const root = process.cwd();
const clients = [
  ["stable", "stable-source.html"],
];
const loadingImage = "/game/loading.webp";
const gameClient = JSON.parse(await fs.readFile(path.join(root, "src/game-client.json"), "utf8"));
if (!/^[A-Za-z0-9_-]{1,80}$/.test(gameClient.cacheVersion)) {
  throw new Error("src/game-client.json has an invalid cacheVersion");
}
const loadingBackgroundPattern = /center \/ contain no-repeat url\("data:image\/png;base64,[^"]+"\)/g;
const epwDataUriPattern = /data:application\/octet-stream;base64,[A-Za-z0-9+/=]+/g;
const clientMainCall = "setTimeout(function() { document.body.removeChild(document.getElementById(\"launch_countdown_screen\")); document.body.style.backgroundColor = \"black\"; main(); }, 50);";
const preparedClientMainCall = `setTimeout(function() {
  document.body.removeChild(document.getElementById("launch_countdown_screen"));
  document.body.style.backgroundColor = "black";
  Promise.resolve(window.__spawnpointPrepareClient).catch(function(error) {
    console.warn("Spawnpoint client preparation failed", error);
  }).then(function() {
    main();
  });
}, 50);`;
const bridgeTag = (epwUrl) => `
<link rel="preload" href="${epwUrl}" as="fetch" crossorigin="anonymous">
<style>
._eaglercraftX_early_splash_element {
  background: center / cover no-repeat url("${loadingImage}") !important;
  image-rendering: auto !important;
}
</style>
<script>
window.addEventListener("load", function () {
  setTimeout(function () {
    document.getElementById("skipCountdown")?.click();
  }, 0);
});
</script>
<script src="/game/resource-pack-bridge.js?v=${gameClient.cacheVersion}"></script>
<script src="/game/portal-bridge.js?v=${gameClient.cacheVersion}"></script>
`;

await fs.mkdir(path.join(root, "public/game"), { recursive: true });
await fs.mkdir(path.join(root, "public/game/fonts"), { recursive: true });
await Promise.all([
  fs.copyFile(
    path.join(root, "vendor/fonts/galmuri/Galmuri11.ttf"),
    path.join(root, "public/game/fonts/Galmuri11.ttf"),
  ),
  fs.copyFile(
    path.join(root, "vendor/fonts/galmuri/Galmuri11.woff2"),
    path.join(root, "public/game/fonts/Galmuri11.woff2"),
  ),
]);
const patchedEpw = await fs.readFile(path.join(root, "vendor/clients/stable-galmuri.epw"));
const epwHash = createHash("sha256").update(patchedEpw).digest("hex").slice(0, 16);
const epwFileName = `stable-${epwHash}.epw`;
const epwUrl = `/game/${epwFileName}`;
await fs.writeFile(path.join(root, "public/game", epwFileName), patchedEpw);

const generatedEpwPattern = /^stable-[0-9a-f]{16}\.epw$/;
for (const entry of await fs.readdir(path.join(root, "public/game"), { withFileTypes: true })) {
  if (entry.isFile() && generatedEpwPattern.test(entry.name) && entry.name !== epwFileName) {
    await fs.unlink(path.join(root, "public/game", entry.name));
  }
}

for (const [name, sourceName] of clients) {
  const sourcePath = path.join(root, "vendor/clients", sourceName);
  const outputPath = path.join(root, "public/game", `${name}.html`);
  const input = await fs.readFile(sourcePath, "utf8");
  const optionsIndex = Math.max(input.indexOf("window.eaglercraftXOpts ="), input.indexOf("window.eaglercraftXOptsHints ="));
  if (optionsIndex < 0) throw new Error(`${sourceName} has no Eaglercraft launch options`);
  const scriptEnd = input.indexOf("</script>", optionsIndex);
  if (scriptEnd < 0) throw new Error(`${sourceName} has an unterminated launch-options script`);
  const loadingBackgrounds = input.match(loadingBackgroundPattern);
  if (loadingBackgrounds?.length !== 1) {
    throw new Error(`${sourceName} has ${loadingBackgrounds?.length ?? 0} loading backgrounds, expected exactly 1`);
  }
  const epwDataUris = input.match(epwDataUriPattern);
  if (epwDataUris?.length !== 1) {
    throw new Error(`${sourceName} has ${epwDataUris?.length ?? 0} EPW data URIs, expected exactly 1`);
  }
  if (input.split(clientMainCall).length !== 2) {
    throw new Error(`${sourceName} does not contain exactly one supported client main call`);
  }
  const patchedInput = input
    .replace(epwDataUriPattern, epwUrl)
    .replace(clientMainCall, preparedClientMainCall);
  const brandedInput = patchedInput.replace(
    loadingBackgroundPattern,
    `center / cover no-repeat url("${loadingImage}")`,
  );
  const output = brandedInput.slice(0, scriptEnd + 9) + bridgeTag(epwUrl) + brandedInput.slice(scriptEnd + 9);
  await fs.writeFile(outputPath, output, "utf8");
  const outputBuffer = Buffer.from(output, "utf8");
  await Promise.all([
    fs.writeFile(`${outputPath}.br`, brotliCompressSync(outputBuffer, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
    })),
    fs.writeFile(`${outputPath}.gz`, gzipSync(outputBuffer, { level: 9 })),
  ]);
  console.log(`${name}: ${output.length.toLocaleString()} chars, external EPW ${epwFileName}, loading screens and bridge injected with Brotli and gzip variants`);
}
