import fs from "node:fs/promises";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";
import {
  loadMinecraftAsciiAtlas,
  renderMinecraftAsciiText,
} from "./minecraft-ascii-font.mjs";

const width = 1200;
const height = 630;
const outlineWidth = 12;
const publicDir = path.join(process.cwd(), "public");
const backgroundDir = path.join(process.cwd(), "vendor", "og");
const fontPath = path.join(process.cwd(), "vendor", "fonts", "galmuri", "Galmuri11.ttf");
const clientPath = path.join(process.cwd(), "vendor", "clients", "stable-locale-fixed.epw");
const fontBuffer = await fs.readFile(fontPath);
const galmuri = opentype.parse(
  fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength),
);
const minecraftAsciiAtlas = await loadMinecraftAsciiAtlas(clientPath);
const backgroundFiles = [
  "forest-pond.jpg",
  "garden-cottage.jpg",
  "birch-lantern-path.jpg",
  "pond-bench.jpg",
  "cherry-grove.jpg",
  "flower-garden-path.jpg",
  "koi-pond.jpg",
];

const sites = [
  {
    key: "spawnpoint",
    name: "spawnpoint",
    files: ["og-image.jpg", "og-image-spawnpoint.jpg"],
    fontSize: 82,
    fallbackBackgroundIndex: 0,
  },
  {
    key: "yege",
    name: "예게.서버.한국",
    files: ["og-image-yege.jpg"],
    fontSize: 76,
    fallbackBackgroundIndex: 1,
  },
  {
    key: "bacon",
    name: "베이컨.서버.한국",
    files: ["og-image-bacon.jpg"],
    fontSize: 76,
    fallbackBackgroundIndex: 2,
  },
];

function logoSvg(logoSize) {
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

async function renderGalmuriText(name, fontSize) {
  const glyphs = galmuri.getPath(name, 0, fontSize, fontSize, { hinting: true });
  const bounds = glyphs.getBoundingBox();
  const padding = outlineWidth + 1;
  const textWidth = Math.ceil(bounds.x2 - bounds.x1 + padding * 2);
  const textHeight = Math.ceil(bounds.y2 - bounds.y1 + padding * 2);
  const translateX = padding - bounds.x1;
  const translateY = padding - bounds.y1;
  const pathData = glyphs.toPathData({ decimalPlaces: 2, flipY: false, optimize: true });
  const textSvg = Buffer.from(`
    <svg width="${textWidth}" height="${textHeight}" xmlns="http://www.w3.org/2000/svg">
      <path
        d="${pathData}"
        transform="translate(${translateX} ${translateY})"
        fill="#090909"
        stroke="#ffffff"
        stroke-width="${outlineWidth * 2}"
        stroke-linejoin="miter"
        paint-order="stroke fill"
      />
    </svg>
  `);

  return sharp(textSvg)
    .png()
    .toBuffer();
}

async function renderText(name, fontSize) {
  if (/^[\x20-\x7e]+$/.test(name)) {
    return addOutline(await renderMinecraftAsciiText(minecraftAsciiAtlas, name, fontSize));
  }
  return renderGalmuriText(name, fontSize);
}

async function renderBackground(file) {
  return sharp(path.join(backgroundDir, file))
    .resize(width, height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

const backgrounds = await Promise.all(backgroundFiles.map(renderBackground));

await Promise.all(sites.map(async ({ key, name, files, fontSize, fallbackBackgroundIndex }) => {
  const text = await renderText(name, fontSize);
  const textMetadata = await sharp(text).metadata();
  const textWidth = textMetadata.width ?? 0;
  const textHeight = textMetadata.height ?? 0;
  const logoSize = Math.max(1, textHeight - outlineWidth * 2);
  const logo = await addOutline(await sharp(logoSvg(logoSize)).png().toBuffer());
  const logoMetadata = await sharp(logo).metadata();
  const renderedLogoWidth = logoMetadata.width ?? 0;
  const renderedLogoHeight = logoMetadata.height ?? 0;
  const gap = 28;
  const groupWidth = renderedLogoWidth + gap + textWidth;
  const left = Math.round((width - groupWidth) / 2);

  const variants = await Promise.all(backgrounds.map((background) => sharp(background)
      .composite([
        { input: logo, left, top: Math.round((height - renderedLogoHeight) / 2) },
        { input: text, left: left + renderedLogoWidth + gap, top: Math.round((height - textHeight) / 2) },
      ])
      .jpeg({ quality: 92, progressive: true, chromaSubsampling: "4:4:4" })
      .toBuffer()));

  await fs.mkdir(path.join(publicDir, "og"), { recursive: true });
  await Promise.all(backgroundFiles.map((backgroundFile, index) => {
    const backgroundName = path.parse(backgroundFile).name;
    return fs.writeFile(path.join(publicDir, "og", `${key}-${backgroundName}.jpg`), variants[index]);
  }));

  await Promise.all(files.map((file) => (
    fs.writeFile(path.join(publicDir, file), variants[fallbackBackgroundIndex])
  )));
}));
