import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const bridgeSource = fs.readFileSync(path.join(process.cwd(), "public/game/portal-bridge.js"), "utf8");
const resourcePackBridgeSource = fs.readFileSync(path.join(process.cwd(), "public/game/resource-pack-bridge.js"), "utf8");

type BridgeEnvironment = {
  coarsePointer?: boolean;
  hostname?: string;
  maxTouchPoints?: number;
  mobileControlLayout?: string;
  mobileLookSensitivity?: number;
  nativePointerLock?: boolean;
  renderDom?: boolean;
  resourcePackPreference?: "new-default" | "programmer-art";
  userAgent?: string;
  viewportHeight?: number;
  viewportWidth?: number;
};

function loadBridge(
  gameSettings?: string,
  nativeBase64 = true,
  locatorSnapshot?: Record<string, unknown>,
  environment: BridgeEnvironment = {},
) {
  const options: Record<string, unknown> = {};
  const handlers = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const windowHandlers = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const windowPropertyHandlers = new Map<string, ((event: Record<string, unknown>) => unknown) | null>();
  const documentPropertyHandlers = new Map<string, ((event: Record<string, unknown>) => unknown) | null>();
  const storage = new Map<string, string>();
  const canvasEvents: Array<Record<string, unknown>> = [];
  const parentMessages: Array<{ message: unknown; targetOrigin: string }> = [];
  const canvasActiveStates: Array<unknown> = [];
  const locatorContexts: Array<{
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillStyle: string;
    imageSmoothingEnabled: boolean;
  }> = [];
  const locatorElementsById = new Map<string, Record<string, any>>();
  const locatorIntervals: Array<{ callback: () => void; delay: number }> = [];
  const locatorAnimationFrames: Array<(timestamp: number) => void> = [];
  let locatorAnimationTime = 0;
  const windowTimeouts = new Map<number, () => void>();
  let nextWindowTimeout = 1;
  if (gameSettings !== undefined) {
    storage.set("_spawnpoint_mossrunner.g", Buffer.from(gameSettings, "binary").toString("base64"));
  }
  if (environment.mobileControlLayout !== undefined) storage.set("spawnpoint_mobile_control_layout_v1", environment.mobileControlLayout);
  if (environment.mobileLookSensitivity !== undefined) storage.set("spawnpoint_mobile_look_sensitivity", String(environment.mobileLookSensitivity));
  if (environment.resourcePackPreference !== undefined) {
    storage.set("_spawnpoint_mossrunner.launch", JSON.stringify({
      csrf: "resource-pack-csrf",
      resourcePackPreference: environment.resourcePackPreference,
    }));
  }
  const canvas = {
    width: 960,
    height: 600,
    style: { touchAction: "pan-x pan-y" },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 960, bottom: 600, width: 960, height: 600 }),
    dispatchEvent: (event: Record<string, unknown>) => {
      canvasEvents.push(event);
      canvasActiveStates.push(documentObject.activeElement);
      return true;
    },
    focus() {
      documentObject.activeElement = canvas;
    },
    blur() {
      if (documentObject.activeElement === canvas) documentObject.activeElement = null;
    },
  };
  if (environment.nativePointerLock) {
    Object.assign(canvas, {
      requestPointerLock: vi.fn(() => {
        documentObject.pointerLockElement = canvas;
        return Promise.resolve();
      }),
    });
  }
  const bodyEvents: Array<Record<string, unknown>> = [];
  const body = {
    children: [] as Array<Record<string, any>>,
    appendChild(child: Record<string, any>) {
      child.parentNode = body;
      body.children.push(child);
      if (child.id) locatorElementsById.set(child.id, child);
      return child;
    },
    removeChild(child: Record<string, any>) {
      const index = body.children.indexOf(child);
      if (index >= 0) body.children.splice(index, 1);
      child.parentNode = null;
    },
    dispatchEvent: (event: Record<string, unknown>) => {
      bodyEvents.push(event);
      return true;
    },
  };
  let textInputCreated = false;
  let documentObject: Record<string, any>;
  const clientTextInputEvents: Array<Record<string, unknown>> = [];
  const clientTextInputActiveStates: boolean[] = [];
  const clientTextInputFocusTypes: string[] = [];
  function FakeHTMLInputElement() {}
  FakeHTMLInputElement.prototype.focus = function (this: Record<string, any>) {
    clientTextInputFocusTypes.push(this.type);
    documentObject.activeElement = this;
  };
  const clientTextInput = Object.assign(Object.create(FakeHTMLInputElement.prototype), {
    classList: { contains: (name: string) => name === "_eaglercraftX_text_input_element" },
    dispatchEvent: (event: Record<string, unknown>) => {
      clientTextInputEvents.push(event);
      clientTextInputActiveStates.push(documentObject.activeElement === clientTextInput);
      return true;
    },
    blur() {
      documentObject.activeElement = null;
    },
    inputMode: "",
    lang: "",
    setSelectionRange: vi.fn(),
    spellcheck: true,
    type: "password",
    value: " ",
  });
  const keyboardZone = {
    style: { display: "none" },
    dispatchEvent(event: Record<string, unknown>) {
      if (event.type === "touchend") textInputCreated = true;
      return true;
    },
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
  class FakeEvent {
    type: string;

    constructor(type: string, init: Record<string, unknown> = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  let mutationObserverCallback: ((records: Array<Record<string, unknown>>) => void) | null = null;
  let mutationObserverOptions: Record<string, unknown> | null = null;
  class FakeMutationObserver {
    constructor(callback: (records: Array<Record<string, unknown>>) => void) {
      mutationObserverCallback = callback;
    }

    observe(_target: unknown, options: Record<string, unknown>) {
      mutationObserverOptions = options;
    }
  }
  const windowObject: Record<string, unknown> = {
    eaglercraftXOpts: options,
    addEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
      const listeners = windowHandlers.get(name) ?? [];
      listeners.push(listener);
      windowHandlers.set(name, listeners);
    },
    removeEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
      const listeners = windowHandlers.get(name) ?? [];
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    HTMLInputElement: FakeHTMLInputElement,
    MouseEvent: FakeEvent,
    MutationObserver: FakeMutationObserver,
    PointerEvent: FakeEvent,
    WheelEvent: FakeEvent,
    Proxy,
    WeakMap,
    WebSocket: FakeWebSocket,
    setTimeout(callback: () => void) {
      const id = nextWindowTimeout++;
      windowTimeouts.set(id, callback);
      return id;
    },
    clearTimeout(id: number) {
      windowTimeouts.delete(id);
    },
    matchMedia: (query: string) => ({ matches: query === "(pointer: coarse)" && environment.coarsePointer === true }),
    navigator: {
      maxTouchPoints: environment.maxTouchPoints ?? 0,
      userAgent: environment.userAgent ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    innerHeight: environment.viewportHeight ?? 844,
    innerWidth: environment.viewportWidth ?? 390,
    location: {
      search: "?account=mossrunner&launch=launch-123",
      protocol: "https:",
      host: environment.hostname ?? "spawnpoint.test",
      hostname: environment.hostname ?? "spawnpoint.test",
      origin: "https://spawnpoint.test",
      pathname: "/game/stable.html",
    },
  };
  if (locatorSnapshot) {
    class FakeImage {
      naturalWidth = 64;
      naturalHeight = 64;
      width = 64;
      height = 64;
      onload: (() => void) | null = null;
      private value = "";

      set src(value: string) {
        this.value = value;
        this.onload?.();
      }

      get src() {
        return this.value;
      }
    }
    windowObject.Image = FakeImage;
    windowObject.setInterval = vi.fn((callback: () => void, delay: number) => {
      locatorIntervals.push({ callback, delay });
      return locatorIntervals.length;
    });
    windowObject.performance = { now: () => locatorAnimationTime };
    windowObject.requestAnimationFrame = vi.fn((callback: (timestamp: number) => void) => {
      locatorAnimationFrames.push(callback);
      return locatorAnimationFrames.length;
    });
  }
  if (locatorSnapshot || environment.renderDom || environment.resourcePackPreference !== undefined) {
    windowObject.fetch = vi.fn(async (input: unknown) => ({
      ok: true,
      json: async () => String(input) === "/api/game/chat"
        ? { sent: true, command: false }
        : locatorSnapshot ?? { active: false, targets: [], players: [] },
    }));
  }
  windowObject.parent = {
    postMessage(message: unknown, targetOrigin: string) {
      parentMessages.push({ message, targetOrigin });
    },
  };
  ["onkeydown", "onkeypress", "onkeyup"].forEach((propertyName) => {
    Object.defineProperty(windowObject, propertyName, {
      configurable: true,
      enumerable: true,
      get: () => windowPropertyHandlers.get(propertyName) ?? null,
      set: (handler) => windowPropertyHandlers.set(propertyName, typeof handler === "function" ? handler : null),
    });
  });
  if (nativeBase64) {
    windowObject.atob = (value: string) => Buffer.from(value, "base64").toString("binary");
    windowObject.btoa = (value: string) => Buffer.from(value, "binary").toString("base64");
  }

  function locatorElement(tagName: string) {
    const elementHandlers = new Map<string, Array<(event: Record<string, any>) => void>>();
    const element: Record<string, any> = {
      tagName: tagName.toUpperCase(),
      children: [] as Array<Record<string, any>>,
      className: "",
      id: "",
      parentNode: null,
      style: {
        setProperty(name: string, value: string) {
          this[name] = value;
        },
      },
      addEventListener(name: string, listener: (event: Record<string, any>) => void) {
        const listeners = elementHandlers.get(name) ?? [];
        listeners.push(listener);
        elementHandlers.set(name, listeners);
      },
      removeEventListener(name: string, listener: (event: Record<string, any>) => void) {
        const listeners = elementHandlers.get(name) ?? [];
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      dispatchEvent(event: Record<string, any>) {
        event.target ??= element;
        element[`on${event.type}`]?.(event);
        elementHandlers.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
      blur() {
        if (documentObject.activeElement === element) documentObject.activeElement = null;
      },
      focus() {
        documentObject.activeElement = element;
      },
      getBoundingClientRect() {
        if (element.style.position === "fixed") {
          const left = Number.parseFloat(element.style.left) || 0;
          const top = Number.parseFloat(element.style.top) || 0;
          const width = Number.parseFloat(element.style.width) || 44;
          const height = Number.parseFloat(element.style.height) || 44;
          return { left, top, right: left + width, bottom: top + height, width, height };
        }
        if (element.mockRect) return element.mockRect;
        return { left: 0, top: 0, right: 44, bottom: 44, width: 44, height: 44 };
      },
      appendChild(child: Record<string, any>) {
        child.parentNode = element;
        element.children.push(child);
        if (child.id) locatorElementsById.set(child.id, child);
        return child;
      },
      removeChild(child: Record<string, any>) {
        const index = element.children.indexOf(child);
        if (index >= 0) element.children.splice(index, 1);
        child.parentNode = null;
      },
      remove() {
        element.parentNode?.removeChild(element);
      },
      setAttribute(name: string, value: string) {
        element[name] = value;
      },
      textContent: "",
      title: "",
    };
    element.classList = {
      contains(name: string) {
        return element.className.split(/\s+/).includes(name);
      },
      toggle(name: string, force?: boolean) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        element.className = [...classes].join(" ");
        return enabled;
      },
    };
    if (tagName.toLowerCase() === "canvas") {
      const context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: "",
        imageSmoothingEnabled: true,
      };
      locatorContexts.push(context);
      element.width = 0;
      element.height = 0;
      element.getContext = () => context;
    }
    return element;
  }
  const head = locatorElement("head");

  documentObject = {
    title: "",
    activeElement: null,
    body,
    head,
    documentElement: {},
    pointerLockElement: null,
    hasFocus: () => true,
    addEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
      const listeners = handlers.get(name) ?? [];
      listeners.push(listener);
      handlers.set(name, listeners);
    },
    removeEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
      const listeners = handlers.get(name) ?? [];
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatchEvent(event: Record<string, any>) {
      event.target ??= documentObject;
      handlers.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
    querySelector(selector: string) {
      if (selector.includes("_eaglercraftX_keyboard_open_zone")) return keyboardZone;
      if (selector.includes("_eaglercraftX_text_input_element")) return textInputCreated ? clientTextInput : null;
      return selector.includes("canvas") ? canvas : null;
    },
  };
  if (locatorSnapshot || environment.renderDom) {
    documentObject.readyState = "complete";
    documentObject.createElement = locatorElement;
    documentObject.getElementById = (id: string) => locatorElementsById.get(id) ?? null;
  }
  ["onkeydown", "onkeypress", "onkeyup"].forEach((propertyName) => {
    Object.defineProperty(documentObject, propertyName, {
      configurable: true,
      enumerable: true,
      get: () => documentPropertyHandlers.get(propertyName) ?? null,
      set: (handler) => documentPropertyHandlers.set(propertyName, typeof handler === "function" ? handler : null),
    });
  });

  vm.runInNewContext(`${resourcePackBridgeSource}\n${bridgeSource}`, {
    URLSearchParams,
    clearTimeout() {},
    document: documentObject,
    encodeURIComponent,
    history: { replaceState() {} },
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
    window: windowObject,
  });

  return {
    canvas,
    canvasActiveStates,
    canvasEvents,
    body,
    bodyEvents,
    handlers,
    clientTextInput,
    clientTextInputActiveStates,
    clientTextInputEvents,
    clientTextInputFocusTypes,
    documentObject,
    keyboardZone,
    locatorContexts,
    locatorElementsById,
    locatorIntervals,
    options,
    parentMessages,
    storage,
    triggerMutation: () => mutationObserverCallback?.([{}]),
    mutationObserverOptions,
    documentPropertyHandlers,
    windowHandlers,
    windowPropertyHandlers,
    windowObject,
    runLocatorAnimationFrame(timestamp: number) {
      locatorAnimationTime = timestamp;
      const callbacks = locatorAnimationFrames.splice(0);
      callbacks.forEach((callback) => callback(timestamp));
    },
    runWindowTimeouts() {
      const callbacks = [...windowTimeouts.values()];
      windowTimeouts.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

describe("domain site name", () => {
  it.each([
    ["xn--o79a769b.xn--hk3b17f.xn--3e0b707e", "예게.서버.한국"],
    ["xn--9k3b21rt2f.xn--hk3b17f.xn--3e0b707e", "베이컨.서버.한국"],
    ["spawnpoint.test", "spawnpoint"],
  ])("uses the name for %s in the game client", (hostname, expected) => {
    const client = loadBridge(undefined, true, undefined, { hostname });
    expect(client.options.servers).toEqual([
      { addr: `wss://${hostname}/gateway?launch=launch-123`, name: expected, hideAddress: true },
    ]);
    expect(client.documentObject.title).toBe(`${expected}, mossrunner`);
  });
});

function findControl(root: Record<string, any>, action: string): Record<string, any> | undefined {
  if (root["data-sp-control"] === action) return root;
  for (const child of root.children ?? []) {
    const found = findControl(child, action);
    if (found) return found;
  }
  return undefined;
}

describe("portal game bridge", () => {
  it("ships the verified Minecraft 1.12 Korean language asset", () => {
    const locale = fs.readFileSync(path.join(process.cwd(), "public/game/lang-v2/ko_kr.lang"));
    const localeText = locale.toString("utf8");

    expect(crypto.createHash("sha1").update(locale).digest("hex")).toBe(
      "82103a7478dd7405fb95ca7e61cbbeea1cc2e6bf",
    );
    expect(localeText).toContain("language.code=ko_kr\n");
    for (const voiceLabel of [
      "eaglercraft.voice.title=음성 채팅",
      "eaglercraft.voice.notConnected=연결되지 않음",
      "eaglercraft.voice.connecting=연결 중...",
      "eaglercraft.voice.connectedGlobal=연결됨",
      "eaglercraft.voice.connectedRadius=연결됨",
      "eaglercraft.voice.off=끔",
      "eaglercraft.voice.radius=주변",
      "eaglercraft.voice.global=전체",
    ]) {
      expect(localeText).toContain(`${voiceLabel}\n`);
    }
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

    expect(options.lang).toBe("ko_kr");
    expect(options.localesURI).toBe("/game/lang-v2");
    expect(options.allowVoiceClient).toBe(true);
  });

  it("fills the optional hooks that WASM-GC u2 casts without null checks", () => {
    const hooks = loadBridge().options.hooks as Record<string, unknown>;

    expect(hooks.crashReportShow).toBeTypeOf("function");
    expect(hooks.screenChanged).toBeTypeOf("function");
  });

  it("seeds Korean in the 1.12 game settings for a new account", () => {
    const encoded = loadBridge().storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "lang:ko_kr\nautoJump:false\nfov:0.5\ngamma:1.0\nenableDynamicLights:true\nao:2\nshowSubtitles:true\ntutorialStep:none\nacknowledgeDisclaimer:true\n",
    );
  });

  it("seeds Korean when the WASM shell has no native base64 helpers", () => {
    const encoded = loadBridge(undefined, false).storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "lang:ko_kr\nautoJump:false\nfov:0.5\ngamma:1.0\nenableDynamicLights:true\nao:2\nshowSubtitles:true\ntutorialStep:none\nacknowledgeDisclaimer:true\n",
    );
  });

  it("serves Korean settings through the WASM local-storage hook", () => {
    const { options } = loadBridge("version:1343\nlang:en_us\nmouseSensitivity:0.75\n");
    const hooks = options.hooks as {
      localStorageLoaded: (key: string) => string | null;
    };

    expect(Buffer.from(hooks.localStorageLoaded("_spawnpoint_mossrunner.g") ?? "", "base64").toString("binary")).toBe(
      "version:1343\nlang:ko_kr\nmouseSensitivity:0.75\nautoJump:false\nfov:0.5\ngamma:1.0\nenableDynamicLights:true\nao:2\nshowSubtitles:true\ntutorialStep:none\nacknowledgeDisclaimer:true\n",
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
      "lang:ko_kr\nautoJump:false\nfov:0.5\ngamma:1.0\nenableDynamicLights:true\nao:2\nshowSubtitles:true\ntutorialStep:none\nacknowledgeDisclaimer:true\n",
    );
  });

  it("syncs a Resource Packs menu change back to the signed-in account", async () => {
    const { options, windowObject } = loadBridge(
      'resourcePacks:["New Default V2"]\nincompatibleResourcePacks:[]\nlang:ko_kr\n',
      true,
      undefined,
      { resourcePackPreference: "new-default" },
    );
    const hooks = options.hooks as {
      localStorageSaved: (key: string, data: string) => void;
    };

    hooks.localStorageSaved(
      "g",
      Buffer.from("resourcePacks:[]\nincompatibleResourcePacks:[]\nlang:ko_kr\n", "binary").toString("base64"),
    );

    await vi.waitFor(() => {
      expect(windowObject.fetch).toHaveBeenCalledWith("/api/account/resource-pack", expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ resourcePackPreference: "programmer-art" }),
      }));
    });
  });

  it("applies the saved Programmer Art choice on another device without clearing custom packs", async () => {
    const { storage, windowObject } = loadBridge(
      'resourcePacks:["New Default V2","Custom Pack"]\nincompatibleResourcePacks:[]\nlang:ko_kr\n',
      true,
      undefined,
      { resourcePackPreference: "programmer-art" },
    );

    await (windowObject.__spawnpointPrepareClient as Promise<void>);

    expect(Buffer.from(storage.get("_spawnpoint_mossrunner.g") ?? "", "base64").toString("binary")).toContain(
      'resourcePacks:["Custom Pack"]\n',
    );
  });

  it("does not guess a preference when compressed settings cannot be inspected", async () => {
    const compressedSettings = "\x1f\x8bunsupported-in-test";
    const { options, windowObject } = loadBridge(
      compressedSettings,
      true,
      undefined,
      { resourcePackPreference: "new-default" },
    );
    await (windowObject.__spawnpointPrepareClient as Promise<void>);

    const hooks = options.hooks as {
      localStorageSaved: (key: string, data: string) => void;
    };
    hooks.localStorageSaved("g", Buffer.from(compressedSettings, "binary").toString("base64"));
    await Promise.resolve();
    await Promise.resolve();

    expect(windowObject.fetch).not.toHaveBeenCalledWith(
      "/api/account/resource-pack",
      expect.anything(),
    );
  });

  it("forces Korean without resetting existing Minecraft preferences", () => {
    const { storage } = loadBridge("version:1343\nlang:en_us\nmouseSensitivity:0.75\nautoJump:false\n");
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "version:1343\nlang:ko_kr\nmouseSensitivity:0.75\nautoJump:false\nfov:0.5\ngamma:1.0\nenableDynamicLights:true\nao:2\nshowSubtitles:true\ntutorialStep:none\nacknowledgeDisclaimer:true\n",
    );
  });

  it("preserves per-user values after applying the first-launch defaults", () => {
    const { storage } = loadBridge(
      "lang:en_us\nautoJump:true\nfov:0.25\nenableDynamicLights:false\nao:0\nshowSubtitles:false\n",
    );
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "lang:ko_kr\nautoJump:true\nfov:0.25\nenableDynamicLights:false\nao:0\nshowSubtitles:false\ngamma:1.0\ntutorialStep:none\nacknowledgeDisclaimer:true\n",
    );
  });

  it("disables the vanilla tutorial for existing accounts", () => {
    const { storage } = loadBridge("lang:ko_KR\ntutorialStep:movement\n");
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toContain("tutorialStep:none\n");
    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toContain("lang:ko_kr\n");
  });

  it("acknowledges the built-in disclaimer for new and existing accounts", () => {
    const { storage } = loadBridge("lang:ko_kr\nacknowledgeDisclaimer:false\n");
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toContain("acknowledgeDisclaimer:true\n");
  });

  it("turns auto-jump off by default", () => {
    expect(loadBridge().options.autoJump).toBe(false);
  });

  it("includes the launch id in the gateway address", () => {
    expect(loadBridge().options.joinServer).toBe(
      "wss://spawnpoint.test/gateway?launch=launch-123",
    );
  });

  it("renders a separate top locator with pixel-outlined player heads", async () => {
    const { body, documentObject, locatorContexts, locatorElementsById, locatorIntervals, options, triggerMutation, windowObject } = loadBridge(
      undefined,
      true,
      {
        active: true,
        targets: [{
          id: "c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb",
          displayName: "Moss Runner",
          angle: -45,
          distance: 18.25,
          skinUrl: "/api/skins/c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb.png?v=1",
        }],
      },
    );
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    expect(windowObject.fetch.mock.calls.filter((call) => call[0] === "/api/game/locator")).toHaveLength(0);
    hooks.screenChanged("", 480, 300, 960, 600, 2);

    await vi.waitFor(() => {
      expect(locatorElementsById.get("spawnpoint-player-locator")?.style.display).toBe("block");
    });

    const root = locatorElementsById.get("spawnpoint-player-locator")!;
    const track = root.children[0];
    const marker = track.children[0].children[0];
    const headCanvas = marker.children[0];
    const locatorStyle = locatorElementsById.get("spawnpoint-locator-style");
    expect(root.style).toMatchObject({
      left: "0px",
      top: "0px",
      width: "960px",
      height: "600px",
      "--sp-locator-pixel": "2px",
      "--sp-locator-width": "364px",
    });
    expect(marker.style.left).toBe("25%");
    expect(locatorStyle?.textContent).toContain(".sp-locator-marker{position:absolute");
    expect(locatorStyle?.textContent).toContain("#spawnpoint-player-locator{position:fixed;display:none;pointer-events:none;z-index:2147483000;background:none!important");
    expect(locatorStyle?.textContent).not.toContain("transition:left");
    expect(locatorStyle?.textContent).not.toContain("will-change:left");
    expect(headCanvas).toMatchObject({ width: 10, height: 10 });
    expect(locatorContexts[0].fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
    expect(locatorContexts[0].drawImage.mock.calls.map((call) => call.slice(1))).toEqual([
      [8, 8, 8, 8, 1, 1, 8, 8],
      [40, 8, 8, 8, 1, 1, 8, 8],
    ]);
    expect(windowObject.fetch).toHaveBeenCalledWith("/api/game/locator", {
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(locatorIntervals).toEqual([{ callback: expect.any(Function), delay: 100 }]);

    body.removeChild(root);
    expect(root.parentNode).toBeNull();
    triggerMutation();
    expect(root.parentNode).toBe(body);
    expect(root.style.display).toBe("block");

    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    expect(root.style.display).toBe("none");
    expect(documentObject.body.children).toContain(root);
    const requestsBeforeHiddenPoll = windowObject.fetch.mock.calls.length;
    locatorIntervals[0].callback();
    expect(windowObject.fetch).toHaveBeenCalledTimes(requestsBeforeHiddenPoll);

    hooks.screenChanged("", 480, 300, 960, 600, 2);
    await vi.waitFor(() => {
      expect(windowObject.fetch).toHaveBeenCalledTimes(requestsBeforeHiddenPoll + 1);
    });
  });

  it("interpolates locator samples in script and settles before the next poll", async () => {
    const snapshot = {
      active: true,
      targets: [{
        id: "c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb",
        displayName: "Moss Runner",
        angle: -45,
        distance: 18.25,
        skinUrl: "/api/skins/c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb.png?v=1",
      }],
    };
    const client = loadBridge(undefined, true, snapshot);
    const hooks = client.options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("", 480, 300, 960, 600, 2);
    await vi.waitFor(() => expect(client.locatorElementsById.get("spawnpoint-player-locator")?.style.display).toBe("block"));
    const marker = client.locatorElementsById.get("spawnpoint-player-locator")!.children[0].children[0].children[0];
    expect(marker.style.left).toBe("25%");

    snapshot.targets[0].angle = 45;
    client.locatorIntervals[0].callback();
    await vi.waitFor(() => expect(client.windowObject.requestAnimationFrame).toHaveBeenCalled());
    expect(marker.style.left).toBe("25%");

    client.runLocatorAnimationFrame(40);
    expect(Number.parseFloat(marker.style.left)).toBeGreaterThan(25);
    expect(Number.parseFloat(marker.style.left)).toBeLessThan(75);
    client.runLocatorAnimationFrame(80);
    expect(marker.style.left).toBe("75%");
  });

  it("snaps across the rear angle boundary instead of moving through the center", async () => {
    const snapshot = {
      active: true,
      targets: [{
        id: "c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb",
        displayName: "Moss Runner",
        angle: 179,
        distance: 18.25,
        skinUrl: "/api/skins/c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb.png?v=1",
      }],
    };
    const client = loadBridge(undefined, true, snapshot);
    const hooks = client.options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("", 480, 300, 960, 600, 2);
    await vi.waitFor(() => expect(client.locatorElementsById.get("spawnpoint-player-locator")?.style.display).toBe("block"));
    const marker = client.locatorElementsById.get("spawnpoint-player-locator")!.children[0].children[0].children[0];
    expect(marker.style.left).toBe("100%");

    snapshot.targets[0].angle = -179;
    client.locatorIntervals[0].callback();
    await vi.waitFor(() => expect(marker.style.left).toBe("0%"));
    expect(client.windowObject.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("dismisses Edit Profile whenever the client reaches that screen", () => {
    const { canvasEvents, options } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };

    hooks.screenChanged("net.lax1dude.eaglercraft.profile.GuiScreenEditProfile", 480, 300, 960, 600, 2);

    expect(canvasEvents.map((event) => event.type)).toEqual([
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ]);
    expect(canvasEvents[0]).toMatchObject({ clientX: 480, clientY: 456 });
  });

  it("commits one final Korean string instead of every IME composition update", () => {
    const { handlers } = loadBridge();
    const dispatched: Array<Record<string, unknown>> = [];
    const input = {
      classList: { contains: (name: string) => name === "_eaglercraftX_text_input_element" },
      dispatchEvent: (event: Record<string, unknown>) => {
        dispatched.push(event);
        return true;
      },
      setSelectionRange: vi.fn(),
      value: " 한",
    };
    const intermediate = {
      target: input,
      data: "하",
      inputType: "insertCompositionText",
      isComposing: true,
      stopImmediatePropagation: vi.fn(),
    };

    handlers.get("compositionstart")?.[0]({ target: input, data: "" });
    handlers.get("beforeinput")?.[0](intermediate);
    handlers.get("compositionupdate")?.[0]({ target: input, data: "한" });
    const completed = {
      target: input,
      data: "한",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    handlers.get("compositionend")?.[0](completed);

    expect(intermediate.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(completed.preventDefault).toHaveBeenCalledOnce();
    expect(completed.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: "beforeinput", data: "한", inputType: "insertText" });
    expect(input.value).toBe(" ");
    expect(input.setSelectionRange).toHaveBeenCalledWith(1, 1);
  });

  it("opens a visible native text input when desktop chat opens", () => {
    const { documentObject, locatorElementsById, options } = loadBridge(undefined, true, undefined, { renderDom: true });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };

    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);

    const composer = locatorElementsById.get("spawnpoint-mobile-chat")!;
    const input = composer.children[0];
    expect(composer).toMatchObject({
      style: { display: "flex" },
      "data-sp-platform": "desktop",
    });
    expect(input).toMatchObject({
      type: "text",
      lang: "ko-KR",
      inputMode: "text",
      autocomplete: "off",
      spellcheck: false,
    });
    expect(documentObject.activeElement).toBe(input);

    hooks.screenChanged("", 480, 300, 960, 600, 2);
    expect(composer.style.display).toBe("none");
    expect(input).not.toBe(documentObject.activeElement);
  });

  it("leaves T for Minecraft so its native chat history remains visible and clickable", () => {
    const {
      canvas,
      canvasEvents,
      locatorElementsById,
      windowHandlers,
      windowObject,
    } = loadBridge(undefined, true, undefined, { renderDom: true });
    const runtimeListener = vi.fn();
    windowObject.addEventListener("keydown", runtimeListener, true);
    const event = {
      target: canvas,
      type: "keydown",
      key: "t",
      code: "KeyT",
      repeat: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    windowHandlers.get("keydown")?.forEach((listener) => listener(event));

    expect(runtimeListener).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(locatorElementsById.get("spawnpoint-mobile-chat")).toBeUndefined();
    expect(canvasEvents).toHaveLength(0);
  });

  it("does not let observer timing blur the runtime text input", () => {
    const { clientTextInput, documentObject, keyboardZone, triggerMutation } = loadBridge();

    keyboardZone.style.display = "block";
    triggerMutation();
    expect(documentObject.activeElement).toBe(clientTextInput);
    const blur = vi.spyOn(clientTextInput, "blur");

    keyboardZone.style.display = "none";
    triggerMutation();
    expect(documentObject.activeElement).toBe(clientTextInput);
    expect(blur).not.toHaveBeenCalled();
  });

  it("repairs a later password type change without closing chat", () => {
    const {
      clientTextInput,
      documentObject,
      keyboardZone,
      mutationObserverOptions,
      triggerMutation,
    } = loadBridge();

    keyboardZone.style.display = "block";
    triggerMutation();
    const blur = vi.spyOn(clientTextInput, "blur");
    const focus = vi.spyOn(clientTextInput, "focus");

    clientTextInput.type = "password";
    triggerMutation();

    expect(clientTextInput.type).toBe("text");
    expect(documentObject.activeElement).toBe(clientTextInput);
    expect(blur).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(mutationObserverOptions).toMatchObject({
      attributeFilter: ["style", "type"],
    });
  });

  it("lets the visible desktop input own macOS and Windows text and IME keys", () => {
    const {
      documentObject,
      locatorElementsById,
      options,
      windowHandlers,
      windowObject,
    } = loadBridge(undefined, true, undefined, { renderDom: true });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const chatInput = locatorElementsById.get("spawnpoint-mobile-chat")!.children[0];
    expect(documentObject.activeElement).toBe(chatInput);

    const runtimeListener = vi.fn((event: Record<string, any>) => event.preventDefault());
    windowObject.addEventListener("keydown", runtimeListener);
    const wrappedRuntimeListener = windowHandlers.get("keydown")?.at(-1);
    const imeEvents = [
      { key: "CapsLock", code: "CapsLock", keyCode: 20 },
      { key: "HangulMode", code: "Lang1", keyCode: 21 },
      { key: "Process", code: "KeyR", keyCode: 229, isComposing: true },
    ].map((key) => ({
      ...key,
      target: chatInput,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    }));

    imeEvents.forEach((event) => wrappedRuntimeListener?.(event));

    expect(runtimeListener).not.toHaveBeenCalled();
    imeEvents.forEach((event) => expect(event.preventDefault).not.toHaveBeenCalled());

    const textEvent = {
      target: chatInput,
      key: "r",
      code: "KeyR",
      keyCode: 82,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    wrappedRuntimeListener?.(textEvent);
    expect(runtimeListener).not.toHaveBeenCalled();
    expect(textEvent.preventDefault).not.toHaveBeenCalled();

    const navigationEvent = {
      target: chatInput,
      key: "ArrowLeft",
      code: "ArrowLeft",
      keyCode: 37,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    wrappedRuntimeListener?.(navigationEvent);
    expect(runtimeListener).not.toHaveBeenCalled();
    expect(navigationEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("shows online players after a Korean TPA command and sends the selected command", async () => {
    const {
      canvasEvents,
      clientTextInputEvents,
      locatorElementsById,
      options,
      runWindowTimeouts,
      windowObject,
    } = loadBridge(undefined, true, {
      active: false,
      targets: [],
      players: [{ gameUsername: "MossRunner", displayName: "이끼 러너" }],
    });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const chatInput = locatorElementsById.get("spawnpoint-mobile-chat")!.children[0];
    chatInput.value = "/텔포";
    chatInput.oninput({ isComposing: false });

    await vi.waitFor(() => {
      expect(locatorElementsById.get("spawnpoint-tpa-picker")?.style.display).toBe("flex");
      expect(locatorElementsById.get("spawnpoint-tpa-picker")?.children[0].children).toHaveLength(1);
    });

    const button = locatorElementsById.get("spawnpoint-tpa-picker")!.children[0].children[0];
    expect(button).toMatchObject({ textContent: "이끼 러너", title: "/tpa MossRunner" });
    button.onclick({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(windowObject.fetch).toHaveBeenCalledWith("/api/game/chat", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ launchId: "launch-123", message: "/텔포 MossRunner" }),
    })));
    expect(clientTextInputEvents).toHaveLength(0);
    expect(canvasEvents).toHaveLength(0);

    button.onclick({ preventDefault: vi.fn() });
    runWindowTimeouts();
    runWindowTimeouts();
    runWindowTimeouts();
    expect((windowObject.fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([input]) => input === "/api/game/chat")).toHaveLength(1);
    expect(canvasEvents).toHaveLength(0);
    expect(windowObject.fetch).toHaveBeenCalledWith("/api/game/players", {
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("keeps the in-game TPA picker clear of mobile safe areas with finger-sized actions", () => {
    const { documentObject } = loadBridge(undefined, true, {
      active: false,
      targets: [],
      players: [],
    });
    const style = documentObject.head.children.find((element: Record<string, unknown>) => element.id === "spawnpoint-tpa-style");

    expect(style?.textContent).toContain("env(safe-area-inset-bottom)");
    expect(style?.textContent).toContain("min-height:44px");
    expect(style?.textContent).toContain("touch-action:manipulation");
    expect(style?.textContent).toContain("overscroll-behavior-x:contain");
  });

  it("installs touch controls only for mobile or coarse-pointer browsers", () => {
    const desktop = loadBridge(undefined, true, undefined, { renderDom: true });
    expect(desktop.locatorElementsById.has("spawnpoint-mobile-controls")).toBe(false);

    const hybridLaptop = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 10,
      renderDom: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(hybridLaptop.locatorElementsById.has("spawnpoint-mobile-controls")).toBe(false);

    const mobile = loadBridge(undefined, true, undefined, {
      renderDom: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148",
    });
    const root = mobile.locatorElementsById.get("spawnpoint-mobile-controls")!;
    const style = mobile.documentObject.head.children.find(
      (element: Record<string, unknown>) => element.id === "spawnpoint-mobile-control-style",
    );

    expect(root.style.display).toBe("none");
    expect(style?.textContent).toContain("min-width:44px");
    expect(style?.textContent).toContain("min-height:44px");
    expect(style?.textContent).toContain("touch-action:none");
    expect(style?.textContent).toContain("env(safe-area-inset-bottom)");

    mobile.body.removeChild(root);
    mobile.triggerMutation();
    expect(mobile.body.children).toContain(root);
  });

  it("lays out the requested pixel controls without outlined button chrome", () => {
    const { documentObject, locatorElementsById } = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const root = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const move = root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-move"))!;
    const actions = root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-actions"))!;
    const tools = root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-tools"))!;
    const editor = root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-editor"))!;
    const style = documentObject.head.children.find(
      (element: Record<string, unknown>) => element.id === "spawnpoint-mobile-control-style",
    );

    expect(move.children.map((child: Record<string, any>) => child["data-sp-control"])).toEqual([
      "menu", "forward", "chat",
      "left", "sprint", "right",
      "drop", "back", "inventory",
    ]);
    expect(actions.children.map((child: Record<string, any>) => child["data-sp-control"])).toEqual([
      "attack", "use", "jump", "sneak",
    ]);
    expect(tools.children.map((child: Record<string, any>) => child["data-sp-control"])).toEqual([
      "scale-down", "scale-up", "edit-controls", "hide-controls",
    ]);
    expect(editor.children[0].children[0].textContent).toBe("마우스 감도");
    expect(editor.children[1].textContent).toBe("배치 초기화");
    expect(findControl(root, "hotbar-previous")).toBeUndefined();
    expect(findControl(root, "hotbar-next")).toBeUndefined();
    expect(findControl(root, "menu")).toMatchObject({ textContent: "ESC", "aria-label": "게임 메뉴 열기" });
    expect(findControl(root, "scale-down")).toMatchObject({ textContent: "−", "aria-label": "전체 컨트롤 축소" });
    expect(findControl(root, "scale-up")).toMatchObject({ textContent: "+", "aria-label": "전체 컨트롤 확대" });
    expect(findControl(root, "chat")).toMatchObject({ textContent: "T", "aria-label": "채팅 열기" });
    expect(findControl(root, "drop")).toMatchObject({ textContent: "Q", "aria-label": "아이템 버리기" });
    expect(findControl(root, "inventory")).toMatchObject({ textContent: "E", "aria-label": "보관함 열기" });
    ["forward", "back", "left", "right", "sprint", "jump", "attack", "sneak", "use"].forEach((action) => {
      expect(findControl(root, action)?.innerHTML).toContain('class="sp-mobile-icon sp-mobile-pixel-icon"');
      expect(findControl(root, action)?.innerHTML).toContain('viewBox="0 0 16 16"');
      expect(findControl(root, action)?.innerHTML).toContain('shape-rendering="crispEdges"');
    });
    expect(findControl(root, "forward")?.innerHTML).toContain('<rect x="7" y="5" width="2" height="1"/>');
    expect(findControl(root, "forward")?.innerHTML).not.toBe(findControl(root, "right")?.innerHTML);
    expect(findControl(root, "right")?.innerHTML).not.toBe(findControl(root, "back")?.innerHTML);
    expect(findControl(root, "back")?.innerHTML).not.toBe(findControl(root, "left")?.innerHTML);
    expect(findControl(root, "attack")?.innerHTML).toContain('<rect x="12" y="1" width="3" height="1"/>');
    expect(findControl(root, "use")?.innerHTML).toContain('<rect x="7" y="1" width="2" height="1"/>');
    expect(findControl(root, "edit-controls")?.innerHTML).toContain('viewBox="0 0 24 24"');
    expect(findControl(root, "hide-controls")?.innerHTML).toContain('viewBox="0 0 24 24"');
    expect(findControl(root, "attack")?.children.some((child: Record<string, any>) => child.className === "sp-mobile-resize-handle")).toBe(true);
    expect(style?.textContent).toContain("border:0;border-radius:6px");
    expect(style?.textContent).toContain("background:rgba(8,12,10,.46)");
    expect(style?.textContent).toContain("transform:scale(.94)");
    expect(style?.textContent).toContain("--sp-press-duration:150ms");
    expect(style?.textContent).toContain("@media (prefers-reduced-motion:reduce)");
    expect(style?.textContent).toContain("grid-template:repeat(2,var(--sp-touch))/repeat(3,var(--sp-touch))");
    expect(style?.textContent).toContain("[data-sp-control=attack]{grid-column:1;grid-row:1/3;height:calc(var(--sp-touch)*2 + 5px)}");
    expect(style?.textContent).toContain("[data-sp-control=use]{grid-column:2;grid-row:1/3;height:calc(var(--sp-touch)*2 + 5px)}");
    expect(style?.textContent).toContain("[data-sp-control=jump]{grid-column:3;grid-row:1}");
    expect(style?.textContent).toContain("[data-sp-control=sneak]{grid-column:3;grid-row:2}");
    expect(style?.textContent).toContain(".sp-mobile-tools{position:absolute;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right))");
    expect(style?.textContent).toContain(".is-editing[data-sp-default-layout=true] .sp-mobile-button.sp-mobile-default-scale{display:grid}");
    expect(style?.textContent).toContain(".sp-mobile-resize-handle{position:absolute;right:1px;bottom:1px;display:none");
  });

  it("moves, resizes, resets, hides, and tunes the mobile controls in edit mode", () => {
    const client = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const root = client.locatorElementsById.get("spawnpoint-mobile-controls")!;
    const edit = findControl(root, "edit-controls")!;
    const hide = findControl(root, "hide-controls")!;
    const scaleDown = findControl(root, "scale-down")!;
    const scaleUp = findControl(root, "scale-up")!;
    const attack = findControl(root, "attack")!;
    const handle = attack.children.find((child: Record<string, any>) => child.className === "sp-mobile-resize-handle")!;
    const editor = root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-editor"))!;
    const sensitivity = editor.children[0].children[2];
    const sensitivityValue = editor.children[0].children[1];
    const reset = editor.children[1];
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const gestureEvent = (type: string, target: Record<string, any>, identifier: number, clientX: number, clientY: number) => ({
      type,
      target,
      changedTouches: [{ identifier, clientX, clientY }],
      touches: type === "touchmove" ? [{ identifier, clientX, clientY }] : undefined,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    const tap = (button: Record<string, any>) => {
      button.ontouchstart(touchEvent);
      button.ontouchend(touchEvent);
    };

    attack.mockRect = { left: 240, top: 640, right: 294, bottom: 753, width: 54, height: 113 };
    client.canvas.requestPointerLock();
    tap(edit);
    expect(root.className).toContain("is-editing");
    expect(edit["aria-pressed"]).toBe("true");
    expect(attack.style.position).toBe("fixed");
    expect(sensitivity.max).toBe("4.05");
    expect(root["data-sp-default-layout"]).toBe("true");
    expect(root.style["--sp-touch"]).toBe("54px");

    tap(scaleUp);
    expect(root.style["--sp-touch"]).toBe("59.4px");
    expect(JSON.parse(client.storage.get("spawnpoint_mobile_control_layout_v1")!)).toMatchObject({
      version: 2,
      profiles: [expect.objectContaining({ width: 390, height: 844, scale: 1.1 })],
    });
    tap(scaleDown);
    expect(root.style["--sp-touch"]).toBe("54px");
    expect(client.storage.has("spawnpoint_mobile_control_layout_v1")).toBe(false);

    attack.dispatchEvent(gestureEvent("touchstart", attack, 7, 260, 680));
    client.documentObject.dispatchEvent(gestureEvent("touchmove", attack, 7, 220, 610));
    client.documentObject.dispatchEvent(gestureEvent("touchend", attack, 7, 220, 610));
    expect(attack.style.left).toBe("200px");
    expect(attack.style.top).toBe("570px");
    expect(client.canvasEvents).toEqual([]);

    attack.dispatchEvent(gestureEvent("touchstart", handle, 8, 254, 683));
    client.documentObject.dispatchEvent(gestureEvent("touchmove", handle, 8, 284, 703));
    client.documentObject.dispatchEvent(gestureEvent("touchend", handle, 8, 284, 703));
    expect(attack.style.left).toBe("200px");
    expect(attack.style.top).toBe("570px");
    expect(attack.style.width).toBe("84px");
    expect(attack.style.height).toBe("133px");
    expect(root["data-sp-default-layout"]).toBe("false");
    expect(scaleDown.disabled).toBe(true);
    expect(scaleUp.disabled).toBe(true);
    expect(JSON.parse(client.storage.get("spawnpoint_mobile_control_layout_v1")!).profiles[0].controls.attack).toMatchObject({
      width: 84,
      height: 133,
    });

    sensitivity.value = "4.05";
    sensitivity.oninput();
    expect(sensitivityValue.textContent).toBe("300%");
    expect(client.storage.get("spawnpoint_mobile_look_sensitivity")).toBe("4.05");

    tap(hide);
    expect(root.className).toContain("are-controls-hidden");
    expect(root.className).not.toContain("is-editing");
    expect(hide["aria-label"]).toBe("컨트롤 보이기");
    tap(hide);
    expect(root.className).not.toContain("are-controls-hidden");

    tap(edit);
    tap(reset);
    expect(client.storage.has("spawnpoint_mobile_control_layout_v1")).toBe(false);
    tap(edit);
    expect(attack.style.position).toBe("");
  });

  it("adds, runs, saves, and removes a selected mobile key", () => {
    const client = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const root = client.locatorElementsById.get("spawnpoint-mobile-controls")!;
    const edit = findControl(root, "edit-controls")!;
    const editor = root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-editor"))!;
    const select = editor.children[2].children[0];
    const add = editor.children[2].children[1];
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const tap = (button: Record<string, any>) => {
      button.ontouchstart(touchEvent);
      button.ontouchend(touchEvent);
    };

    client.canvas.requestPointerLock();
    tap(edit);
    select.value = "f3";
    tap(add);

    const f3 = findControl(root, "extra-f3")!;
    expect(f3).toMatchObject({ textContent: "F3", "aria-label": "F3 키" });
    expect(f3.style.position).toBe("fixed");
    expect(JSON.parse(client.storage.get("spawnpoint_mobile_control_layout_v1")!).profiles[0].extras).toEqual(["f3"]);

    tap(edit);
    f3.ontouchstart(touchEvent);
    f3.ontouchend(touchEvent);
    expect(client.canvasEvents.slice(-2)).toEqual([
      expect.objectContaining({ type: "keydown", key: "F3", code: "F3", keyCode: 114 }),
      expect.objectContaining({ type: "keyup", key: "F3", code: "F3", keyCode: 114 }),
    ]);

    tap(edit);
    const remove = f3.children.find((child: Record<string, any>) => child.className === "sp-mobile-delete-handle")!;
    f3.dispatchEvent({
      type: "touchstart",
      target: remove,
      changedTouches: [{ identifier: 22, clientX: 0, clientY: 0 }],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    expect(findControl(root, "extra-f3")).toBeUndefined();
    expect(JSON.parse(client.storage.get("spawnpoint_mobile_control_layout_v1")!).profiles[0].extras).toEqual([]);
  });

  it("restores a saved mobile control layout", () => {
    const client = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      mobileControlLayout: JSON.stringify({
        version: 1,
        controls: {
          attack: { x: 0.5, y: 0.25, width: 80, height: 120 },
        },
      }),
      renderDom: true,
      viewportHeight: 844,
      viewportWidth: 390,
    });
    const root = client.locatorElementsById.get("spawnpoint-mobile-controls")!;
    const attack = findControl(root, "attack")!;

    expect(attack.style).toMatchObject({
      position: "fixed",
      left: "155px",
      top: "181px",
      width: "80px",
      height: "120px",
    });
    expect(attack["data-sp-custom-position"]).toBe("true");
  });

  it("keeps separate layouts for materially different screens and scales through small viewport changes", () => {
    const client = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      mobileControlLayout: JSON.stringify({
        version: 2,
        profiles: [
          {
            width: 390,
            height: 844,
            scale: 1,
            controls: { attack: { x: 0.5, y: 0.25, width: 80, height: 120 } },
          },
          {
            width: 844,
            height: 390,
            scale: 1,
            controls: { attack: { x: 0.2, y: 0.5, width: 100, height: 80 } },
          },
        ],
      }),
      renderDom: true,
      viewportHeight: 844,
      viewportWidth: 390,
    });
    const attack = findControl(client.locatorElementsById.get("spawnpoint-mobile-controls")!, "attack")!;
    const resize = () => client.windowHandlers.get("resize")?.forEach((listener) => listener({}));

    expect(attack.style).toMatchObject({ left: "155px", top: "181px", width: "80px", height: "120px" });

    client.windowObject.innerWidth = 844;
    client.windowObject.innerHeight = 390;
    resize();
    expect(attack.style).toMatchObject({ left: "149px", top: "155px", width: "100px", height: "80px" });

    client.windowObject.innerWidth = 400;
    client.windowObject.innerHeight = 860;
    resize();
    expect(attack.style).toMatchObject({ left: "159px", top: "184px", width: "82px", height: "122px" });

    const root = client.locatorElementsById.get("spawnpoint-mobile-controls")!;
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const tap = (button: Record<string, any>) => {
      button.ontouchstart(touchEvent);
      button.ontouchend(touchEvent);
    };
    client.canvas.requestPointerLock();
    tap(findControl(root, "edit-controls")!);
    tap(root.children.find((child: Record<string, any>) => child.className.includes("sp-mobile-editor"))!.children[1]);
    expect(JSON.parse(client.storage.get("spawnpoint_mobile_control_layout_v1")!).profiles).toEqual([
      expect.objectContaining({ width: 844, height: 390 }),
    ]);
  });

  it("toggles sprint and primes held forward movement with two W presses", () => {
    const { canvas, canvasEvents, locatorElementsById } = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const root = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const sprint = findControl(root, "sprint")!;
    const forward = findControl(root, "forward")!;
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    canvas.requestPointerLock();

    expect(sprint["aria-pressed"]).toBe("false");
    sprint.ontouchstart(touchEvent);
    sprint.ontouchend(touchEvent);
    expect(sprint["aria-pressed"]).toBe("true");
    expect(sprint.className).toContain("is-toggled");

    forward.ontouchstart(touchEvent);
    forward.ontouchend(touchEvent);
    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keyup", "keydown", "keyup"]);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ key: "w", code: "KeyW", keyCode: 87 }),
      expect.objectContaining({ key: "w", code: "KeyW", keyCode: 87 }),
      expect.objectContaining({ key: "w", code: "KeyW", keyCode: 87 }),
      expect.objectContaining({ key: "w", code: "KeyW", keyCode: 87 }),
    ]);

    canvasEvents.length = 0;
    sprint.ontouchstart(touchEvent);
    sprint.ontouchend(touchEvent);
    forward.ontouchstart(touchEvent);
    forward.ontouchend(touchEvent);
    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keyup"]);
  });

  it("uses R as an auto-sprint toggle so one physical W press primes sprint", () => {
    const { canvas, canvasEvents, locatorElementsById, options, windowHandlers } = loadBridge(
      undefined,
      true,
      undefined,
      { maxTouchPoints: 5, renderDom: true },
    );
    const root = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const sprint = findControl(root, "sprint")!;
    canvas.requestPointerLock();

    const dispatchWindowKey = (type: "keydown" | "keypress" | "keyup", key: string, code: string, keyCode: number) => {
      const event = {
        type,
        target: canvas,
        key,
        code,
        keyCode,
        which: keyCode,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      };
      windowHandlers.get(type)?.forEach((listener) => listener(event));
      return event;
    };

    const sprintDown = dispatchWindowKey("keydown", "r", "KeyR", 82);
    const sprintUp = dispatchWindowKey("keyup", "r", "KeyR", 82);
    expect(sprintDown.preventDefault).toHaveBeenCalledOnce();
    expect(sprintDown.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(sprintUp.preventDefault).toHaveBeenCalledOnce();
    expect(sprint["aria-pressed"]).toBe("true");

    dispatchWindowKey("keydown", "w", "KeyW", 87);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "keydown", key: "r", code: "KeyR", keyCode: 82 }),
      expect.objectContaining({ type: "keyup", key: "r", code: "KeyR", keyCode: 82 }),
    ]);

    canvasEvents.length = 0;
    dispatchWindowKey("keydown", "r", "KeyR", 82);
    expect(sprint["aria-pressed"]).toBe("false");
    dispatchWindowKey("keydown", "w", "KeyW", 87);
    expect(canvasEvents).toHaveLength(0);

    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const chatR = dispatchWindowKey("keydown", "r", "KeyR", 82);
    expect(chatR.preventDefault).not.toHaveBeenCalled();
    expect(sprint["aria-pressed"]).toBe("false");
  });

  it("maps the drop and right-side action controls to their game inputs", () => {
    const { canvas, canvasEvents, locatorElementsById } = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const root = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    canvas.requestPointerLock();

    findControl(root, "drop")!.ontouchstart(touchEvent);
    findControl(root, "drop")!.ontouchend(touchEvent);
    findControl(root, "jump")!.ontouchstart(touchEvent);
    findControl(root, "jump")!.ontouchend(touchEvent);
    findControl(root, "sneak")!.ontouchstart(touchEvent);
    findControl(root, "sneak")!.ontouchend(touchEvent);
    findControl(root, "attack")!.ontouchstart(touchEvent);
    findControl(root, "attack")!.ontouchend(touchEvent);
    findControl(root, "use")!.ontouchstart(touchEvent);
    findControl(root, "use")!.ontouchend(touchEvent);

    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "keydown", key: "q", code: "KeyQ", keyCode: 81 }),
      expect.objectContaining({ type: "keyup", key: "q", code: "KeyQ", keyCode: 81 }),
      expect.objectContaining({ type: "keydown", key: " ", code: "Space", keyCode: 32 }),
      expect.objectContaining({ type: "keyup", key: " ", code: "Space", keyCode: 32 }),
      expect.objectContaining({ type: "keydown", key: "Shift", code: "ShiftLeft", keyCode: 16 }),
      expect.objectContaining({ type: "keyup", key: "Shift", code: "ShiftLeft", keyCode: 16 }),
      expect.objectContaining({ type: "mousedown", button: 0, buttons: 1 }),
      expect.objectContaining({ type: "mouseup", button: 0, buttons: 0 }),
      expect.objectContaining({ type: "mousedown", button: 2, buttons: 2 }),
      expect.objectContaining({ type: "mouseup", button: 2, buttons: 0 }),
    ]);
  });

  it("selects a hotbar slot when its rendered canvas cell is tapped", () => {
    const { canvas, canvasEvents, handlers, options } = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    canvas.requestPointerLock();
    hooks.screenChanged("", 480, 300, 960, 600, 2);

    const tapSlot = (identifier: number, clientX: number) => {
      handlers.get("touchstart")?.[0]({
        target: canvas,
        changedTouches: [{ identifier, clientX, clientY: 578 }],
        preventDefault: vi.fn(),
      });
      handlers.get("touchend")?.[0]({
        type: "touchend",
        target: canvas,
        changedTouches: [{ identifier, clientX, clientY: 578 }],
        preventDefault: vi.fn(),
      });
    };

    tapSlot(21, 320);
    tapSlot(22, 640);

    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "keydown", key: "1", code: "Digit1", keyCode: 49 }),
      expect.objectContaining({ type: "keyup", key: "1", code: "Digit1", keyCode: 49 }),
      expect.objectContaining({ type: "keydown", key: "9", code: "Digit9", keyCode: 57 }),
      expect.objectContaining({ type: "keyup", key: "9", code: "Digit9", keyCode: 57 }),
    ]);
    expect(canvasEvents.some(({ type }) => type === "click" || type === "mousedown")).toBe(false);
  });

  it("holds mobile movement keys until the matching touch ends", () => {
    const { canvas, canvasEvents, documentObject, locatorElementsById, options } = loadBridge(
      undefined,
      true,
      undefined,
      { maxTouchPoints: 5, renderDom: true },
    );
    const root = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    const forward = findControl(root, "forward")!;
    const touchEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    canvas.requestPointerLock();
    expect(documentObject.pointerLockElement).toBe(canvas);
    expect(root).toMatchObject({ className: "is-gameplay", style: { display: "block" } });

    forward.ontouchstart(touchEvent);
    forward.ontouchend(touchEvent);

    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keyup"]);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ key: "w", code: "KeyW", keyCode: 87 }),
      expect.objectContaining({ key: "w", code: "KeyW", keyCode: 87 }),
    ]);
    expect(touchEvent.preventDefault).toHaveBeenCalledTimes(2);

    canvasEvents.length = 0;
    const chat = findControl(root, "chat")!;
    chat.ontouchstart(touchEvent);
    chat.ontouchend(touchEvent);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "keydown", key: "t", code: "KeyT", keyCode: 84, __spawnpointMobileControl: true }),
      expect.objectContaining({ type: "keyup", key: "t", code: "KeyT", keyCode: 84, __spawnpointMobileControl: true }),
    ]);
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    expect(locatorElementsById.get("spawnpoint-mobile-chat")?.style.display).toBe("flex");
  });

  it("sends Korean text through the portal API and closes native slash chat without submitting it", async () => {
    const {
      canvas,
      canvasEvents,
      clientTextInputEvents,
      documentObject,
      locatorElementsById,
      options,
      windowObject,
    } = loadBridge(undefined, true, undefined, {
      renderDom: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148",
    });
    canvas.requestPointerLock();
    const controls = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    const chat = findControl(controls, "chat")!;
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    chat.ontouchstart(touchEvent);
    chat.ontouchend(touchEvent);
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);

    const composer = locatorElementsById.get("spawnpoint-mobile-chat")!;
    const input = composer.children[0];
    const send = findControl(composer, "chat-send")!;
    expect(composer.style.display).toBe("flex");
    expect(controls.className).toBe("is-chat");
    expect(findControl(controls, "menu")).toMatchObject({ textContent: "ESC", "aria-label": "게임 메뉴 열기" });
    expect(findControl(controls, "chat-exit")).toMatchObject({ textContent: "ESC", "aria-label": "채팅 닫기" });
    expect(send.textContent).toBe("전송");
    expect(documentObject.activeElement).toBe(input);
    expect(canvasEvents.slice(0, 2)).toEqual([
      expect.objectContaining({ type: "keydown", key: "t", code: "KeyT", keyCode: 84, __spawnpointMobileControl: true }),
      expect.objectContaining({ type: "keyup", key: "t", code: "KeyT", keyCode: 84, __spawnpointMobileControl: true }),
    ]);
    expect(input).toMatchObject({
      type: "text",
      inputMode: "text",
      lang: "ko-KR",
      enterKeyHint: "send",
      "aria-label": "채팅 입력",
    });

    input.value = "안녕";
    input.oncompositionstart();
    input.oninput({ isComposing: true });
    input.oncompositionend();
    expect(clientTextInputEvents).toHaveLength(0);
    expect(documentObject.activeElement).toBe(input);

    input.value = "/say 안";
    input.oninput({ isComposing: false });
    expect(clientTextInputEvents).toHaveLength(0);

    canvasEvents.length = 0;
    const enterEvent = {
      key: "Enter",
      keyCode: 13,
      isComposing: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    input.onkeydown(enterEvent);
    await vi.waitFor(() => expect(composer.style.display).toBe("none"));
    expect(enterEvent.preventDefault).toHaveBeenCalledOnce();
    expect(enterEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(clientTextInputEvents).toHaveLength(0);
    expect(windowObject.fetch).toHaveBeenCalledWith("/api/game/chat", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ launchId: "launch-123", message: "/say 안" }),
    }));
    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keyup"]);
    canvasEvents.forEach((event) => expect(event).toMatchObject({
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      __spawnpointClientChatClose: true,
    }));
    expect(canvasEvents.some(({ key }) => key === "Enter")).toBe(false);

    const style = documentObject.head.children.find(
      (element: Record<string, unknown>) => element.id === "spawnpoint-mobile-control-style",
    );
    expect(style?.textContent).toContain("#spawnpoint-mobile-chat input");
    expect(style?.textContent).toContain("font:400 16px");
    expect(style?.textContent).toContain("/game/fonts/Galmuri11.woff2");
    expect(style?.textContent).toContain("padding:0;background:transparent;border:0;border-radius:0;box-shadow:none");
    expect(style?.textContent).toContain("#spawnpoint-mobile-controls.is-chat .sp-mobile-button.sp-mobile-chat-only{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));display:grid}");
  });

  it("recalls sent chat with ArrowUp and restores the draft with ArrowDown", async () => {
    const { locatorElementsById, options, windowObject } = loadBridge(undefined, true, undefined, { renderDom: true });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const composer = locatorElementsById.get("spawnpoint-mobile-chat")!;
    const input = composer.children[0];
    const send = findControl(composer, "chat-send")!;

    input.value = "첫 메시지";
    input.oninput({ isComposing: false });
    send.onclick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    await vi.waitFor(() => expect(windowObject.fetch).toHaveBeenCalledWith("/api/game/chat", expect.objectContaining({
      body: JSON.stringify({ launchId: "launch-123", message: "첫 메시지" }),
    })));
    await vi.waitFor(() => expect(composer.style.display).toBe("none"));

    hooks.screenChanged("", 480, 300, 960, 600, 2);
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    input.value = "작성 중";
    input.oninput({ isComposing: false });
    const up = { key: "ArrowUp", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    input.onkeydown(up);
    expect(input.value).toBe("첫 메시지");
    expect(up.preventDefault).toHaveBeenCalledOnce();

    const down = { key: "ArrowDown", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    input.onkeydown(down);
    expect(input.value).toBe("작성 중");
    expect(down.preventDefault).toHaveBeenCalledOnce();
  });

  it("renders a top-left Escape control for inventory and other game UI", () => {
    const { canvas, canvasEvents, locatorElementsById, options } = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    canvas.requestPointerLock();
    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    const controls = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const menuBack = findControl(controls, "menu-back")!;
    const style = locatorElementsById.get("spawnpoint-mobile-control-style");

    expect(controls.className).toBe("is-menu");
    expect(menuBack).toMatchObject({ textContent: "ESC", "aria-label": "화면 닫기" });
    expect(style?.textContent).toContain("#spawnpoint-mobile-controls.is-menu .sp-mobile-button.sp-mobile-menu-only{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));display:grid}");
    expect(findControl(controls, "keyboard")).toBeUndefined();

    menuBack.onclick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keypress", "keyup"]);
    canvasEvents.forEach((event) => expect(event).toMatchObject({
      key: "`",
      code: "Backquote",
      __spawnpointRelayedBackquote: true,
    }));
  });

  it("translates mobile canvas drags into camera movement and menu taps into clicks", () => {
    const { canvas, canvasEvents, handlers, options } = loadBridge(undefined, true, undefined, {
      coarsePointer: true,
      renderDom: true,
    });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    canvas.requestPointerLock();
    handlers.get("touchstart")?.[0]({
      target: canvas,
      changedTouches: [{ identifier: 7, clientX: 100, clientY: 120 }],
      preventDefault: vi.fn(),
    });
    handlers.get("touchmove")?.[0]({
      target: canvas,
      targetTouches: [{ identifier: 7, clientX: 120, clientY: 110 }],
      preventDefault: vi.fn(),
    });
    handlers.get("touchend")?.[0]({
      type: "touchend",
      target: canvas,
      changedTouches: [{ identifier: 7, clientX: 120, clientY: 110 }],
      preventDefault: vi.fn(),
    });

    const cameraMove = canvasEvents.find(({ type }) => type === "mousemove");
    expect(cameraMove?.movementX).toBeCloseTo(27);
    expect(cameraMove?.movementY).toBeCloseTo(-13.5);
    expect(canvasEvents.some(({ type }) => type === "click")).toBe(false);

    canvasEvents.length = 0;
    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    handlers.get("touchstart")?.[0]({
      target: canvas,
      changedTouches: [{ identifier: 8, clientX: 240, clientY: 180 }],
      preventDefault: vi.fn(),
    });
    handlers.get("touchend")?.[0]({
      type: "touchend",
      target: canvas,
      changedTouches: [{ identifier: 8, clientX: 240, clientY: 180 }],
      preventDefault: vi.fn(),
    });

    expect(canvasEvents.map(({ type }) => type)).toEqual(["mousedown", "mouseup", "click"]);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ clientX: 240, clientY: 180, buttons: 1 }),
      expect.objectContaining({ clientX: 240, clientY: 180, buttons: 0 }),
      expect.objectContaining({ clientX: 240, clientY: 180, buttons: 0 }),
    ]);
  });

  it("moves the camera when a gameplay control touch turns into a drag", () => {
    const { canvas, canvasEvents, handlers, locatorElementsById } = loadBridge(undefined, true, undefined, {
      coarsePointer: true,
      renderDom: true,
    });
    const controls = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const forward = findControl(controls, "forward")!;
    canvas.requestPointerLock();

    const startEvent = {
      target: forward,
      changedTouches: [{ identifier: 51, clientX: 90, clientY: 500 }],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlers.get("touchstart")?.[0](startEvent);
    forward.ontouchstart(startEvent);
    handlers.get("touchmove")?.[0]({
      target: forward,
      targetTouches: [{ identifier: 51, clientX: 110, clientY: 490 }],
      preventDefault: vi.fn(),
    });
    const endEvent = {
      type: "touchend",
      target: forward,
      changedTouches: [{ identifier: 51, clientX: 110, clientY: 490 }],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlers.get("touchend")?.[0](endEvent);
    forward.ontouchend(endEvent);

    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "keydown", key: "w", code: "KeyW" }),
      expect.objectContaining({ type: "mousemove", movementX: 27, movementY: -13.5, buttons: 0 }),
      expect.objectContaining({ type: "keyup", key: "w", code: "KeyW" }),
    ]);
    expect(canvasEvents.some(({ type }) => type === "click" || type === "mousedown")).toBe(false);
  });

  it("keeps a dragged attack control held until the finger is released", () => {
    const { canvas, canvasEvents, handlers, locatorElementsById } = loadBridge(undefined, true, undefined, {
      coarsePointer: true,
      renderDom: true,
    });
    const controls = locatorElementsById.get("spawnpoint-mobile-controls")!;
    const attack = findControl(controls, "attack")!;
    canvas.requestPointerLock();

    const startEvent = {
      target: attack,
      changedTouches: [{ identifier: 52, clientX: 850, clientY: 480 }],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlers.get("touchstart")?.[0](startEvent);
    attack.ontouchstart(startEvent);
    handlers.get("touchmove")?.[0]({
      target: attack,
      targetTouches: [{ identifier: 52, clientX: 870, clientY: 470 }],
      preventDefault: vi.fn(),
    });
    const endEvent = {
      type: "touchend",
      target: attack,
      changedTouches: [{ identifier: 52, clientX: 870, clientY: 470 }],
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handlers.get("touchend")?.[0](endEvent);
    attack.ontouchend(endEvent);

    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "mousedown", button: 0, buttons: 1 }),
      expect.objectContaining({ type: "mousemove", movementX: 27, movementY: -13.5, buttons: 1 }),
      expect.objectContaining({ type: "mouseup", button: 0, buttons: 0 }),
    ]);
    expect(canvasEvents.some(({ type }) => type === "click")).toBe(false);
  });

  it("restores the saved mobile look sensitivity", () => {
    const { canvas, canvasEvents, handlers } = loadBridge(undefined, true, undefined, {
      coarsePointer: true,
      mobileLookSensitivity: 4.05,
      renderDom: true,
    });
    canvas.requestPointerLock();
    handlers.get("touchstart")?.[0]({
      target: canvas,
      changedTouches: [{ identifier: 17, clientX: 100, clientY: 120 }],
      preventDefault: vi.fn(),
    });
    handlers.get("touchmove")?.[0]({
      target: canvas,
      targetTouches: [{ identifier: 17, clientX: 110, clientY: 115 }],
      preventDefault: vi.fn(),
    });

    expect(canvasEvents.find(({ type }) => type === "mousemove")).toMatchObject({
      movementX: 40.5,
      movementY: -20.25,
    });
  });

  it("keeps mobile canvas drags inside the game after the client rewrites its style", () => {
    const { canvas, triggerMutation } = loadBridge(undefined, true, undefined, {
      coarsePointer: true,
      renderDom: true,
    });

    expect(canvas.style.touchAction).toBe("none");

    canvas.style.touchAction = "pan-x pan-y";
    triggerMutation();

    expect(canvas.style.touchAction).toBe("none");
  });

  it("taps to attack and holds the gameplay canvas to keep breaking", () => {
    const { canvas, canvasEvents, handlers, runWindowTimeouts } = loadBridge(undefined, true, undefined, {
      coarsePointer: true,
      renderDom: true,
    });
    canvas.requestPointerLock();

    handlers.get("touchstart")?.[0]({
      target: canvas,
      changedTouches: [{ identifier: 31, clientX: 240, clientY: 180 }],
      preventDefault: vi.fn(),
    });
    handlers.get("touchend")?.[0]({
      type: "touchend",
      target: canvas,
      changedTouches: [{ identifier: 31, clientX: 240, clientY: 180 }],
      preventDefault: vi.fn(),
    });
    expect(canvasEvents.map(({ type }) => type)).toEqual(["mousedown", "mouseup", "click"]);

    canvasEvents.length = 0;
    handlers.get("touchstart")?.[0]({
      target: canvas,
      changedTouches: [{ identifier: 32, clientX: 240, clientY: 180 }],
      preventDefault: vi.fn(),
    });
    expect(canvasEvents).toHaveLength(0);
    runWindowTimeouts();
    expect(canvasEvents).toEqual([expect.objectContaining({ type: "mousedown", button: 0, buttons: 1 })]);
    handlers.get("touchmove")?.[0]({
      target: canvas,
      targetTouches: [{ identifier: 32, clientX: 260, clientY: 180 }],
      preventDefault: vi.fn(),
    });
    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "mousedown", button: 0, buttons: 1 }),
      expect.objectContaining({ type: "mousemove", buttons: 1 }),
    ]);
    handlers.get("touchend")?.[0]({
      type: "touchend",
      target: canvas,
      changedTouches: [{ identifier: 32, clientX: 260, clientY: 180 }],
      preventDefault: vi.fn(),
    });
    expect(canvasEvents).toEqual([
      expect.objectContaining({ type: "mousedown", button: 0, buttons: 1 }),
      expect.objectContaining({ type: "mousemove", buttons: 1 }),
      expect.objectContaining({ type: "mouseup", button: 0, buttons: 0 }),
    ]);
  });

  it("does not let the mutation observer focus hidden input outside chat", () => {
    const {
      canvas,
      clientTextInput,
      documentObject,
      keyboardZone,
      triggerMutation,
    } = loadBridge();
    keyboardZone.dispatchEvent({ type: "touchend" });

    documentObject.activeElement = clientTextInput;
    triggerMutation();
    expect(documentObject.activeElement).toBeNull();
    expect(clientTextInput).toMatchObject({ type: "text", lang: "ko-KR" });

    documentObject.activeElement = canvas;
    triggerMutation();
    expect(documentObject.activeElement).toBe(canvas);
  });

  it("passes movement keys to the runtime when a stale hidden input still has focus", () => {
    const {
      clientTextInput,
      documentObject,
      keyboardZone,
      windowHandlers,
      windowObject,
    } = loadBridge();
    keyboardZone.dispatchEvent({ type: "touchend" });
    documentObject.activeElement = clientTextInput;
    const runtimeListener = vi.fn();
    windowObject.addEventListener("keydown", runtimeListener, true);

    windowHandlers.get("keydown")?.at(-1)?.({
      target: clientTextInput,
      key: "w",
      code: "KeyW",
      keyCode: 87,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });

    expect(runtimeListener).toHaveBeenCalledOnce();
  });

  it("relays Enter from the hidden IME input to Minecraft's canvas", () => {
    const { canvas, canvasEvents, clientTextInput, handlers, options } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const event = {
      target: clientTextInput,
      key: "Enter",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    handlers.get("keydown")?.[0](event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(canvasEvents.slice(-2).map(({ type }) => type)).toEqual(["keydown", "keyup"]);
    expect(canvasEvents.at(-2)).toMatchObject({ key: "Enter", keyCode: 13 });
    expect(canvas).toBeDefined();
  });

  it("closes chat through the client canvas Exit Chat control before blurring input", () => {
    const {
      bodyEvents,
      canvasActiveStates,
      canvasEvents,
      clientTextInput,
      clientTextInputEvents,
      documentObject,
      options,
      windowHandlers,
    } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const event = {
      target: clientTextInput,
      type: "keydown",
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      repeat: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    windowHandlers.get("keydown")?.[1](event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(documentObject.activeElement).not.toBe(clientTextInput);
    expect(canvasEvents.map(({ type }) => type)).toEqual(["mousedown", "mouseup", "click"]);
    expect(canvasActiveStates).toEqual([clientTextInput, clientTextInput, clientTextInput]);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ clientX: 910, clientY: 12, button: 0, buttons: 1 }),
      expect.objectContaining({ clientX: 910, clientY: 12, button: 0, buttons: 0 }),
      expect.objectContaining({ clientX: 910, clientY: 12, button: 0, buttons: 0 }),
    ]);
    expect(clientTextInputEvents).toEqual([]);
    expect(bodyEvents).toEqual([]);
  });

  it("closes a pause menu opened by the same Escape that dismissed chat", () => {
    const { canvasEvents, clientTextInput, options, windowHandlers } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);

    windowHandlers.get("keydown")?.[1]({
      target: clientTextInput,
      type: "keydown",
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      repeat: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    hooks.screenChanged("net.minecraft.client.gui.GuiIngameMenu", 480, 300, 960, 600, 2);

    expect(canvasEvents.map(({ type }) => type)).toEqual([
      "mousedown",
      "mouseup",
      "click",
      "keydown",
      "keypress",
      "keyup",
    ]);
    canvasEvents.slice(-3).forEach((event) => expect(event).toMatchObject({
      key: "`",
      code: "Backquote",
      __spawnpointRelayedBackquote: true,
    }));
  });

  it("does not open the pause menu after Escape closes another game UI", () => {
    const { canvas, canvasEvents, options, windowHandlers } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    windowHandlers.get("keydown")?.[1]({
      target: canvas,
      type: "keydown",
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      repeat: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    hooks.screenChanged("net.minecraft.client.gui.GuiIngameMenu", 480, 300, 960, 600, 2);

    expect(canvasEvents.map(({ type }) => type)).toEqual([
      "keydown", "keypress", "keyup",
      "keydown", "keypress", "keyup",
    ]);
    canvasEvents.forEach((event) => expect(event).toMatchObject({
      code: "Backquote",
      __spawnpointRelayedBackquote: true,
    }));
    expect(canvas.style.cursor).toBe("none");
  });

  it("reclaims pointer lock inside the physical Escape that closes an inventory UI", () => {
    const { canvas, documentObject, options, windowHandlers } = loadBridge(
      undefined,
      true,
      undefined,
      { nativePointerLock: true },
    );
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    expect(canvas.style.cursor).toBe("");

    windowHandlers.get("keydown")?.[1]({
      target: canvas,
      type: "keydown",
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      repeat: false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });

    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(documentObject.pointerLockElement).toBe(canvas);
    expect(canvas.style.cursor).toBe("none");
  });

  it("maps physical Escape to marked back action on gameplay and menu targets", () => {
    const { body, bodyEvents, canvas, canvasEvents, windowHandlers } = loadBridge();
    const escapeListener = windowHandlers.get("keydown")?.[1];
    const pressEscape = (target: typeof canvas | typeof body) => {
      const event = {
        target,
        type: "keydown",
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        repeat: false,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      };
      escapeListener?.(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    };

    pressEscape(canvas);
    pressEscape(body);

    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keypress", "keyup"]);
    expect(bodyEvents.map(({ type }) => type)).toEqual(["keydown", "keypress", "keyup"]);
    [...canvasEvents, ...bodyEvents].forEach((event) => expect(event).toMatchObject({
      key: "`",
      code: "Backquote",
      __spawnpointRelayedBackquote: true,
    }));
  });

  it("disables the Backquote pause alias outside text input", () => {
    const { canvas, clientTextInput, handlers } = loadBridge();
    const gameplayEvent = {
      target: canvas,
      key: "`",
      code: "Backquote",
      keyCode: 192,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    const chatEvent = {
      ...gameplayEvent,
      target: clientTextInput,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    handlers.get("keydown")?.[1](gameplayEvent);
    handlers.get("keydown")?.[1](chatEvent);

    expect(gameplayEvent.preventDefault).toHaveBeenCalledOnce();
    expect(gameplayEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(chatEvent.preventDefault).not.toHaveBeenCalled();
    expect(chatEvent.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("lets only marked synthetic Backquote bypass every runtime guard", () => {
    const { canvas, handlers, windowHandlers, windowObject } = loadBridge();
    const runtimeListener = vi.fn();
    windowObject.addEventListener("keydown", runtimeListener, true);
    const wrappedRuntimeListener = windowHandlers.get("keydown")?.at(-1);
    const markedEvent = {
      target: canvas,
      type: "keydown",
      key: "`",
      code: "Backquote",
      keyCode: 192,
      __spawnpointRelayedBackquote: true,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    handlers.get("keydown")?.[1](markedEvent);
    wrappedRuntimeListener?.(markedEvent);

    expect(markedEvent.preventDefault).not.toHaveBeenCalled();
    expect(markedEvent.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(runtimeListener).toHaveBeenCalledOnce();
  });

  it("lets the marked client-chat Escape reach the runtime without becoming another portal Escape", () => {
    const { canvas, windowHandlers, windowObject } = loadBridge();
    const runtimeListener = vi.fn();
    windowObject.addEventListener("keydown", runtimeListener, true);
    let stopped = false;
    const event = {
      target: canvas,
      type: "keydown",
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      __spawnpointClientChatClose: true,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(() => { stopped = true; }),
    };

    for (const listener of windowHandlers.get("keydown") ?? []) {
      listener(event);
      if (stopped) break;
    }

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(runtimeListener).toHaveBeenCalledOnce();
  });

  it("blocks Backquote at window capture before the vendored runtime sees it", () => {
    const { canvas, clientTextInput, handlers, windowHandlers } = loadBridge();
    const runtimeWindowListener = vi.fn();
    const runtimeDocumentListener = vi.fn();
    windowHandlers.get("keydown")?.push(runtimeWindowListener);
    handlers.get("keydown")?.push(runtimeDocumentListener);

    const dispatch = (target: typeof canvas | typeof clientTextInput) => {
      let stopped = false;
      const event = {
        target,
        key: "`",
        code: "Backquote",
        keyCode: 192,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(() => { stopped = true; }),
      };
      for (const listener of windowHandlers.get("keydown") ?? []) {
        listener(event);
        if (stopped) break;
      }
      if (!stopped) {
        for (const listener of handlers.get("keydown") ?? []) {
          listener(event);
          if (stopped) break;
        }
      }
      return event;
    };

    const gameplayEvent = dispatch(canvas);
    expect(gameplayEvent.preventDefault).toHaveBeenCalledOnce();
    expect(runtimeWindowListener).not.toHaveBeenCalled();
    expect(runtimeDocumentListener).not.toHaveBeenCalled();

    const chatEvent = dispatch(clientTextInput);
    expect(chatEvent.preventDefault).not.toHaveBeenCalled();
    expect(runtimeWindowListener).toHaveBeenCalledOnce();
    expect(runtimeDocumentListener).toHaveBeenCalledOnce();
  });

  it("blocks every event in a full Backquote press before the runtime", () => {
    const { canvas, clientTextInput, handlers, windowHandlers } = loadBridge();
    const eventNames = ["keydown", "keypress", "keyup"];
    const runtimeWindowListener = vi.fn();
    const runtimeDocumentListener = vi.fn();
    eventNames.forEach((eventName) => {
      windowHandlers.get(eventName)?.push(runtimeWindowListener);
      handlers.get(eventName)?.push(runtimeDocumentListener);
    });

    const dispatchPress = (target: typeof canvas | typeof clientTextInput) => eventNames.map((type) => {
      let stopped = false;
      const event = {
        type,
        target,
        key: "`",
        code: "Backquote",
        keyCode: 192,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(() => { stopped = true; }),
      };
      for (const listener of windowHandlers.get(type) ?? []) {
        listener(event);
        if (stopped) break;
      }
      if (!stopped) {
        for (const listener of handlers.get(type) ?? []) {
          listener(event);
          if (stopped) break;
        }
      }
      return event;
    });

    const gameplayEvents = dispatchPress(canvas);
    gameplayEvents.forEach((event) => expect(event.preventDefault).toHaveBeenCalledOnce());
    expect(runtimeWindowListener).not.toHaveBeenCalled();
    expect(runtimeDocumentListener).not.toHaveBeenCalled();

    const chatEvents = dispatchPress(clientTextInput);
    chatEvents.forEach((event) => expect(event.preventDefault).not.toHaveBeenCalled());
    expect(runtimeWindowListener).toHaveBeenCalledTimes(3);
    expect(runtimeDocumentListener).toHaveBeenCalledTimes(3);
  });

  it("keeps text keys in the native input while preserving runtime navigation and removal", () => {
    const {
      canvas,
      clientTextInput,
      documentObject,
      handlers,
      options,
      windowHandlers,
      windowObject,
    } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const windowRuntimeListener = vi.fn();
    const documentRuntimeListener = { handleEvent: vi.fn() };

    windowObject.addEventListener("keyup", windowRuntimeListener, true);
    documentObject.addEventListener("keypress", documentRuntimeListener, false);
    const wrappedWindowListener = windowHandlers.get("keyup")?.at(-1);
    const wrappedDocumentListener = handlers.get("keypress")?.at(-1);
    expect(wrappedWindowListener).not.toBe(windowRuntimeListener);
    expect(wrappedDocumentListener).not.toBe(documentRuntimeListener);

    const eventFor = (
      target: typeof canvas | typeof clientTextInput,
      key = "`",
      code = "Backquote",
      keyCode = 192,
    ) => ({
      target,
      key,
      code,
      keyCode,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    wrappedWindowListener?.(eventFor(canvas));
    wrappedDocumentListener?.(eventFor(canvas));
    expect(windowRuntimeListener).not.toHaveBeenCalled();
    expect(documentRuntimeListener.handleEvent).not.toHaveBeenCalled();

    wrappedWindowListener?.(eventFor(clientTextInput));
    wrappedDocumentListener?.(eventFor(clientTextInput));
    expect(windowRuntimeListener).not.toHaveBeenCalled();
    expect(documentRuntimeListener.handleEvent).not.toHaveBeenCalled();

    wrappedWindowListener?.(eventFor(clientTextInput, "ArrowLeft", "ArrowLeft", 37));
    wrappedDocumentListener?.(eventFor(clientTextInput, "ArrowLeft", "ArrowLeft", 37));
    expect(windowRuntimeListener).toHaveBeenCalledOnce();
    expect(documentRuntimeListener.handleEvent).toHaveBeenCalledOnce();

    windowObject.removeEventListener("keyup", windowRuntimeListener, true);
    documentObject.removeEventListener("keypress", documentRuntimeListener, false);
    expect(windowHandlers.get("keyup")).not.toContain(wrappedWindowListener);
    expect(handlers.get("keypress")).not.toContain(wrappedDocumentListener);
  });

  it("keeps text keys out of later onkey assignments while exposing the assigned handler", () => {
    const {
      canvas,
      clientTextInput,
      documentObject,
      documentPropertyHandlers,
      options,
      windowObject,
      windowPropertyHandlers,
    } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const windowRuntimeHandler = vi.fn();
    const documentRuntimeHandler = vi.fn();

    windowObject.onkeydown = windowRuntimeHandler;
    documentObject.onkeyup = documentRuntimeHandler;
    expect(windowObject.onkeydown).toBe(windowRuntimeHandler);
    expect(documentObject.onkeyup).toBe(documentRuntimeHandler);

    const eventFor = (
      target: typeof canvas | typeof clientTextInput,
      key = "`",
      code = "Backquote",
      keyCode = 192,
    ) => ({
      target,
      key,
      code,
      keyCode,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    windowPropertyHandlers.get("onkeydown")?.(eventFor(canvas));
    documentPropertyHandlers.get("onkeyup")?.(eventFor(canvas));
    expect(windowRuntimeHandler).not.toHaveBeenCalled();
    expect(documentRuntimeHandler).not.toHaveBeenCalled();

    windowPropertyHandlers.get("onkeydown")?.(eventFor(clientTextInput));
    documentPropertyHandlers.get("onkeyup")?.(eventFor(clientTextInput));
    expect(windowRuntimeHandler).not.toHaveBeenCalled();
    expect(documentRuntimeHandler).not.toHaveBeenCalled();

    windowPropertyHandlers.get("onkeydown")?.(eventFor(clientTextInput, "ArrowLeft", "ArrowLeft", 37));
    documentPropertyHandlers.get("onkeyup")?.(eventFor(clientTextInput, "ArrowLeft", "ArrowLeft", 37));
    expect(windowRuntimeHandler).toHaveBeenCalledOnce();
    expect(documentRuntimeHandler).toHaveBeenCalledOnce();

    windowObject.onkeydown = null;
    documentObject.onkeyup = null;
    expect(windowPropertyHandlers.get("onkeydown")).toBeNull();
    expect(documentPropertyHandlers.get("onkeyup")).toBeNull();
  });

  it("does not turn a pointer-lock release into a menu key", () => {
    const { canvas, canvasEvents, documentObject, handlers } = loadBridge();

    documentObject.pointerLockElement = canvas;
    handlers.get("pointerlockchange")?.forEach((handler) => handler({}));
    documentObject.pointerLockElement = null;
    handlers.get("pointerlockchange")?.forEach((handler) => handler({}));

    expect(canvasEvents).toEqual([]);
  });

  it("releases pointer lock and canvas focus on the death screen", () => {
    const { canvas, documentObject, options } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    documentObject.pointerLockElement = canvas;
    documentObject.activeElement = canvas;
    documentObject.exitPointerLock = vi.fn(() => { documentObject.pointerLockElement = null; });

    hooks.screenChanged("net.minecraft.client.gui.GuiGameOver", 480, 300, 960, 600, 2);

    expect(documentObject.exitPointerLock).toHaveBeenCalledOnce();
    expect(documentObject.pointerLockElement).toBeNull();
    expect(documentObject.activeElement).toBeNull();
  });

  it("returns to the portal through the native Edit Profile button action", () => {
    const { options, parentMessages } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };

    hooks.screenChanged("net.minecraft.client.gui.GuiMainMenu", 480, 300, 960, 600, 2);
    hooks.screenChanged("net.lax1dude.eaglercraft.profile.GuiScreenEditProfile", 480, 300, 960, 600, 2);

    expect(parentMessages).toEqual([{
      message: { type: "spawnpoint:return-to-menu", launchId: "launch-123" },
      targetOrigin: "https://spawnpoint.test",
    }]);
  });

  it("keeps inventory clicks and drags active at the former profile-button coordinates", () => {
    const { canvas, handlers, options } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    const event = {
      target: canvas,
      clientX: 500,
      clientY: 420,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    handlers.get("pointerdown")?.[0](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
