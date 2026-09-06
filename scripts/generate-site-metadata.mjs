import fs from "node:fs/promises";
import path from "node:path";

import { resolveBuildNumber } from "./build-number.mjs";
import { validateReleaseNote } from "./release-note.mjs";

const release = JSON.parse(await fs.readFile("src/release-note.json", "utf8"));
validateReleaseNote(release, process.env.RAILWAY_GIT_COMMIT_SHA ? `v${resolveBuildNumber()}` : undefined);

const clientDir = path.join(process.cwd(), "dist", "client");
await fs.writeFile(path.join(clientDir, "frontend-version.json"), JSON.stringify(release));
const source = await fs.readFile(path.join(clientDir, "index.html"), "utf8");

const sites = [
  {
    key: "yege",
    title: "예게.서버.한국",
    origin: "https://xn--o79a769b.xn--hk3b17f.xn--3e0b707e",
    image: "og-image-yege.jpg",
    output: "index-yege.html",
  },
  {
    key: "bacon",
    title: "베이컨.서버.한국",
    origin: "https://xn--9k3b21rt2f.xn--hk3b17f.xn--3e0b707e",
    image: "og-image-bacon.jpg",
    output: "index-bacon.html",
  },
];

function replaceMeta(html, attribute, key, value) {
  const pattern = new RegExp(`(<meta ${attribute}="${key}" content=")[^"]*("\\s*/?>)`);
  if (!pattern.test(html)) throw new Error(`Missing ${key} metadata in built index`);
  return html.replace(pattern, `$1${value}$2`);
}

function insertAfter(html, marker, value) {
  if (!html.includes(marker)) throw new Error(`Missing metadata marker: ${marker}`);
  return html.replace(marker, `${marker}\n    ${value}`);
}

const manifest = JSON.parse(await fs.readFile(path.join(clientDir, "manifest.webmanifest"), "utf8"));
for (const site of sites) {
  await fs.writeFile(path.join(clientDir, `manifest-${site.key}.webmanifest`), JSON.stringify({ ...manifest, name: site.title, short_name: site.title }));
  let html = source.replace(/<title>[^<]*<\/title>/, `<title>${site.title}</title>`);
  html = html.replace('href="/manifest.webmanifest"', `href="/manifest-${site.key}.webmanifest"`);
  html = replaceMeta(html, "name", "apple-mobile-web-app-title", site.title);
  const imageAlt = `셰이더가 적용된 블록 풍경 위에 검정 로고와 흰 테두리의 ${site.title} 문구가 놓인 이미지`;
  html = insertAfter(html, '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />', `<link rel="canonical" href="${site.origin}/" />`);
  html = insertAfter(html, '<meta property="og:type" content="website" />', `<meta property="og:url" content="${site.origin}/" />`);
  html = replaceMeta(html, "property", "og:site_name", site.title);
  html = replaceMeta(html, "property", "og:title", site.title);
  html = replaceMeta(html, "property", "og:image", `${site.origin}/${site.image}`);
  html = replaceMeta(html, "property", "og:image:alt", imageAlt);
  html = replaceMeta(html, "name", "twitter:title", site.title);
  html = replaceMeta(html, "name", "twitter:image", `${site.origin}/${site.image}`);
  html = replaceMeta(html, "name", "twitter:image:alt", imageAlt);
  await fs.writeFile(path.join(clientDir, site.output), html);
}
