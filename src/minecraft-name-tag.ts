import { CanvasTexture, NearestFilter, Sprite, SpriteMaterial } from "three";

const FONT_SIZE = 16;
const FONT = `${FONT_SIZE}px "Spawnpoint Mark"`;
const PADDING = 4;

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

  context.imageSmoothingEnabled = false;
  context.fillStyle = "rgba(0, 0, 0, 0.25)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "white";
  context.font = FONT;
  context.textBaseline = "alphabetic";
  context.fillText(text, PADDING + metrics.actualBoundingBoxLeft, PADDING + metrics.actualBoundingBoxAscent);

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  const material = new SpriteMaterial({ map: texture, transparent: true, alphaTest: 1e-5 });
  const sprite = new Sprite(material);
  sprite.scale.set((canvas.width / canvas.height) * 4, 4, 1);
  return sprite;
}
