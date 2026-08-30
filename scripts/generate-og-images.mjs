import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const width = 1200;
const height = 630;
const publicDir = path.join(process.cwd(), "public");
const font = await fs.readFile(path.join(process.cwd(), "vendor", "fonts", "galmuri", "Galmuri11.woff2"));
const fontData = font.toString("base64");

const sites = [
  { name: "spawnpoint", files: ["og-image.jpg", "og-image-spawnpoint.jpg"], fontSize: 88 },
  { name: "예게.서버.한국", files: ["og-image-yege.jpg"], fontSize: 82 },
  { name: "베이컨.서버.한국", files: ["og-image-bacon.jpg"], fontSize: 82 },
];

function backgroundSvg() {
  const blocks = [
    [48, 42, 48, 0.08], [104, 42, 48, 0.04], [1048, 90, 48, 0.05], [1104, 90, 48, 0.09],
    [0, 490, 48, 0.05], [48, 538, 48, 0.09], [1104, 490, 48, 0.06], [1152, 538, 48, 0.1],
  ].map(([x, y, size, opacity]) => `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#96ce4d" opacity="${opacity}"/>`).join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="64%">
          <stop offset="0" stop-color="#172a18"/>
          <stop offset="0.52" stop-color="#0c160e"/>
          <stop offset="1" stop-color="#050806"/>
        </radialGradient>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="#96ce4d" stroke-opacity="0.035"/>
        </pattern>
      </defs>
      <rect width="1200" height="630" fill="#050806"/>
      <rect width="1200" height="630" fill="url(#glow)"/>
      <rect width="1200" height="630" fill="url(#grid)"/>
      ${blocks}
    </svg>
  `);
}

function logoSvg() {
  return Buffer.from(`
    <svg width="150" height="150" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#96ce4d" fill-rule="evenodd" d="M0 0h18v13H13v5H0zM4 4v7h7V4z"/>
    </svg>
  `);
}

function textSvg(name, fontSize) {
  return Buffer.from(`
    <svg width="920" height="160" xmlns="http://www.w3.org/2000/svg">
      <style>
        @font-face {
          font-family: "Galmuri11";
          src: url("data:font/woff2;base64,${fontData}") format("woff2");
          font-weight: 700;
        }
        text {
          font-family: "Galmuri11";
          font-size: ${fontSize}px;
          font-weight: 700;
          letter-spacing: 1px;
          paint-order: stroke fill;
          stroke: #f0f7ec;
          stroke-width: 2px;
          stroke-linejoin: round;
        }
      </style>
      <text x="12" y="116" fill="#f0f7ec">${name}</text>
    </svg>
  `);
}

const background = await sharp(backgroundSvg()).png().toBuffer();
const logo = await sharp(logoSvg()).png().toBuffer();

await Promise.all(sites.map(async ({ name, files, fontSize }) => {
  const text = await sharp(textSvg(name, fontSize)).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const textMetadata = await sharp(text).metadata();
  const textWidth = textMetadata.width ?? 0;
  const textHeight = textMetadata.height ?? 0;
  const gap = 46;
  const groupWidth = 150 + gap + textWidth;
  const left = Math.round((width - groupWidth) / 2);

  const image = await sharp(background)
    .composite([
      { input: logo, left, top: Math.round((height - 150) / 2) },
      { input: text, left: left + 150 + gap, top: Math.round((height - textHeight) / 2) },
    ])
    .jpeg({ quality: 92, progressive: true, chromaSubsampling: "4:4:4" })
    .toBuffer();

  await Promise.all(files.map((file) => fs.writeFile(path.join(publicDir, file), image)));
}));
