import { useEffect, useRef } from "react";

interface SkinPreviewProps {
  src: string;
  model: "steve" | "alex";
  nameTag?: string;
  className?: string;
}

export function SkinPreview({ src, model, nameTag, className }: SkinPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let cancelled = false;
    let disposeViewer: (() => void) | undefined;

    void import("skin3d").then(({ Render, WalkingAnimation }) => {
      if (cancelled) return;

      const viewer = new Render({
        canvas,
        width: Math.max(container.clientWidth, 280),
        height: Math.max(container.clientHeight, 320),
        skin: src,
        model: model === "alex" ? "slim" : "default",
        animation: new WalkingAnimation(),
        zoom: 0.66,
      });

      if (nameTag) viewer.nameTag = nameTag;
      viewer.playerWrapper.position.y = -2;

      if (viewer.animation) viewer.animation.speed = 1.35;
      viewer.controls.enablePan = false;
      viewer.controls.enableRotate = true;
      viewer.controls.enableZoom = true;
      viewer.controls.enableDamping = true;
      viewer.controls.dampingFactor = 0.08;

      const resizeObserver = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) viewer.setSize(width, height);
      });
      resizeObserver.observe(container);

      disposeViewer = () => {
        resizeObserver.disconnect();
        viewer.dispose();
      };
    });

    return () => {
      cancelled = true;
      disposeViewer?.();
    };
  }, [src, model, nameTag]);

  return (
    <div ref={containerRef} className={className}>
      <canvas ref={canvasRef} className="size-full touch-none" aria-label={`${model} 3D 스킨 미리보기`} />
    </div>
  );
}
