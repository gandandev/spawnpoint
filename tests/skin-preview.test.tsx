// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkinPreview } from "../src/SkinPreview";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  viewers: [] as Array<{
    animation: { paused: boolean; speed: number } | null;
    renderPaused: boolean;
  }>,
}));

vi.mock("skin3d", () => {
  class WalkingAnimation {
    paused = false;
    speed = 0;
  }

  class Render {
    animation: WalkingAnimation | null;
    renderPaused = false;
    controls = {
      enablePan: true,
      enableRotate: false,
      enableZoom: false,
      enableDamping: false,
      dampingFactor: 0,
    };
    playerWrapper = { position: { y: 0 } };
    nameTag: unknown;

    constructor(options: { animation?: WalkingAnimation }) {
      this.animation = options.animation ?? null;
      mocks.viewers.push(this);
    }

    setSize() {}
    render() {}
    dispose() {}
  }

  return { Render, WalkingAnimation };
});

vi.mock("../src/minecraft-name-tag", () => ({
  createMinecraftNameTag: vi.fn(),
}));

describe("SkinPreview", () => {
  let intersectionCallback: IntersectionObserverCallback | null;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.viewers.length = 0;
    intersectionCallback = null;

    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "0px";
      thresholds = [0];
    });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps moving after the pointer leaves and is released outside", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SkinPreview src="/skin.png" model="steve" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const preview = host.firstElementChild!;
    preview.dispatchEvent(new Event("pointerleave"));
    document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));
    act(() => vi.advanceTimersByTime(1_000));

    expect(mocks.viewers).toHaveLength(1);
    expect(mocks.viewers[0].animation?.paused).toBe(false);
    expect(mocks.viewers[0].renderPaused).toBe(false);

    act(() => {
      intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(mocks.viewers[0].animation?.paused).toBe(true);
    expect(mocks.viewers[0].renderPaused).toBe(true);

    act(() => root.unmount());
  });

  it("pauses the background renderer while an overlapping dialog is open", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SkinPreview src="/skin.png" model="steve" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.viewers[0].renderPaused).toBe(false);

    await act(async () => root.render(<SkinPreview src="/skin.png" model="steve" paused />));
    expect(mocks.viewers[0].renderPaused).toBe(true);
    expect(mocks.viewers[0].animation?.paused).toBe(true);

    await act(async () => root.render(<SkinPreview src="/skin.png" model="steve" paused={false} />));
    expect(mocks.viewers[0].renderPaused).toBe(false);
    expect(mocks.viewers[0].animation?.paused).toBe(false);

    act(() => root.unmount());
  });
});
