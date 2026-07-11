import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const clients = [
  ["stable", "stable-source.html"],
  ["experimental", "experimental-source.html"],
  ["lite", "lite-source.html"],
];
const bridgeTag = '\n<script src="/game/portal-bridge.js"></script>\n';

await fs.mkdir(path.join(root, "public/game"), { recursive: true });

for (const [name, sourceName] of clients) {
  const sourcePath = path.join(root, "vendor/clients", sourceName);
  const outputPath = path.join(root, "public/game", `${name}.html`);
  const input = await fs.readFile(sourcePath, "utf8");
  const optionsIndex = Math.max(input.indexOf("window.eaglercraftXOpts ="), input.indexOf("window.eaglercraftXOptsHints ="));
  if (optionsIndex < 0) throw new Error(`${sourceName} has no Eaglercraft launch options`);
  const scriptEnd = input.indexOf("</script>", optionsIndex);
  if (scriptEnd < 0) throw new Error(`${sourceName} has an unterminated launch-options script`);
  const output = input.slice(0, scriptEnd + 9) + bridgeTag + input.slice(scriptEnd + 9);
  await fs.writeFile(outputPath, output, "utf8");
  console.log(`${name}: ${input.length.toLocaleString()} chars, bridge injected`);
}

