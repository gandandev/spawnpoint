import fs from "node:fs/promises";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const width = 1200;
const height = 630;
const outlineWidth = 9;
const publicDir = path.join(process.cwd(), "public");
const backgroundDir = path.join(process.cwd(), "vendor", "og");
const fontPath = path.join(process.cwd(), "vendor", "fonts", "galmuri", "Galmuri11.ttf");
const fontBuffer = await fs.readFile(fontPath);
const galmuri = opentype.parse(
  fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength),
);

const sites = [
  {
    name: "spawnpoint",
    files: ["og-image.jpg", "og-image-spawnpoint.jpg"],
    fontSize: 82,
    panels: [
      { file: "forest-pond.jpg", left: 0, top: 0, width: 720, height: 630 },
      { file: "cherry-grove.jpg", left: 720, top: 0, width: 480, height: 315 },
      { file: "koi-pond.jpg", left: 720, top: 315, width: 480, height: 315 },
    ],
  },
  {
    name: "예게.서버.한국",
    files: ["og-image-yege.jpg"],
    fontSize: 76,
    panels: [
      { file: "garden-cottage.jpg", left: 0, top: 0, width: 720, height: 630 },
      { file: "birch-lantern-path.jpg", left: 720, top: 0, width: 480, height: 315 },
      { file: "pond-bench.jpg", left: 720, top: 315, width: 480, height: 315 },
    ],
  },
  {
    name: "베이컨.서버.한국",
    files: ["og-image-bacon.jpg"],
    fontSize: 76,
    panels: [
      { file: "flower-garden-path.jpg", left: 0, top: 0, width: 720, height: 630 },
      { file: "cherry-grove.jpg", left: 720, top: 0, width: 480, height: 315 },
      { file: "koi-pond.jpg", left: 720, top: 315, width: 480, height: 315 },
    ],
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

async function renderText(name, fontSize) {
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

async function renderBackground(panels) {
  const images = await Promise.all(panels.map(async (panel) => ({
    input: await sharp(path.join(backgroundDir, panel.file))
      .resize(panel.width, panel.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer(),
    left: panel.left,
    top: panel.top,
  })));

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#000000",
    },
  })
    .composite(images)
    .png()
    .toBuffer();
}

await Promise.all(sites.map(async ({ name, files, fontSize, panels }) => {
  const [background, text] = await Promise.all([
    renderBackground(panels),
    renderText(name, fontSize),
  ]);
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

  const image = await sharp(background)
    .composite([
      { input: logo, left, top: Math.round((height - renderedLogoHeight) / 2) },
      { input: text, left: left + renderedLogoWidth + gap, top: Math.round((height - textHeight) / 2) },
    ])
    .jpeg({ quality: 92, progressive: true, chromaSubsampling: "4:4:4" })
    .toBuffer();

  await Promise.all(files.map((file) => fs.writeFile(path.join(publicDir, file), image)));
}));
