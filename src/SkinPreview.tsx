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
    let disposeNameTag: (() => void) | undefined;

    void Promise.all([import("skin3d"), import("./minecraft-name-tag")]).then(([{ Render, WalkingAnimation }, { createMinecraftNameTag }]) => {
      if (cancelled) return;

      const viewer = new Render({
        canvas,
        width: Math.max(container.clientWidth, 280),
        height: Math.max(container.clientHeight, 320),
        skin: src,
        model: model === "alex" ? "slim" : "default",
        animation: new WalkingAnimation(),
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        zoom: 0.66,
      });

      if (nameTag) {
        void createMinecraftNameTag(nameTag)
          .then((tag) => {
            if (cancelled) {
              tag.material.map?.dispose();
              tag.material.dispose();
              return;
            }
            disposeNameTag = () => {
              tag.material.map?.dispose();
              tag.material.dispose();
            };
            viewer.nameTag = tag as never;
          })
          .catch(() => {
            if (!cancelled) viewer.nameTag = nameTag;
          });
      }
      viewer.playerWrapper.position.y = -2;

      if (viewer.animation) viewer.animation.speed = 1.35;
      viewer.controls.enablePan = false;
      viewer.controls.enableRotate = true;
      viewer.controls.enableZoom = true;
      viewer.controls.enableDamping = true;
      viewer.controls.dampingFactor = 0.08;

      let visible = true;
      let lastWidth = 0;
      let lastHeight = 0;
      const updateAnimationState = () => {
        const paused = document.hidden || !visible;
        if (viewer.animation) viewer.animation.paused = paused;
        viewer.renderPaused = paused;
      };
      const intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        updateAnimationState();
      });
      const resizeObserver = new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
          lastWidth = width;
          lastHeight = height;
          viewer.setSize(width, height);
          if (viewer.renderPaused) viewer.render();
        }
      });
      intersectionObserver.observe(container);
      resizeObserver.observe(container);
      document.addEventListener("visibilitychange", updateAnimationState);
      updateAnimationState();

      disposeViewer = () => {
        document.removeEventListener("visibilitychange", updateAnimationState);
        intersectionObserver.disconnect();
        resizeObserver.disconnect();
        viewer.dispose();
      };
    });

    return () => {
      cancelled = true;
      disposeNameTag?.();
      disposeViewer?.();
    };
  }, [src, model, nameTag]);

  return (
    <div ref={containerRef} className={className}>
      <canvas ref={canvasRef} className="size-full touch-pan-y" aria-label={`${model} 3D 스킨 미리보기`} />
    </div>
  );
}
