// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { ServerCard } from "../src/components/portal";
import { AccountDialog } from "../src/features/AccountDialog";
import { AdminPanel, TpaSettingRow } from "../src/features/AdminPanel";
import { SkinStudio } from "../src/features/SkinStudio";
import { ApiError } from "../src/lib/api";
import { AuthScreen } from "../src/screens/AuthScreen";
import { Dashboard } from "../src/screens/Dashboard";
import { GameScreen } from "../src/screens/GameScreen";
import type { AdminOverview, BootstrapData, PlayerDetails, ServerStatus } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/SkinPreview", () => ({ SkinPreview: () => <div data-testid="skin-preview" /> }));
vi.mock("../src/CatalogSkinPreview", () => ({ CatalogSkinPreview: ({ src }: { src: string }) => <canvas data-testid="catalog-skin-3d" data-src={src} /> }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("EventSource", class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    close() {}
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })));
});

const onlineStatus: ServerStatus = {
  phase: "online",
  players: ["qaadmin"],
  startedAt: Date.now(),
  readyAt: Date.now(),
  idleShutdownAt: null,
  lastError: null,
  startAllowedAt: 0,
  maxPlayers: 12,
  version: "1.12.2",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function adminOverview(tpaEnabled: boolean, players: PlayerDetails[] = []): AdminOverview {
  return {
    users: [],
    players,
    bridgeAvailable: true,
    tpaEnabled,
    logs: [],
    server: onlineStatus,
  };
}

const adminData: BootstrapData = {
  user: {
    id: "admin-account",
    username: "qaadmin",
    displayName: "관리자",
    isAdmin: true,
    skin: {
      type: "preset",
      model: "steve",
      label: "Steve",
      previewUrl: "/skins/steve.png",
    },
  },
  csrf: "test-csrf",
  adminExpiresAt: null,
  server: onlineStatus,
  clients: [],
  setup: { eulaAccepted: true },
};

const testPlayer: PlayerDetails = {
  accountId: null,
  uuid: "00000000-0000-4000-8000-000000000001",
  username: "qaadmin",
  displayName: "관리자",
  operator: false,
  world: "world",
  x: 0,
  y: 64,
  z: 0,
  yaw: 0,
  pitch: 0,
  health: 20,
  foodLevel: 20,
  gameMode: "SURVIVAL",
  inventory: [],
  enderChest: [],
};

describe("administrator access", () => {
  it("shows a retry action when bootstrap fails and recovers on demand", async () => {
    const signedOutData = { ...adminData, user: null, csrf: null };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(signedOutData));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("spawnpoint에 연결할 수 없어요");
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "다시 시도")!;
    await act(async () => {
      retry.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("#username")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("does not react to the old hidden admin keyword", async () => {
    const signedOutData = { ...adminData, user: null, csrf: null };
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === "/api/bootstrap") return Promise.resolve(jsonResponse(signedOutData));
      void options;
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      for (const key of "admin") window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: `Key${key.toUpperCase()}`, key }));
    });

    expect(document.body.querySelector('[aria-label="관리자 비밀번호"]')).toBeNull();
    expect(container.querySelector("#username")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/admin-unlock", expect.anything());

    const adminButton = container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement;
    expect(adminButton).toBeTruthy();
    expect(adminButton.parentElement?.querySelector('[aria-label="spawnpoint"]')).toBeTruthy();
    await act(async () => adminButton.click());
    expect(document.body.querySelector('[aria-label="관리자 비밀번호"]')).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("drops logged-out administrator credentials after a player signs in", async () => {
    const signedOutData = { ...adminData, user: null, csrf: null };
    const player = { ...adminData.user!, id: "player-account", username: "player", displayName: "플레이어", isAdmin: false };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/bootstrap") return Promise.resolve(jsonResponse(signedOutData));
      if (path === "/api/auth/admin-unlock") return Promise.resolve(jsonResponse({
        user: adminData.user,
        csrf: "standalone-csrf",
        adminExpiresAt: Date.now() + 10 * 60_000,
        standalone: true,
      }));
      if (path === "/api/admin/overview") return Promise.resolve(jsonResponse(adminOverview(false)));
      if (path === "/api/auth/login") return Promise.resolve(jsonResponse({ user: player, csrf: "player-csrf", created: false }));
      if (path.startsWith("/api/auth/username-availability")) return Promise.resolve(jsonResponse({ available: false, exists: true, resetRequired: false }));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      (container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      const input = document.body.querySelector('[aria-label="관리자 비밀번호"]') as HTMLInputElement;
      input.value = "admin-password";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (document.body.querySelector('[aria-label="관리자 비밀번호"]') as HTMLInputElement).form?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      for (const [selector, value] of [["#username", "player"], ["#password", "password123"]] as const) {
        const input = container.querySelector(selector) as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      (container.querySelector("main form") as HTMLFormElement).requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      (container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement).click();
    });

    expect(document.body.querySelector('[aria-label="관리자 비밀번호"]')).toBeTruthy();
    await act(async () => root.unmount());
  });
});

async function renderCard(status: ServerStatus) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ServerCard status={status} setupReady compact showPlayerDropdown />);
  });
  return { container, root };
}

describe("online player dropdown", () => {
  it("expands below the status card and shows display names", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      players: [
        { gameUsername: "qaadmin", displayName: "관리자봇" },
        { gameUsername: "friend", displayName: "친구" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { container, root } = await renderCard(onlineStatus);
    const toggle = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-controls") === "online-player-list");
    const card = toggle?.parentElement;
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute("aria-label")).toBe("온라인 1명, 접속자 목록 펼치기");
    expect(toggle?.className).toContain("absolute inset-0");
    expect(card?.querySelector(".t-acc-head")).toBeNull();
    expect(card?.querySelector(".pr-3\\.5")).toBeTruthy();
    expect([...card!.querySelectorAll("strong")].some((label) => label.textContent === "온라인")).toBe(true);
    expect(card?.className).toContain("duration-[var(--duration-quick)]");
    expect(card?.className).toContain("hover:bg-[#96ce4d]/25");
    expect(card?.className).toContain("has-[:active]:scale-[var(--scale-large)]");
    expect(card?.className).toContain("has-[:active]:bg-[#96ce4d]/35");
    expect(card?.className).not.toContain("focus-within:bg-[#96ce4d]/25");

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector("#online-player-list")?.textContent).toContain("관리자봇, 친구");
    expect(container.querySelector("#online-player-list ul")?.className).toContain("block");
    expect(container.querySelector("#online-player-list li")?.className).toContain("font-mark");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("온라인 1명, 접속자 목록 접기");
    expect(toggle?.parentElement).toBe(container.querySelector("#online-player-list")?.parentElement);
    expect(container.querySelector("[data-open='true'] .t-acc-panel")).toBeTruthy();

    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-open='false'] .t-acc-panel")).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("does not render a dropdown for an empty server", async () => {
    const { container, root } = await renderCard({ ...onlineStatus, players: [], idleShutdownAt: Date.now() + 60_000 });
    expect(container.querySelector('button[aria-controls="online-player-list"]')).toBeNull();
    expect(container.querySelector("#online-player-list")).toBeNull();
    await act(async () => root.unmount());
  });
});

describe("server password input", () => {
  it("shows a gray Caps Lock icon inside the password field", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="login" onAuth={vi.fn()} onModeChange={vi.fn()} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    const input = container.querySelector("#password") as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, modifierCapsLock: true }));
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Caps Lock 켜짐");
    expect(status?.className).toContain("text-muted-foreground");
    expect(status?.querySelector("svg")).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Caps Lock 켜짐");
    await act(async () => root.unmount());
  });

  it("shows the Korean signup question only on the signup screen", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen
        data={{ ...adminData, user: null }}
        mode="register"
        onAuth={vi.fn()}
        onModeChange={vi.fn()}
        onOpenAdmin={vi.fn()}
        notice={vi.fn()}
      />);
    });

    const input = container.querySelector("#server-password") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.autocomplete).toBe("off");
    expect(input.inputMode).toBe("");
    expect(input.placeholder).toBe("도덕 시간에 쓰는 건?");
    expect((container.querySelector("#username") as HTMLInputElement).placeholder).toBe("플레이어 이름 (한글 지원)");
    await act(async () => root.unmount());
  });

  it("keeps login to two fields and links to signup below the full-width button", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({ available: true, exists: false, resetRequired: false }));
    vi.stubGlobal("fetch", fetchMock);
    const onModeChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="login" onAuth={vi.fn()} onModeChange={onModeChange} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    const initialButtons = [...container.querySelectorAll("form button")];
    expect(initialButtons[0]?.textContent).toContain("로그인");
    expect(initialButtons[0]?.querySelector(".auth-label-in")).toBeNull();
    expect(initialButtons[0]?.className).toContain("w-full");
    expect(initialButtons[1]?.textContent).toContain("가입");
    expect(container.querySelector(".auth-mode-slot")).not.toBeNull();
    expect(container.querySelector(".auth-mode-container")?.className).toContain("t-resize");
    expect(container.querySelector('.auth-mode-panel [data-slot="card"]')?.className).toContain("bg-transparent");
    expect(container.querySelector(".auth-mode-panel")?.getAttribute("data-direction")).toBe("from-left");
    expect(container.textContent).toContain("계정이 없나요?");
    expect(document.activeElement).toBe(container.querySelector("#username"));
    expect(container.querySelector(".auth-hint-copy-in")).toBeNull();
    expect(container.querySelector("#server-password")).toBeNull();
    expect((container.querySelector("#password") as HTMLInputElement).placeholder).toBe("비밀번호");
    expect(container.querySelector("#password")?.getAttribute("minlength")).toBeNull();
    await act(async () => initialButtons[1]?.click());
    expect(onModeChange).toHaveBeenCalledWith("register");

    const input = container.querySelector("#username") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "텔레그램");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(input.validity.patternMismatch).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/username-availability?username=%ED%85%94%EB%A0%88%EA%B7%B8%EB%9E%A8",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const buttons = [...container.querySelectorAll("form button")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain("로그인");
    expect(buttons[0]?.className).toContain("w-full");
    expect(container.textContent).toContain("없는 이름이에요. 대신");
    expect(buttons[1]?.textContent).toContain("가입할까요?");
    expect(container.querySelector(".auth-hint-copy-in")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("suggests login when the signup name already exists", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({ available: false, exists: true, resetRequired: false }));
    vi.stubGlobal("fetch", fetchMock);
    const onModeChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="register" onAuth={vi.fn()} onModeChange={onModeChange} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    const input = container.querySelector("#username") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "텔레그램");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/username-availability?username=%ED%85%94%EB%A0%88%EA%B7%B8%EB%9E%A8",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain("이미 있는 이름이에요. 대신");
    expect((container.querySelector("#server-password") as HTMLInputElement).type).toBe("text");
    expect([...container.querySelectorAll("form button")][0]?.textContent).toContain("가입");
    const loginSuggestion = [...container.querySelectorAll("form button")].find((button) => button.textContent?.includes("로그인할까요?"));
    await act(async () => loginSuggestion?.click());
    expect(onModeChange).toHaveBeenCalledWith("login");
    await act(async () => root.unmount());
  });

  it("shakes the account hint without marking the password red for a missing login account", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ available: true, exists: false, resetRequired: false })));
    const onAuth = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="login" onAuth={onAuth} onModeChange={vi.fn()} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const [selector, value] of [["#username", "없는계정"], ["#password", "wrong-password"]] as const) {
        const input = container.querySelector(selector) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => (container.querySelector("form") as HTMLFormElement).requestSubmit());

    const hint = container.querySelector(".auth-hint") as HTMLDivElement;
    const passwordInput = container.querySelector("#password") as HTMLInputElement;
    expect(onAuth).not.toHaveBeenCalled();
    expect(hint.className).toContain("auth-hint-shake");
    expect(hint.className).not.toContain("text-red");
    expect(passwordInput.className).not.toContain("password-field-error");
    expect(passwordInput.getAttribute("aria-invalid")).toBe("false");
    await act(async () => root.unmount());
  });

  it("shakes the account hint for an existing signup account", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ available: false, exists: true, resetRequired: false })));
    const onAuth = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="register" onAuth={onAuth} onModeChange={vi.fn()} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const [selector, value] of [["#username", "기존계정"], ["#password", "password123"], ["#server-password", "server-password"]] as const) {
        const input = container.querySelector(selector) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => (container.querySelector("form") as HTMLFormElement).requestSubmit());

    expect(onAuth).not.toHaveBeenCalled();
    expect(container.querySelector(".auth-hint")?.className).toContain("auth-hint-shake");
    expect(container.querySelector("#password")?.className).not.toContain("password-field-error");
    await act(async () => root.unmount());
  });

  it("keeps the password error for a wrong password on an existing account", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ available: false, exists: true, resetRequired: false })));
    const onAuth = vi.fn(async () => {
      throw new ApiError("플레이어 이름 또는 비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="login" onAuth={onAuth} onModeChange={vi.fn()} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const [selector, value] of [["#username", "기존계정"], ["#password", "wrong-password"]] as const) {
        const input = container.querySelector(selector) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
      await Promise.resolve();
    });

    expect(onAuth).toHaveBeenCalledWith("login", "기존계정", "wrong-password", "");
    expect(container.querySelector("#password")?.className).toContain("password-field-error");
    expect(container.querySelector(".auth-hint")?.className).not.toContain("auth-hint-shake");
    await act(async () => root.unmount());
  });

  it("ignores an authentication error after the username changes", async () => {
    vi.useFakeTimers();
    const authRequest = deferred<void>();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="login" onAuth={() => authRequest.promise} onModeChange={vi.fn()} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      for (const [selector, value] of [["#username", "이전계정"], ["#password", "wrong-password"]] as const) {
        const input = container.querySelector(selector) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
    });
    await act(async () => {
      const usernameInput = container.querySelector("#username") as HTMLInputElement;
      setter.call(usernameInput, "새계정");
      usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
      authRequest.reject(new ApiError("플레이어 이름 또는 비밀번호가 올바르지 않아요.", "INVALID_LOGIN"));
      await Promise.resolve();
    });

    expect(container.querySelector("#password")?.className).not.toContain("password-field-error");
    expect(container.querySelector(".auth-hint")?.className).not.toContain("auth-hint-shake");
    await act(async () => root.unmount());
  });

  it("overlaps the old form exit with the spring entry from the opposite side", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const props = {
      data: { ...adminData, user: null },
      onAuth: vi.fn(async () => undefined),
      onModeChange: vi.fn(),
      onOpenAdmin: vi.fn(),
      notice: vi.fn(),
    };
    await act(async () => root.render(<AuthScreen {...props} mode="login" />));

    await act(async () => root.render(<AuthScreen {...props} mode="register" />));
    let outgoing = container.querySelector('[data-layer="outgoing"]') as HTMLDivElement;
    let incoming = container.querySelector('[data-layer="incoming"]') as HTMLDivElement;
    expect(outgoing.dataset.state).toBe("exiting");
    expect(incoming.dataset.state).toBe("entering");
    expect(outgoing.dataset.direction).toBe("from-right");
    expect(incoming.dataset.direction).toBe("from-right");
    expect(outgoing.textContent).toContain("로그인");
    expect(incoming.textContent).toContain("가입");

    await act(async () => incoming.dispatchEvent(new Event("animationend", { bubbles: true })));
    let panel = container.querySelector(".auth-mode-panel") as HTMLDivElement;
    expect(container.querySelectorAll(".auth-mode-panel")).toHaveLength(1);
    expect(panel.dataset.state).toBe("idle");
    expect(panel.textContent).toContain("가입");

    await act(async () => root.render(<AuthScreen {...props} mode="login" />));
    outgoing = container.querySelector('[data-layer="outgoing"]') as HTMLDivElement;
    incoming = container.querySelector('[data-layer="incoming"]') as HTMLDivElement;
    expect(outgoing.dataset.direction).toBe("from-left");
    expect(incoming.dataset.direction).toBe("from-left");
    expect(outgoing.textContent).toContain("가입");
    expect(incoming.textContent).toContain("로그인");
    await act(async () => incoming.dispatchEvent(new Event("animationend", { bubbles: true })));
    panel = container.querySelector(".auth-mode-panel") as HTMLDivElement;
    expect(panel.dataset.state).toBe("idle");
    expect(panel.textContent).toContain("로그인");

    await act(async () => root.unmount());
  });

  it("submits signup only from the separate signup screen", async () => {
    const onAuth = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} mode="register" onAuth={onAuth} onModeChange={vi.fn()} onOpenAdmin={vi.fn()} notice={vi.fn()} />);
    });
    expect(container.querySelector(".auth-mode-panel")?.getAttribute("data-direction")).toBe("from-right");
    expect(container.textContent).toContain("계정이 있나요?");
    expect(container.querySelector("#password")?.getAttribute("minlength")).toBe("8");
    expect((container.querySelector("#password") as HTMLInputElement).placeholder).toBe("비밀번호 (8자 이상)");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      for (const [selector, value] of [["#username", "텔레그램"], ["#password", "password123"], ["#server-password", "server-password"]] as const) {
        const input = container.querySelector(selector) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
      await Promise.resolve();
    });
    expect(onAuth).toHaveBeenCalledWith("register", "텔레그램", "password123", "server-password");
    await act(async () => root.unmount());
  });
});

describe("skin change flow", () => {
  it("shows the skin dialog immediately only when requested after signup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ categories: [{
      id: "famous",
      label: "유명",
      skins: [{ id: "spawnpoint", label: "spawnpoint", textureUrl: "/api/skin/catalog/spawnpoint.png?v=texture-v1" }],
    }] })));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Dashboard
        data={{ ...adminData, server: { ...onlineStatus, phase: "off", players: [], startedAt: null, readyAt: null } }}
        onData={vi.fn()}
        onSession={vi.fn()}
        onStart={vi.fn()}
        onLogout={vi.fn()}
        notice={vi.fn()}
        onPlay={vi.fn()}
        onOpenAdmin={vi.fn()}
        initialSkinDialogOpen
        onInitialSkinDialogHandled={vi.fn()}
      />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("스킨 변경");
    expect(document.body.textContent).not.toContain("스킨 카탈로그");
    expect(document.body.textContent).not.toContain("유명 스킨을 고르거나");
    const skinButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "스킨 변경");
    const serverButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "서버 시작");
    expect(skinButton?.className).toContain("h-8");
    expect(serverButton?.className).toContain("h-7");
    expect(skinButton?.className).not.toContain("max-sm:min-h-");
    expect(serverButton?.className).not.toContain("max-sm:min-h-");
    await act(async () => root.unmount());
  });

  it("uses action labels and actual 3D skin renders without visible catalog names", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SkinStudio data={adminData} onUser={vi.fn()} onChanged={vi.fn()} notice={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("고르기");
    expect(container.textContent).toContain("이름으로 가져오기");
    expect(container.textContent).toContain("업로드");
    expect(container.textContent).not.toContain("spawnpoint");
    expect(container.querySelector("form")?.className).toContain("overflow-y-auto");
    expect([...container.querySelectorAll('[data-slot="toggle-group-item"]')].every((item) => item.className.includes("min-w-0") && item.className.includes("whitespace-normal") && !item.className.includes("active:scale-"))).toBe(true);
    const preview = container.querySelector('[data-testid="catalog-skin-3d"]');
    expect(preview?.getAttribute("data-src")).toBe("/api/skin/catalog/spawnpoint.png?v=texture-v1");
    expect(preview?.closest("button")?.className).toContain("active:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_10%)]");
    const animatedHeight = preview?.closest(".p-1")?.parentElement;
    expect(animatedHeight?.className).toContain("transition-[height]");

    await act(async () => {
      [...container.querySelectorAll('[data-slot="toggle-group-item"]')]
        .find((item) => item.textContent === "업로드")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("#skin-file")?.closest(".p-1")?.parentElement).toBe(animatedHeight);
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "선택")?.closest(".p-1")?.parentElement).toBe(animatedHeight);
    await act(async () => root.unmount());
  });

  it("shows an administrator button beside the account controls", async () => {
    const onOpenAdmin = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Dashboard
        data={adminData}
        onData={vi.fn()}
        onSession={vi.fn()}
        onStart={vi.fn()}
        onLogout={vi.fn()}
        notice={vi.fn()}
        onPlay={vi.fn()}
        onOpenAdmin={onOpenAdmin}
        initialSkinDialogOpen={false}
        onInitialSkinDialogHandled={vi.fn()}
      />);
    });

    const adminButton = container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement;
    const accountButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(adminData.user!.displayName));
    expect(adminButton).toBeTruthy();
    expect(accountButton).toBeTruthy();
    expect(adminButton.parentElement).toBe(accountButton?.parentElement);
    expect(container.textContent).not.toContain("분");
    expect(container.querySelector('[aria-label="관리자 잠금"]')).toBeNull();
    await act(async () => {
      adminButton.click();
    });
    expect(onOpenAdmin).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

});

describe("account settings copy and spacing", () => {
  it("edits one name used for login and in-game display", async () => {
    const onSession = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse({
      user: { ...adminData.user!, username: "새이름", displayName: "새이름" },
      csrf: "updated-csrf",
      adminExpiresAt: null,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AccountDialog data={{ ...adminData, user: { ...adminData.user!, username: "member", displayName: "멤버" } }} onSession={onSession} notice={vi.fn()} />);
    });
    const trigger = container.querySelector("button") as HTMLButtonElement;
    expect(trigger.className).toContain("min-w-11");
    expect(trigger.className).toContain("shrink");
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const name = document.body.querySelector("#account-name") as HTMLInputElement;
    expect(name.value).toBe("member");
    expect(document.body.querySelector("#account-display-name")).toBeNull();
    const changeButton = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "이름 변경") as HTMLButtonElement;
    expect(changeButton.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(name, "새이름");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      name.form?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/account/profile", expect.objectContaining({
      body: JSON.stringify({ username: "새이름" }),
    }));
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ username: "새이름", displayName: "새이름" }), "updated-csrf", null);
    expect(document.body.textContent).toContain("이름 변경");
    expect(document.body.querySelector("#current-password")?.closest('[data-slot="field-group"]')?.className).toContain("gap-2");
    expect(document.body.querySelector("#new-password")?.getAttribute("minlength")).toBe("8");
    await act(async () => root.unmount());
  });
});

describe("mobile portal controls", () => {
  it("keeps the dashboard action row shrinkable on narrow screens", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Dashboard
        data={{ ...adminData, user: { ...adminData.user!, displayName: "가나다라마바사아자차카타파하가나" } }}
        onData={vi.fn()}
        onSession={vi.fn()}
        onStart={vi.fn()}
        onLogout={vi.fn()}
        notice={vi.fn()}
        onPlay={vi.fn()}
        onOpenAdmin={vi.fn()}
        initialSkinDialogOpen={false}
        onInitialSkinDialogHandled={vi.fn()}
      />);
    });

    expect(container.querySelector(".dashboard-actions")?.className).toContain("dashboard-actions");
    const accountTrigger = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("가나다라"));
    expect(accountTrigger?.className).toContain("min-w-11");
    expect(accountTrigger?.className).not.toContain("max-sm:min-h-");
    expect(accountTrigger?.className).not.toContain("[@media(pointer:coarse)]:min-h-");
    expect(accountTrigger?.className).toContain("active:scale-[var(--scale-large)]");
    expect(accountTrigger?.className).toContain("active:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_10%)]");
    expect(accountTrigger?.querySelector("span")?.className).toContain("truncate");
    const logout = container.querySelector('[aria-label="로그아웃"]');
    expect(logout?.className).toContain("size-7");
    expect(logout?.className).not.toContain("max-sm:min-");
    expect(logout?.className).not.toContain("[@media(pointer:coarse)]:min-");
    expect(logout?.className).toContain("active:scale-[var(--scale-large)]");
    expect(logout?.className).toContain("active:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_10%)]");
    await act(async () => root.unmount());
  });

  it("does not show a close control over the game", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GameScreen game={{ client: "stable", username: "mobileqa", launchId: "launch-123" }} gameUrl="/game/stable.html" onExit={vi.fn()} />);
    });

    expect(container.querySelector('[aria-label="게임 종료"]')).toBeNull();
    expect(container.querySelector("iframe")?.getAttribute("allow")).toContain("microphone");
    await act(async () => root.unmount());
  });

  it("returns to the portal only for the active game launch", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onExit = vi.fn();
    await act(async () => {
      root.render(<GameScreen game={{ client: "stable", username: "mobileqa", launchId: "launch-123" }} gameUrl="/game/stable.html" onExit={onExit} />);
    });
    const gameFrame = container.querySelector("iframe")!;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: gameFrame.contentWindow,
        data: { type: "spawnpoint:return-to-menu", launchId: "another-launch" },
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: window,
        data: { type: "spawnpoint:return-to-menu", launchId: "launch-123" },
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: gameFrame.contentWindow,
        data: { type: "spawnpoint:return-to-menu", launchId: "launch-123" },
      }));
    });

    expect(onExit).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

});

describe("administrator TPA setting", () => {
  it("ignores an older poll response after a newer mutation refresh", async () => {
    vi.useFakeTimers();
    const stalePoll = deferred<Response>();
    let overviewRequests = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/admin/overview") {
        overviewRequests += 1;
        if (overviewRequests === 1) return Promise.resolve(jsonResponse(adminOverview(false)));
        if (overviewRequests === 2) return stalePoll.promise;
        if (overviewRequests === 3) return Promise.resolve(jsonResponse(adminOverview(true)));
      }
      if (String(input) === "/api/admin/settings/tpa" && options?.method === "PUT") {
        return Promise.resolve(jsonResponse({ tpaEnabled: false }));
      }
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AdminPanel data={adminData} onSession={vi.fn()} notice={vi.fn()} />);
    });

    const trigger = container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const control = document.body.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.className).toContain("touch-manipulation");
    expect(control.className).toContain("after:-inset-y-[13px]");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(overviewRequests).toBe(2);

    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(overviewRequests).toBe(3);
    expect(control.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      stalePoll.resolve(jsonResponse(adminOverview(false)));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(control.getAttribute("aria-checked")).toBe("true");

    await act(async () => root.unmount());
  });

  it("ignores an older overview failure while a newer request is pending", async () => {
    const staleRequest = deferred<Response>();
    const currentRequest = deferred<Response>();
    let overviewRequests = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input) !== "/api/admin/overview") {
        return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
      }
      overviewRequests += 1;
      return overviewRequests === 1 ? staleRequest.promise : currentRequest.promise;
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const notice = vi.fn();
    await act(async () => {
      root.render(<AdminPanel data={adminData} onSession={vi.fn()} notice={notice} />);
    });
    const trigger = container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(overviewRequests).toBe(1);

    await act(async () => {
      root.render(<AdminPanel data={{ ...adminData, csrf: "new-csrf" }} onSession={vi.fn()} notice={notice} />);
      await Promise.resolve();
    });
    expect(overviewRequests).toBe(2);

    await act(async () => {
      staleRequest.reject(new Error("오래된 요청 오류"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("오래된 요청 오류");
    expect(document.body.textContent).toContain("관리자 정보 불러오는 중");

    await act(async () => {
      currentRequest.resolve(jsonResponse(adminOverview(false)));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    await act(async () => root.unmount());
  });

  it("tracks concurrent mutation busy states independently", async () => {
    const tpaUpdate = deferred<Response>();
    const operatorUpdate = deferred<Response>();
    let tpaEnabled = true;
    const overview = adminOverview(tpaEnabled, [{ ...testPlayer, accountId: "admin-account" }]);
    overview.users = [{
      id: "admin-account",
      username: "qaadmin",
      gameUsername: "qaadmin",
      displayName: "관리자",
      createdAt: Date.now(),
      passwordResetExpiresAt: null,
      resetRequired: false,
      isAdmin: true,
    }];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === "/api/admin/overview") {
        return Promise.resolve(jsonResponse({ ...overview, tpaEnabled }));
      }
      if (path === "/api/admin/settings/tpa" && options?.method === "PUT") return tpaUpdate.promise;
      if (path.includes("/api/admin/players/") && path.endsWith("/operator") && options?.method === "PUT") {
        return operatorUpdate.promise;
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AdminPanel data={adminData} onSession={vi.fn()} notice={vi.fn()} />);
    });
    const trigger = container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const tpaControl = document.body.querySelector('[role="switch"]') as HTMLButtonElement;
    const operatorControl = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("OP 부여")) as HTMLButtonElement;
    const onlineIndicator = document.body.querySelector('[aria-label="온라인"]') as HTMLSpanElement;
    const playerName = onlineIndicator.nextElementSibling as HTMLSpanElement;

    expect(onlineIndicator.className).toContain("bg-[#96ce4d]");
    expect(playerName.className).toContain("font-mark");
    expect(playerName.className).toContain("text-[#65952c]");

    await act(async () => {
      tpaControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      operatorControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(tpaControl.disabled).toBe(true);
    expect(operatorControl.disabled).toBe(true);

    await act(async () => {
      operatorUpdate.resolve(jsonResponse({ operator: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tpaControl.disabled).toBe(true);
    expect(operatorControl.disabled).toBe(false);

    tpaEnabled = false;
    await act(async () => {
      tpaUpdate.resolve(jsonResponse({ tpaEnabled: false }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tpaControl.disabled).toBe(false);
    expect(tpaControl.getAttribute("aria-checked")).toBe("false");
    await act(async () => root.unmount());
  });

  it("requests a server mutation without changing the controlled value optimistically", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    await act(async () => {
      root.render(<TpaSettingRow enabled serverOnline busy={false} onChange={onChange} />);
    });
    const control = container.querySelector('[role="switch"]') as HTMLButtonElement;

    await act(async () => control.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onChange).toHaveBeenCalledWith(false);
    expect(control.getAttribute("aria-checked")).toBe("true");
    await act(async () => root.unmount());
  });

  it("disables the setting when bridge state is unavailable", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TpaSettingRow enabled={null} serverOnline busy={false} onChange={vi.fn()} />);
    });

    expect((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("게임 서버 설정을 불러올 수 없어요.");
    await act(async () => root.unmount());
  });

  it("explains that an offline server cannot be changed", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TpaSettingRow enabled serverOnline={false} busy={false} onChange={vi.fn()} />);
    });

    expect((container.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("서버가 오프라인일 때는 변경할 수 없어요.");
    await act(async () => root.unmount());
  });
});

describe("administrator console and account actions", () => {
  it("shows console output and sends a command from the console tab", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/admin/overview") {
        return Promise.resolve(jsonResponse(adminOverview(true)));
      }
      if (String(input) === "/api/admin/logs?offset=0") {
        return Promise.resolve(jsonResponse({
          entries: [{ source: "2026-08-29-1.log.gz", line: "Done (1.234s)!" }],
          nextOffset: null,
        }));
      }
      if (String(input) === "/api/admin/logs?offset=0&q=joined") {
        return Promise.resolve(jsonResponse({
          entries: [{ source: "2026-07-11-3.log.gz", line: "friend joined the game" }],
          nextOffset: null,
        }));
      }
      if (String(input) === "/api/admin/console" && options?.method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AdminPanel data={adminData} onSession={vi.fn()} notice={vi.fn()} />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const consoleTab = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "콘솔") as HTMLButtonElement;
    await act(async () => {
      consoleTab.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.querySelector('[aria-label="서버 콘솔 출력"]')?.textContent).toContain("Done (1.234s)!");
    expect(document.body.querySelector('[aria-label="서버 콘솔 출력"]')?.textContent).toContain("2026-08-29-1");
    expect(document.body.textContent).not.toContain("서버 로그를 실시간으로");
    const searchInput = document.body.querySelector('[aria-label="콘솔 로그 검색"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(searchInput, "joined");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.querySelector('[aria-label="서버 콘솔 출력"]')?.textContent).toContain("friend joined the game");
    expect(document.body.querySelector('[aria-label="서버 콘솔 출력"]')?.textContent).toContain("2026-07-11-3");
    const input = document.body.querySelector('[aria-label="콘솔 명령"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "say 안녕하세요");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (document.body.querySelector('[aria-label="명령 실행"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/console", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ command: "say 안녕하세요" }),
    }));
    await act(async () => root.unmount());
  });

  it("sends a colored title to one or more selected online players", async () => {
    const overview = adminOverview(true, [
      { ...testPlayer, accountId: "00000000-0000-4000-8000-000000000101", displayName: "관리자", username: "qaadmin" },
      { ...testPlayer, accountId: "00000000-0000-4000-8000-000000000102", uuid: "00000000-0000-4000-8000-000000000002", displayName: "친구", username: "friend" },
    ]);
    let submitted: unknown = null;
    const notice = vi.fn();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/admin/overview") return Promise.resolve(jsonResponse(overview));
      if (String(input) === "/api/admin/title" && options?.method === "POST") {
        submitted = JSON.parse(String(options.body));
        return Promise.resolve(jsonResponse({ sent: 1 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AdminPanel data={adminData} onSession={vi.fn()} notice={notice} />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const titleTab = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "타이틀") as HTMLButtonElement;
    await act(async () => titleTab.click());

    const titleInput = document.body.querySelector("#admin-title-text") as HTMLInputElement;
    const subtitleInput = document.body.querySelector("#admin-subtitle-text") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(titleInput, "서버 공지");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(subtitleInput, "곧 저장합니다");
      subtitleInput.dispatchEvent(new Event("input", { bubbles: true }));
      (document.body.querySelector('[aria-label="타이틀 색깔 빨강"]') as HTMLButtonElement).click();
      ([...document.body.querySelectorAll("button")].find((button) => button.textContent === "직접 선택") as HTMLButtonElement).click();
    });
    const playerChoices = [...document.body.querySelectorAll('[role="checkbox"]')] as HTMLButtonElement[];
    expect(playerChoices).toHaveLength(2);
    await act(async () => playerChoices[0].click());
    const submit = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "타이틀 띄우기") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submitted).toEqual({
      title: "서버 공지",
      subtitle: "곧 저장합니다",
      color: "red",
      audience: "selected",
      targets: ["00000000-0000-4000-8000-000000000101"],
    });
    expect(notice).toHaveBeenCalledWith("1명에게 타이틀을 띄웠어요.");
    await act(async () => root.unmount());
  });

  it("uses a check icon and the name change label for administrator edits", async () => {
    const overview = adminOverview(true);
    overview.users = [{
      id: "member-1",
      username: "member",
      gameUsername: "member",
      displayName: "멤버",
      createdAt: Date.now(),
      passwordResetExpiresAt: null,
      resetRequired: false,
      isAdmin: false,
    }];
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(overview)));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AdminPanel data={adminData} onSession={vi.fn()} notice={vi.fn()} />);
    });
    await act(async () => {
      (container.querySelector('[aria-label="관리자 패널"]') as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const changeButton = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "이름 변경");

    expect(changeButton).toBeTruthy();
    expect(changeButton?.querySelector("svg")).toBeTruthy();
    expect((document.body.querySelector("#admin-name-member-1") as HTMLInputElement).value).toBe("member");
    expect(document.body.querySelector("#admin-display-name-member-1")).toBeNull();
    expect((changeButton as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("플레이어 1");
    expect(document.body.textContent).not.toContain("계정 1");
    expect(document.body.textContent).not.toContain("변경 저장");
    await act(async () => root.unmount());
  });
});
