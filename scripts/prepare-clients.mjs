import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const clients = [
  ["stable", "stable-source.html"],
];
const loadingImage = "/game/loading.webp";
const loadingBackgroundPattern = /center \/ contain no-repeat url\("data:image\/png;base64,[^"]+"\)/g;
const epwDataUriPattern = /data:application\/octet-stream;base64,[A-Za-z0-9+/=]+/g;
const bridgeTag = `
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
<script src="/game/portal-bridge.js?v=20260711-korean-locale-v13"></script>
`;

await fs.mkdir(path.join(root, "public/game"), { recursive: true });
const patchedEpw = await fs.readFile(path.join(root, "vendor/clients/stable-locale-fixed.epw"));
const patchedEpwDataUri = `data:application/octet-stream;base64,${patchedEpw.toString("base64")}`;

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
  const patchedInput = input.replace(epwDataUriPattern, patchedEpwDataUri);
  const brandedInput = patchedInput.replace(
    loadingBackgroundPattern,
    `center / cover no-repeat url("${loadingImage}")`,
  );
  const output = brandedInput.slice(0, scriptEnd + 9) + bridgeTag + brandedInput.slice(scriptEnd + 9);
  await fs.writeFile(outputPath, output, "utf8");
  console.log(`${name}: ${input.length.toLocaleString()} chars, loading screens and bridge injected`);
}
