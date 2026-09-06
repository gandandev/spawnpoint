import fs from 'node:fs/promises';
import sharp from 'sharp';
await fs.mkdir('public/icons', {recursive:true});
for (const size of [180,192,512]) {
 const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30"><path fill="#101512" d="M0 0h30v30H0z"/><path fill="#96ce4d" fill-rule="evenodd" transform="translate(6 6)" d="M0 0h18v13H13v5H0zM4 4v7h7V4z"/></svg>`);
 await sharp(svg).png().toFile(`public/icons/icon-${size}.png`);
}
