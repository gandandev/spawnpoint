import { useEffect, useRef } from "react";

interface SkinPreviewProps {
  src: string;
  model: "steve" | "alex";
  className?: string;
}

type Part = [number, number, number, number, number, number, number, number];

const parts: Part[] = [
  [8, 8, 8, 8, 48, 0, 64, 64],
  [20, 20, 8, 12, 48, 64, 64, 96],
  [44, 20, 4, 12, 112, 64, 32, 96],
  [36, 52, 4, 12, 16, 64, 32, 96],
  [4, 20, 4, 12, 48, 160, 32, 96],
  [20, 52, 4, 12, 80, 160, 32, 96],
];

const overlays: Part[] = [
  [40, 8, 8, 8, 44, -4, 72, 72],
  [20, 36, 8, 12, 46, 62, 68, 102],
  [44, 36, 4, 12, 110, 62, 36, 102],
  [52, 52, 4, 12, 14, 62, 36, 102],
  [4, 36, 4, 12, 46, 158, 36, 100],
  [4, 52, 4, 12, 78, 158, 36, 100],
];

function drawPart(context: CanvasRenderingContext2D, image: HTMLImageElement, part: Part): void {
  context.drawImage(image, ...part);
}

export function SkinPreview({ src, model, className }: SkinPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const part of parts) drawPart(context, image, part);
      if (image.naturalHeight === 64) {
        for (const part of overlays) drawPart(context, image, part);
      }
      if (model === "alex") {
        context.clearRect(16, 64, 4, 96);
        context.clearRect(140, 64, 4, 96);
      }
    };
    image.src = src;
    return () => { image.onload = null; };
  }, [src, model]);

  return <canvas ref={canvasRef} width={160} height={260} className={className} aria-label={`${model} skin preview`} />;
}

