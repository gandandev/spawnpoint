import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const checkoutKey = Buffer.from(process.cwd()).toString("base64url");
const fontCacheDir = path.join(os.tmpdir(), "spawnpoint-font-cache", checkoutKey);
const fontConfigPath = path.join(fontCacheDir, "fonts.conf");
const fontDirectory = path.join(process.cwd(), "vendor", "fonts", "galmuri");

await fs.mkdir(fontCacheDir, { recursive: true });
await fs.writeFile(fontConfigPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${fontDirectory}</dir>
  <cachedir>${fontCacheDir}</cachedir>
</fontconfig>
`);
process.env.FONTCONFIG_FILE = fontConfigPath;
process.env.XDG_CACHE_HOME = fontCacheDir;

const { default: sharp } = await import("sharp");

const width = 1200;
const height = 630;
const logoSize = 92;
const outlineWidth = 9;
const publicDir = path.join(process.cwd(), "public");
const backgroundPath = path.join(process.cwd(), "vendor", "og", "reddit-warm-nitrogen-20.png");
const fontPath = path.join(process.cwd(), "vendor", "fonts", "galmuri", "Galmuri11.ttf");

const sites = [
  { name: "spawnpoint", files: ["og-image.jpg", "og-image-spawnpoint.jpg"], fontSize: 88 },
  { name: "예게.서버.한국", files: ["og-image-yege.jpg"], fontSize: 82 },
  { name: "베이컨.서버.한국", files: ["og-image-bacon.jpg"], fontSize: 82 },
];

function logoSvg() {
  return Buffer.from(`
    <svg width="${logoSize}" height="${logoSize}" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#090909" fill-rule="evenodd" d="M0 0h18v13H13v5H0zM4 4v7h7V4z"/>
    </svg>
  `);
}

async function solidFromMask(mask, color) {
  const { width: maskWidth, height: maskHeight } = await sharp(mask).metadata();
  if (!maskWidth || !maskHeight) throw new Error("Cannot color an empty image mask");

  return sharp({
    create: {
      width: maskWidth,
      height: maskHeight,
      channels: 3,
      background: color,
    },
  })
    .joinChannel(mask)
    .png()
    .toBuffer();
}

async function addOutline(input) {
  const { width: inputWidth, height: inputHeight } = await sharp(input).metadata();
  if (!inputWidth || !inputHeight) throw new Error("Cannot outline an empty image");

  const fillMask = await sharp(input).extractChannel("alpha").png().toBuffer();
  const outlineMask = await sharp(fillMask)
    .extend({
      top: outlineWidth,
      right: outlineWidth,
      bottom: outlineWidth,
      left: outlineWidth,
      background: "#000000",
    })
    .extractChannel(0)
    // Sharp's morphology expands this white alpha mask with erode.
    .erode(outlineWidth)
    .png()
    .toBuffer();
  const outline = await solidFromMask(outlineMask, "#ffffff");
  const fill = await solidFromMask(fillMask, "#090909");

  return sharp({
    create: {
      width: inputWidth + outlineWidth * 2,
      height: inputHeight + outlineWidth * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: outline, left: 0, top: 0 },
      { input: fill, left: outlineWidth, top: outlineWidth },
    ])
    .png()
    .toBuffer();
}

async function renderText(name, fontSize) {
  const text = await sharp({
    text: {
      text: name,
      font: `Galmuri11 ${fontSize}`,
      fontfile: fontPath,
      dpi: 72,
      rgba: true,
    },
  })
    .png()
    .toBuffer();

  return addOutline(text);
}

const background = await sharp(backgroundPath)
  .resize(width, height, { fit: "cover", position: "centre" })
  .png()
  .toBuffer();
const logo = await addOutline(await sharp(logoSvg()).png().toBuffer());
const logoMetadata = await sharp(logo).metadata();
const renderedLogoWidth = logoMetadata.width ?? 0;
const renderedLogoHeight = logoMetadata.height ?? 0;

await Promise.all(sites.map(async ({ name, files, fontSize }) => {
  const text = await renderText(name, fontSize);
  const textMetadata = await sharp(text).metadata();
  const textWidth = textMetadata.width ?? 0;
  const textHeight = textMetadata.height ?? 0;
  const gap = 30;
  const groupWidth = renderedLogoWidth + gap + textWidth;
  const left = Math.round((width - groupWidth) / 2);

  const image = await sharp(background)
    .composite([
      { input: logo, left, top: Math.round((height - renderedLogoHeight) / 2) },
      { input: text, left: left + renderedLogoWidth + gap, top: Math.round((height - textHeight) / 2) },
    ])
    .jpeg({ quality: 92, progressive: true, chromaSubsampling: "4:4:4" })
    .toBuffer();

  await Promise.all(files.map((file) => fs.writeFile(path.join(publicDir, file), image)));
}));
