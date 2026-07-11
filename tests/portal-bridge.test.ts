import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const bridgeSource = fs.readFileSync(path.join(process.cwd(), "public/game/portal-bridge.js"), "utf8");

function loadBridge(gameSettings?: string, nativeBase64 = true) {
  const options: Record<string, unknown> = {};
  const handlers = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const storage = new Map<string, string>();
  if (gameSettings !== undefined) {
    storage.set("_spawnpoint_mossrunner.g", Buffer.from(gameSettings, "binary").toString("base64"));
  }
  const canvas = {
    width: 960,
    height: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
  };
  class FakeWebSocket {
    listeners = new Map<string, Array<() => void>>();

    addEventListener(name: string, listener: () => void) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }

    emit(name: string) {
      this.listeners.get(name)?.forEach((listener) => listener());
    }
  }
  const windowObject: Record<string, unknown> = {
    eaglercraftXOpts: options,
    Proxy,
    WebSocket: FakeWebSocket,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    location: {
      search: "?account=mossrunner&launch=launch-123",
      protocol: "https:",
      host: "spawnpoint.test",
      origin: "https://spawnpoint.test",
      pathname: "/game/stable.html",
    },
  };
  if (nativeBase64) {
    windowObject.atob = (value: string) => Buffer.from(value, "base64").toString("binary");
    windowObject.btoa = (value: string) => Buffer.from(value, "binary").toString("base64");
  }

  vm.runInNewContext(bridgeSource, {
    URLSearchParams,
    document: {
      title: "",
      addEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
        const listeners = handlers.get(name) ?? [];
        listeners.push(listener);
        handlers.set(name, listeners);
      },
      querySelector: () => canvas,
    },
    encodeURIComponent,
    history: { replaceState() {} },
    window: windowObject,
  });

  return {
    canvas,
    handlers,
    options,
    storage,
    windowObject,
  };
}

describe("portal game bridge", () => {
  it("ships the verified Minecraft 1.12 Korean language asset", () => {
    const locale = fs.readFileSync(path.join(process.cwd(), "public/game/lang-v2/ko_kr.lang"));

    expect(crypto.createHash("sha1").update(locale).digest("hex")).toBe(
      "502813d62264297168b2fb6cf732fc3ee337d42f",
    );
  });

  it("ships the locale-metadata-fixed 1.12.2 client bundle", () => {
    const bundle = fs.readFileSync(path.join(process.cwd(), "vendor/clients/stable-locale-fixed.epw"));

    expect(bundle.subarray(0, 8).toString("ascii")).toBe("EAG$WASM");
    expect(crypto.createHash("sha256").update(bundle).digest("hex")).toBe(
      "6c4e3a34bb72307898f2eeea407a4da84f3ff1161503bf4f1517a6fb9ed290f0",
    );
  });

  it("keeps the Korean launch hint for clients that support it", () => {
    const { options } = loadBridge();

    expect(options.lang).toBe("ko_KR");
    expect(options.localesURI).toBe("/game/lang-v2");
  });

  it("fills the optional hooks that WASM-GC u2 casts without null checks", () => {
    const hooks = loadBridge().options.hooks as Record<string, unknown>;

    expect(hooks.crashReportShow).toBeTypeOf("function");
    expect(hooks.screenChanged).toBeTypeOf("function");
  });

  it("seeds Korean in the 1.12 game settings for a new account", () => {
    const encoded = loadBridge().storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe("lang:ko_KR\n");
  });

  it("seeds Korean when the WASM shell has no native base64 helpers", () => {
    const encoded = loadBridge(undefined, false).storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe("lang:ko_KR\n");
  });

  it("serves Korean settings through the WASM local-storage hook", () => {
    const { options } = loadBridge("version:1343\nlang:en_us\nmouseSensitivity:0.75\n");
    const hooks = options.hooks as {
      localStorageLoaded: (key: string) => string | null;
    };

    expect(Buffer.from(hooks.localStorageLoaded("_spawnpoint_mossrunner.g") ?? "", "base64").toString("binary")).toBe(
      "version:1343\nlang:ko_KR\nmouseSensitivity:0.75\n",
    );
  });

  it("forces Korean when the WASM client saves game settings", () => {
    const { options, storage } = loadBridge();
    const hooks = options.hooks as {
      localStorageSaved: (key: string, data: string) => void;
    };

    hooks.localStorageSaved(
      "_spawnpoint_mossrunner.g",
      Buffer.from("lang:en_us\nautoJump:false\n", "binary").toString("base64"),
    );

    expect(Buffer.from(storage.get("_spawnpoint_mossrunner.g") ?? "", "base64").toString("binary")).toBe(
      "lang:ko_KR\nautoJump:false\n",
    );
  });

  it("forces Korean without resetting existing Minecraft preferences", () => {
    const { storage } = loadBridge("version:1343\nlang:en_us\nmouseSensitivity:0.75\nautoJump:false\n");
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "version:1343\nlang:ko_KR\nmouseSensitivity:0.75\nautoJump:false\n",
    );
  });

  it("turns auto-jump off by default", () => {
    expect(loadBridge().options.autoJump).toBe(false);
  });

  it("includes the launch id in the gateway address", () => {
    expect(loadBridge().options.joinServer).toBe(
      "wss://spawnpoint.test/gateway?launch=launch-123",
    );
  });

  it("blocks the client Edit Profile button outside an active game session", () => {
    const { canvas, handlers } = loadBridge();
    const event = {
      target: canvas,
      clientX: 500,
      clientY: 420,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    handlers.get("mousedown")?.[0](event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });
});
