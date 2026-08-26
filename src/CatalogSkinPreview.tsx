import { useEffect, useState } from "react";

let skin3dModule: Promise<typeof import("skin3d")> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
const renderCache = new Map<string, Promise<string>>();

function loadSkin3d() {
  skin3dModule ??= import("skin3d");
  return skin3dModule;
}

function renderSkin(src: string): Promise<string> {
  const cached = renderCache.get(src);
  if (cached) return cached;

  const rendered = renderQueue.then(async () => {
    const { Render } = await loadSkin3d();
    const canvas = document.createElement("canvas");
    const viewer = new Render({
      canvas,
      width: 192,
      height: 304,
      pixelRatio: 1,
      preserveDrawingBuffer: true,
      renderPaused: true,
      enableRotation: false,
      allowZoom: false,
      fov: 42,
      zoom: 0.82,
    });
    try {
      viewer.controls.enabled = false;
      viewer.playerWrapper.position.y = -1.5;
      viewer.playerObject.skin.setOuterLayerVisible(true);
      const distance = viewer.camera.position.length();
      viewer.camera.position.set(0.43, 0.16, 0.89).normalize().multiplyScalar(distance);
      viewer.camera.lookAt(0, 0, 0);
      await viewer.loadSkin(src, { model: "auto-detect" });
      viewer.render();
      return canvas.toDataURL("image/png");
    } finally {
      viewer.dispose();
      viewer.renderer.forceContextLoss();
    }
  });
  renderQueue = rendered.then(() => undefined, () => undefined);
  renderCache.set(src, rendered);
  rendered.catch(() => renderCache.delete(src));
  return rendered;
}

export function CatalogSkinPreview({ src }: { src: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!container || visible) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, {
      root: container.closest('[aria-label="유명 스킨"]'),
      rootMargin: "200px 0px",
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void renderSkin(src).then((result) => {
      if (active) setImage(result);
    }).catch(() => {
      if (active) setImage(src);
    });
    return () => {
      active = false;
    };
  }, [src, visible]);

  return <div ref={setContainer} className="flex h-40 w-full items-center justify-center">
    {image ? <img src={image} alt="" width="192" height="304" className="h-40 w-auto max-w-full object-contain [image-rendering:pixelated]" /> : <span className="h-32 w-16 animate-pulse rounded-md bg-muted" aria-hidden="true" />}
  </div>;
}
