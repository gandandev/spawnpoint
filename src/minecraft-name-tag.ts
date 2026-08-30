import { CanvasTexture, NearestFilter, Sprite, SpriteMaterial } from "three";

const FONT_SIZE = 12;
const FONT = `${FONT_SIZE}px "Spawnpoint Mark"`;
const PADDING = 4;
const TEXT_ALPHA_CUTOFF = 128;

export function removeTextAntialiasing(pixels: Uint8ClampedArray): void {
  for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
    pixels[alphaIndex] = pixels[alphaIndex] >= TEXT_ALPHA_CUTOFF ? 255 : 0;
  }
}

export async function createMinecraftNameTag(text: string): Promise<Sprite> {
  await document.fonts.load(FONT, text);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");

  context.font = FONT;
  const metrics = context.measureText(text);
  const inkWidth = Math.max(1, Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight));
  const inkHeight = Math.max(1, Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent));
  canvas.width = PADDING * 2 + inkWidth;
  canvas.height = PADDING * 2 + inkHeight;

  const textCanvas = document.createElement("canvas");
  textCanvas.width = canvas.width;
  textCanvas.height = canvas.height;
  const textContext = textCanvas.getContext("2d");
  if (!textContext) throw new Error("Canvas 2D is unavailable");

  textContext.font = FONT;
  textContext.textBaseline = "alphabetic";
  textContext.fillStyle = "white";
  textContext.fillText(
    text,
    Math.round(PADDING + metrics.actualBoundingBoxLeft),
    Math.round(PADDING + metrics.actualBoundingBoxAscent),
  );
  const textPixels = textContext.getImageData(0, 0, textCanvas.width, textCanvas.height);
  removeTextAntialiasing(textPixels.data);
  textContext.putImageData(textPixels, 0, 0);

  context.imageSmoothingEnabled = false;
  context.fillStyle = "rgba(0, 0, 0, 0.25)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(textCanvas, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  const material = new SpriteMaterial({ map: texture, transparent: true, alphaTest: 1e-5 });
  const sprite = new Sprite(material);
  sprite.scale.set((canvas.width / canvas.height) * 4, 4, 1);
  return sprite;
}
