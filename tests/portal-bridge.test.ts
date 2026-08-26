import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const bridgeSource = fs.readFileSync(path.join(process.cwd(), "public/game/portal-bridge.js"), "utf8");

type BridgeEnvironment = {
  coarsePointer?: boolean;
  maxTouchPoints?: number;
  renderDom?: boolean;
  userAgent?: string;
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
  if (gameSettings !== undefined) {
    storage.set("_spawnpoint_mossrunner.g", Buffer.from(gameSettings, "binary").toString("base64"));
  }
  const canvas = {
    width: 960,
    height: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 960, bottom: 600, width: 960, height: 600 }),
    dispatchEvent: (event: Record<string, unknown>) => {
      canvasEvents.push(event);
      canvasActiveStates.push(documentObject.activeElement);
      return true;
    },
    focus() {
      documentObject.activeElement = canvas;
    },
  };
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
  const clientTextInput = {
    classList: { contains: (name: string) => name === "_eaglercraftX_text_input_element" },
    dispatchEvent: (event: Record<string, unknown>) => {
      clientTextInputEvents.push(event);
      clientTextInputActiveStates.push(documentObject.activeElement === clientTextInput);
      return true;
    },
    blur() {
      documentObject.activeElement = null;
    },
    focus() {
      documentObject.activeElement = clientTextInput;
    },
    inputMode: "",
    lang: "",
    setSelectionRange: vi.fn(),
    spellcheck: true,
    type: "password",
    value: " ",
  };
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
  class FakeMutationObserver {
    constructor(callback: (records: Array<Record<string, unknown>>) => void) {
      mutationObserverCallback = callback;
    }

    observe() {}
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
    MouseEvent: FakeEvent,
    MutationObserver: FakeMutationObserver,
    PointerEvent: FakeEvent,
    WheelEvent: FakeEvent,
    Proxy,
    WeakMap,
    WebSocket: FakeWebSocket,
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
    location: {
      search: "?account=mossrunner&launch=launch-123",
      protocol: "https:",
      host: "spawnpoint.test",
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
    windowObject.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => locatorSnapshot,
    }));
    windowObject.setInterval = vi.fn((callback: () => void, delay: number) => {
      locatorIntervals.push({ callback, delay });
      return locatorIntervals.length;
    });
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

  vm.runInNewContext(bridgeSource, {
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
    documentObject,
    keyboardZone,
    locatorContexts,
    locatorElementsById,
    locatorIntervals,
    options,
    parentMessages,
    storage,
    triggerMutation: () => mutationObserverCallback?.([{}]),
    documentPropertyHandlers,
    windowHandlers,
    windowPropertyHandlers,
    windowObject,
  };
}

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

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "lang:ko_KR\nautoJump:false\nfov:0.5\nenableDynamicLights:true\nao:2\ntutorialStep:none\n",
    );
  });

  it("seeds Korean when the WASM shell has no native base64 helpers", () => {
    const encoded = loadBridge(undefined, false).storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "lang:ko_KR\nautoJump:false\nfov:0.5\nenableDynamicLights:true\nao:2\ntutorialStep:none\n",
    );
  });

  it("serves Korean settings through the WASM local-storage hook", () => {
    const { options } = loadBridge("version:1343\nlang:en_us\nmouseSensitivity:0.75\n");
    const hooks = options.hooks as {
      localStorageLoaded: (key: string) => string | null;
    };

    expect(Buffer.from(hooks.localStorageLoaded("_spawnpoint_mossrunner.g") ?? "", "base64").toString("binary")).toBe(
      "version:1343\nlang:ko_KR\nmouseSensitivity:0.75\nautoJump:false\nfov:0.5\nenableDynamicLights:true\nao:2\ntutorialStep:none\n",
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
      "lang:ko_KR\nautoJump:false\nfov:0.5\nenableDynamicLights:true\nao:2\ntutorialStep:none\n",
    );
  });

  it("forces Korean without resetting existing Minecraft preferences", () => {
    const { storage } = loadBridge("version:1343\nlang:en_us\nmouseSensitivity:0.75\nautoJump:false\n");
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "version:1343\nlang:ko_KR\nmouseSensitivity:0.75\nautoJump:false\nfov:0.5\nenableDynamicLights:true\nao:2\ntutorialStep:none\n",
    );
  });

  it("preserves per-user values after applying the first-launch defaults", () => {
    const { storage } = loadBridge(
      "lang:en_us\nautoJump:true\nfov:0.25\nenableDynamicLights:false\nao:0\n",
    );
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toBe(
      "lang:ko_KR\nautoJump:true\nfov:0.25\nenableDynamicLights:false\nao:0\ntutorialStep:none\n",
    );
  });

  it("disables the vanilla tutorial for existing accounts", () => {
    const { storage } = loadBridge("lang:ko_KR\ntutorialStep:movement\n");
    const encoded = storage.get("_spawnpoint_mossrunner.g");

    expect(Buffer.from(encoded ?? "", "base64").toString("binary")).toContain("tutorialStep:none\n");
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
    const { documentObject, locatorContexts, locatorElementsById, locatorIntervals, options, windowObject } = loadBridge(
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
    hooks.screenChanged("", 480, 300, 960, 600, 2);

    await vi.waitFor(() => {
      expect(locatorElementsById.get("spawnpoint-player-locator")?.style.display).toBe("block");
    });

    const root = locatorElementsById.get("spawnpoint-player-locator")!;
    const track = root.children[0];
    const marker = track.children[0].children[0];
    const headCanvas = marker.children[0];
    expect(root.style).toMatchObject({
      left: "0px",
      top: "0px",
      width: "960px",
      height: "600px",
      "--sp-locator-pixel": "2px",
      "--sp-locator-width": "364px",
    });
    expect(marker.style.left).toBe("25%");
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
    expect(locatorIntervals).toEqual([{ callback: expect.any(Function), delay: 200 }]);

    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    expect(root.style.display).toBe("none");
    expect(documentObject.body.children).toContain(root);
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

  it("opens and configures the hidden text input when desktop chat opens", () => {
    const { clientTextInput, documentObject, options } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };

    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);

    expect(clientTextInput).toMatchObject({
      type: "text",
      lang: "ko-KR",
      inputMode: "text",
      spellcheck: false,
    });

    hooks.screenChanged("", 480, 300, 960, 600, 2);
    expect(clientTextInput).not.toBe(documentObject.activeElement);
  });

  it("does not let the runtime cancel macOS or Windows IME keys", () => {
    const {
      clientTextInput,
      documentObject,
      options,
      windowHandlers,
      windowObject,
    } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    expect(documentObject.activeElement).toBe(clientTextInput);

    const runtimeListener = vi.fn((event: Record<string, any>) => event.preventDefault());
    windowObject.addEventListener("keydown", runtimeListener);
    const wrappedRuntimeListener = windowHandlers.get("keydown")?.at(-1);
    const imeEvents = [
      { key: "CapsLock", code: "CapsLock", keyCode: 20 },
      { key: "HangulMode", code: "Lang1", keyCode: 21 },
      { key: "Process", code: "KeyR", keyCode: 229, isComposing: true },
    ].map((key) => ({
      ...key,
      target: clientTextInput,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    }));

    imeEvents.forEach((event) => wrappedRuntimeListener?.(event));

    expect(runtimeListener).not.toHaveBeenCalled();
    imeEvents.forEach((event) => expect(event.preventDefault).not.toHaveBeenCalled());

    const englishEvent = {
      target: clientTextInput,
      key: "r",
      code: "KeyR",
      keyCode: 82,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    wrappedRuntimeListener?.(englishEvent);
    expect(runtimeListener).toHaveBeenCalledOnce();
    expect(englishEvent.preventDefault).toHaveBeenCalledOnce();

    const navigationEvent = {
      target: clientTextInput,
      key: "ArrowLeft",
      code: "ArrowLeft",
      keyCode: 37,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    wrappedRuntimeListener?.(navigationEvent);
    expect(runtimeListener).toHaveBeenCalledTimes(2);
    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it("shows online players after /tpa and sends the selected command", async () => {
    const {
      canvasEvents,
      clientTextInputEvents,
      locatorElementsById,
      options,
      windowHandlers,
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
    const draftListener = windowHandlers.get("keydown")?.[1];
    for (const key of ["/", "t", "p", "a"]) {
      draftListener?.({ type: "keydown", key, target: null });
    }

    await vi.waitFor(() => {
      expect(locatorElementsById.get("spawnpoint-tpa-picker")?.style.display).toBe("flex");
      expect(locatorElementsById.get("spawnpoint-tpa-picker")?.children[0].children).toHaveLength(1);
    });

    const button = locatorElementsById.get("spawnpoint-tpa-picker")!.children[0].children[0];
    expect(button).toMatchObject({ textContent: "이끼 러너", title: "/tpa MossRunner" });
    button.onclick({ preventDefault: vi.fn() });

    expect(clientTextInputEvents).toContainEqual(expect.objectContaining({
      type: "beforeinput",
      data: " MossRunner",
      inputType: "insertText",
    }));
    expect(canvasEvents.slice(-2).map(({ type }) => type)).toEqual(["keydown", "keyup"]);
    expect(canvasEvents.at(-2)).toMatchObject({ key: "Enter", keyCode: 13 });
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

  it("holds mobile movement keys until the matching touch ends", () => {
    const { canvas, canvasEvents, documentObject, locatorElementsById } = loadBridge(
      undefined,
      true,
      undefined,
      { maxTouchPoints: 5, renderDom: true },
    );
    const root = locatorElementsById.get("spawnpoint-mobile-controls")!;
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
    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keyup"]);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ key: "t", code: "KeyT", keyCode: 84 }),
      expect.objectContaining({ key: "t", code: "KeyT", keyCode: 84 }),
    ]);
  });

  it("uses the client's Exit Chat target for the mobile back action", () => {
    const { canvas, canvasEvents, locatorElementsById, options } = loadBridge(undefined, true, undefined, {
      maxTouchPoints: 5,
      renderDom: true,
    });
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    canvas.requestPointerLock();
    hooks.screenChanged("net.minecraft.client.gui.GuiChat", 480, 300, 960, 600, 2);
    const back = findControl(locatorElementsById.get("spawnpoint-mobile-controls")!, "menu-back")!;
    const touchEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    back.ontouchstart(touchEvent);
    back.ontouchend(touchEvent);

    expect(canvasEvents.map(({ type }) => type)).toEqual(["mousedown", "mouseup", "click"]);
    expect(canvasEvents).toEqual([
      expect.objectContaining({ clientX: 910, clientY: 12, buttons: 1 }),
      expect.objectContaining({ clientX: 910, clientY: 12, buttons: 0 }),
      expect.objectContaining({ clientX: 910, clientY: 12, buttons: 0 }),
    ]);
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
      windowHandlers,
      windowObject,
    } = loadBridge();
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
      windowObject,
      windowPropertyHandlers,
    } = loadBridge();
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

  it("turns a browser-consumed pointer-lock Escape into one marked back action", () => {
    const { canvas, canvasEvents, documentObject, handlers } = loadBridge();
    const pointerLockChange = handlers.get("pointerlockchange")?.[0];

    documentObject.pointerLockElement = canvas;
    pointerLockChange?.({});
    documentObject.pointerLockElement = null;
    pointerLockChange?.({});

    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keypress", "keyup"]);
    canvasEvents.forEach((event) => expect(event).toMatchObject({
      key: "`",
      code: "Backquote",
      keyCode: 192,
      __spawnpointRelayedBackquote: true,
    }));
  });

  it("does not duplicate Escape when the browser delivered the native key", () => {
    const { canvas, canvasEvents, documentObject, handlers, windowHandlers } = loadBridge();
    const pointerLockChange = handlers.get("pointerlockchange")?.[0];

    documentObject.pointerLockElement = canvas;
    pointerLockChange?.({});
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
    documentObject.pointerLockElement = null;
    pointerLockChange?.({});

    expect(canvasEvents).toHaveLength(3);
    expect(canvasEvents.map(({ type }) => type)).toEqual(["keydown", "keypress", "keyup"]);
  });

  it("does not turn a GUI-triggered pointer unlock into Escape", () => {
    const { canvas, canvasEvents, documentObject, handlers, options } = loadBridge();
    const hooks = options.hooks as {
      screenChanged: (screenName: string, scaledWidth: number, scaledHeight: number, realWidth: number, realHeight: number, scaleFactor: number) => void;
    };
    const pointerLockChange = handlers.get("pointerlockchange")?.[0];

    documentObject.pointerLockElement = canvas;
    pointerLockChange?.({});
    hooks.screenChanged("net.minecraft.client.gui.inventory.GuiInventory", 480, 300, 960, 600, 2);
    documentObject.pointerLockElement = null;
    pointerLockChange?.({});

    expect(canvasEvents).toEqual([]);
  });

  it("blocks the client Edit Profile button in every session", () => {
    const { canvas, handlers } = loadBridge();
    const event = {
      target: canvas,
      clientX: 500,
      clientY: 420,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };

    handlers.get("pointerdown")?.[0](event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });
});
