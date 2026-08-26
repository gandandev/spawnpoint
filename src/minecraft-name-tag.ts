import { CanvasTexture, NearestFilter, Sprite, SpriteMaterial } from "three";

const FONT_ROOT = "/fonts/minecraft-1.12";
const FONT_HEIGHT = 16;
const MARGIN_X = 4;
const MARGIN_Y = 2;

let glyphSizesPromise: Promise<Uint8Array> | null = null;
const pagePromises = new Map<number, Promise<HTMLImageElement>>();

function loadGlyphSizes(): Promise<Uint8Array> {
  glyphSizesPromise ??= fetch(`${FONT_ROOT}/glyph_sizes.bin`)
    .then((response) => {
      if (!response.ok) throw new Error(`Minecraft glyph sizes failed to load: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const sizes = new Uint8Array(buffer);
      if (sizes.length !== 65_536) throw new Error("Minecraft glyph sizes have an invalid length");
      return sizes;
    });
  return glyphSizesPromise;
}

function loadPage(page: number): Promise<HTMLImageElement> {
  const cached = pagePromises.get(page);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Minecraft font page ${page.toString(16)} failed to load`));
    image.src = `${FONT_ROOT}/unicode_page_${page.toString(16).padStart(2, "0")}.png`;
  });
  pagePromises.set(page, promise);
  return promise;
}

interface BitmapGlyph {
  character: string;
  codePoint: number;
  image: HTMLImageElement | null;
  start: number;
  width: number;
  advance: number;
}

export async function createMinecraftNameTag(text: string): Promise<Sprite> {
  const sizes = await loadGlyphSizes();
  const characters = Array.from(text);
  const pages = [...new Set(characters
    .map((character) => character.codePointAt(0)!)
    .filter((codePoint) => codePoint <= 0xffff && codePoint !== 0x20 && sizes[codePoint] !== 0)
    .map((codePoint) => codePoint >>> 8))];
  const loadedPages = new Map<number, HTMLImageElement>();
  await Promise.all(pages.map(async (page) => {
    try {
      loadedPages.set(page, await loadPage(page));
    } catch {
      // Characters outside Minecraft's bundled pages use the browser fallback below.
    }
  }));
  const measurementCanvas = document.createElement("canvas");
  const measurementContext = measurementCanvas.getContext("2d");
  if (!measurementContext) throw new Error("Canvas 2D is unavailable");
  measurementContext.font = "16px monospace";

  const glyphs: BitmapGlyph[] = characters.map((character) => {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x20) return { character, codePoint, image: null, start: 0, width: 0, advance: 8 };
    if (codePoint <= 0xffff) {
      const size = sizes[codePoint];
      const image = loadedPages.get(codePoint >>> 8) ?? null;
      if (size !== 0 && image) {
        const start = size >>> 4;
        const end = (size & 0x0f) + 1;
        const width = end - start;
        return { character, codePoint, image, start, width, advance: width + 2 };
      }
    }
    const width = Math.max(1, Math.ceil(measurementContext.measureText(character).width));
    return { character, codePoint, image: null, start: 0, width, advance: width };
  });

  const canvas = document.createElement("canvas");
  canvas.width = MARGIN_X * 2 + glyphs.reduce((total, glyph) => total + glyph.advance, 0);
  canvas.height = MARGIN_Y * 2 + FONT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "rgba(0, 0, 0, 0.25)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "white";
  context.font = "16px monospace";
  context.textBaseline = "top";

  let x = MARGIN_X;
  for (const glyph of glyphs) {
    if (glyph.image) {
      const cellX = (glyph.codePoint & 0x0f) * 16;
      const cellY = ((glyph.codePoint >>> 4) & 0x0f) * 16;
      context.drawImage(
        glyph.image,
        cellX + glyph.start,
        cellY,
        glyph.width,
        FONT_HEIGHT,
        x,
        MARGIN_Y,
        glyph.width,
        FONT_HEIGHT,
      );
    } else if (glyph.codePoint !== 0x20) {
      context.fillText(glyph.character, x, MARGIN_Y);
    }
    x += glyph.advance;
  }

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  const material = new SpriteMaterial({ map: texture, transparent: true, alphaTest: 1e-5 });
  const sprite = new Sprite(material);
  sprite.scale.set((canvas.width / canvas.height) * 4, 4, 1);
  return sprite;
}
