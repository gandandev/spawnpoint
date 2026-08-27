// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { ServerCard } from "../src/components/portal";
import { AccountDialog } from "../src/features/AccountDialog";
import { AdminPanel, TpaSettingRow } from "../src/features/AdminPanel";
import { SkinStudio } from "../src/features/SkinStudio";
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
      root.render(<AuthScreen data={{ ...adminData, user: null }} onAuth={vi.fn()} notice={vi.fn()} />);
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

  it("keeps the normal server password as a text field for Korean input", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen
        data={{ ...adminData, user: null }}
        onAuth={vi.fn()}
        notice={vi.fn()}
      />);
    });

    const input = container.querySelector("#server-password") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.autocomplete).toBe("off");
    expect(input.inputMode).toBe("");
    await act(async () => root.unmount());
  });

  it("accepts a Korean player name and checks whether it can be registered", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({ available: true, resetRequired: false }));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AuthScreen data={{ ...adminData, user: null }} onAuth={vi.fn()} notice={vi.fn()} />);
    });

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
    expect(container.querySelector("button")?.textContent).toContain("가입");
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
    expect(skinButton?.className).toContain("max-sm:min-h-8");
    expect(serverButton?.className).toContain("max-sm:min-h-7");
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
    expect([...container.querySelectorAll('[data-slot="toggle-group-item"]')].every((item) => item.className.includes("min-w-0") && item.className.includes("whitespace-normal") && item.className.includes("active:scale-[var(--scale-large)]"))).toBe(true);
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
  it("uses one concise name action and tighter password fields", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AccountDialog data={adminData} onSession={vi.fn()} notice={vi.fn()} />);
    });
    const trigger = container.querySelector("button") as HTMLButtonElement;
    expect(trigger.className).toContain("min-w-11");
    expect(trigger.className).toContain("shrink");
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.body.textContent).not.toContain("플레이어 이름과 비밀번호를 관리하세요.");
    expect(document.body.textContent).not.toContain("이 이름으로 로그인하며");
    expect(document.body.textContent).toContain("이름 변경");
    expect(document.body.querySelector("#current-password")?.closest('[data-slot="field-group"]')?.className).toContain("gap-2");
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
    expect(accountTrigger?.className).toContain("[@media(max-height:480px)]:min-h-11");
    expect(accountTrigger?.className).toContain("active:scale-[var(--scale-large)]");
    expect(accountTrigger?.className).toContain("active:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_10%)]");
    expect(accountTrigger?.querySelector("span")?.className).toContain("truncate");
    const logout = container.querySelector('[aria-label="로그아웃"]');
    expect(logout?.className).toContain("max-sm:min-w-11");
    expect(logout?.className).toContain("[@media(pointer:coarse)]:min-w-11");
    expect(logout?.className).toContain("active:scale-[var(--scale-large)]");
    expect(logout?.className).toContain("active:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_10%)]");
    await act(async () => root.unmount());
  });

  it("does not show a close control over the game", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GameScreen game={{ client: "stable", username: "mobileqa", launchId: "launch-123" }} gameUrl="/game/stable.html" />);
    });

    expect(container.querySelector('[aria-label="게임 종료"]')).toBeNull();
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
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path === "/api/admin/overview") {
        return Promise.resolve(jsonResponse(adminOverview(tpaEnabled, [testPlayer])));
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
    const fetchMock = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/admin/overview") {
        return Promise.resolve(jsonResponse({ ...adminOverview(true), logs: ["Done (1.234s)!"] }));
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
    await act(async () => consoleTab.click());

    expect(document.body.querySelector('[aria-label="서버 콘솔 출력"]')?.textContent).toContain("Done (1.234s)!");
    expect(document.body.textContent).not.toContain("서버 로그를 실시간으로");
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
    const usersTab = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "계정 1") as HTMLButtonElement;
    await act(async () => usersTab.click());
    const changeButton = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "이름 변경");

    expect(changeButton).toBeTruthy();
    expect(changeButton?.querySelector("svg")).toBeTruthy();
    expect(document.body.textContent).not.toContain("변경 저장");
    await act(async () => root.unmount());
  });
});
