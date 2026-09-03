// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPlayersPanel } from "../src/features/AdminPlayersPanel";
import type { AdminOverview, PlayerDetails } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const player: PlayerDetails = {
  accountId: "account-1",
  uuid: "00000000-0000-4000-8000-000000000001",
  username: "qaadmin",
  displayName: "관리자",
  online: true,
  dataAvailable: true,
  firstSeenAt: Date.now() - 86_400_000,
  lastSeenAt: Date.now(),
  playTimeTicks: 72_000,
  banned: false,
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
  inventory: [
    { section: "storage", slot: 29, type: "flint", amount: 3, durability: 0, displayName: "Flint" },
    { section: "armor", slot: 3, type: "iron_helmet", amount: 1, durability: 12, displayName: "Iron Helmet" },
    { section: "extra", slot: 0, type: "torch", amount: 26, durability: 0, displayName: "Torch" },
  ],
  enderChest: [{ section: "ender", slot: 4, type: "diamond_sword", amount: 1, durability: 8, displayName: "Diamond Sword" }],
};

const overview: AdminOverview = {
  users: [{
    id: "account-1",
    username: "qaadmin",
    gameUsername: "qaadmin",
    displayName: "관리자",
    createdAt: Date.now() - 86_400_000,
    lastLoginAt: Date.now(),
    archivedAt: null,
    passwordUpdatedAt: Date.now(),
    passwordResetExpiresAt: null,
    resetRequired: false,
    isAdmin: true,
  }],
  players: [player],
  bridgeAvailable: true,
  tpaEnabled: true,
  settings: {
    motd: "Spawnpoint",
    maxPlayers: 12,
    difficulty: "normal",
    defaultGameMode: "survival",
    forceGameMode: false,
    viewDistance: 8,
    playerIdleTimeout: 0,
    pvp: true,
    allowFlight: false,
    hardcore: false,
    allowNether: true,
    generateStructures: true,
    spawnAnimals: true,
    spawnMonsters: true,
    spawnNpcs: true,
    whiteList: false,
    commandBlocks: false,
    keepInventory: true,
    tpaEnabled: true,
  },
  logs: [],
  server: {
    phase: "online",
    players: ["qaadmin"],
    startedAt: Date.now(),
    readyAt: Date.now(),
    idleShutdownAt: null,
    lastError: null,
    startAllowedAt: 0,
    maxPlayers: 12,
    version: "1.12.2",
  },
};

afterEach(() => {
  document.body.innerHTML = "";
});

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Minecraft inventory editor", () => {
  it("renders native inventory windows and edits the selected slot", async () => {
    const mutate = vi.fn().mockResolvedValue({});
    const notice = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AdminPlayersPanel overview={overview} currentUserId="account-1" isBusy={() => false} mutate={mutate} notice={notice} />);
    });

    expect(container.querySelector('img[alt="플레이어 인벤토리 Minecraft UI"]')).toBeTruthy();
    expect(container.querySelector('img[alt="엔더 상자 Minecraft UI"]')).toBeTruthy();
    expect(container.querySelectorAll(".minecraft-inventory-slot")).toHaveLength(104);

    const swordSlot = container.querySelector<HTMLButtonElement>('button[aria-label="엔더 상자 4번 칸, Diamond Sword 1개"]')!;
    await act(async () => swordSlot.click());
    expect(container.querySelector<HTMLInputElement>('input[placeholder="diamond_sword"]')?.value).toBe("diamond_sword");
    expect(container.querySelector<HTMLInputElement>('input[type="number"][max="32767"]')?.value).toBe("8");
    const removeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Diamond Sword 제거"]')!;
    await act(async () => {
      removeButton.click();
      await Promise.resolve();
    });
    expect(mutate).toHaveBeenLastCalledWith("inventory:account-1:ender", "/admin/players/account-1/inventory", {
      method: "PUT",
      body: JSON.stringify({ section: "ender", slot: 4, item: null }),
      headers: { "Content-Type": "application/json" },
    });
    mutate.mockClear();
    notice.mockClear();

    const emptyEnderSlot = container.querySelector<HTMLButtonElement>('button[aria-label="엔더 상자 5번 칸, 비어 있음"]')!;
    await act(async () => emptyEnderSlot.click());
    const itemInput = container.querySelector<HTMLInputElement>('input[placeholder="diamond_sword"]')!;
    await act(async () => {
      setInputValue(itemInput, "cobblestone");
    });
    await act(async () => {
      root.render(<AdminPlayersPanel overview={{ ...overview, players: [{ ...player, inventory: player.inventory.map((item) => ({ ...item })) }] }} currentUserId="account-1" isBusy={() => false} mutate={mutate} notice={notice} />);
    });
    expect(itemInput.value).toBe("cobblestone");
    const inventoryForm = itemInput.closest("form")!;
    await act(async () => {
      inventoryForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mutate).toHaveBeenCalledWith("inventory:account-1:ender", "/admin/players/account-1/inventory", {
      method: "PUT",
      body: JSON.stringify({ section: "ender", slot: 5, item: { type: "cobblestone", amount: 1, durability: 0 } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(notice).toHaveBeenCalledWith("아이템을 저장했어요.");

    await act(async () => root.unmount());
  });

  it("keeps archived users in a collapsed list and restores them", async () => {
    const activeUser = { ...overview.users[0], id: "active-2", username: "active", gameUsername: "active", displayName: "활성 사용자", isAdmin: false };
    const archivedUser = { ...overview.users[0], id: "archived-3", username: "dormant", gameUsername: "dormant", displayName: "보관 사용자", archivedAt: Date.now() - 86_400_000, isAdmin: false };
    const inactivePlayer = { ...player, accountId: activeUser.id, uuid: activeUser.id, username: activeUser.gameUsername, displayName: activeUser.displayName, online: false, dataAvailable: false, inventory: [], enderChest: [] };
    const archivedPlayer = { ...inactivePlayer, accountId: archivedUser.id, uuid: archivedUser.id, username: archivedUser.gameUsername, displayName: archivedUser.displayName };
    const archiveOverview = { ...overview, users: [overview.users[0], activeUser, archivedUser], players: [player, inactivePlayer, archivedPlayer] };
    const mutate = vi.fn().mockResolvedValue({});
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AdminPlayersPanel overview={archiveOverview} currentUserId="account-1" isBusy={() => false} mutate={mutate} notice={vi.fn()} />);
    });
    expect(container.textContent).not.toContain("보관 사용자");
    const archiveToggle = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("보관함"))!;
    expect(archiveToggle.getAttribute("aria-expanded")).toBe("false");

    await act(async () => archiveToggle.click());
    expect(container.textContent).toContain("보관 사용자");
    const archivedUserButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("보관 사용자"))!;
    await act(async () => archivedUserButton.click());
    const restoreButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "보관 해제")!;
    await act(async () => {
      restoreButton.click();
      await Promise.resolve();
    });
    expect(mutate).toHaveBeenLastCalledWith("archive:archived-3", "/admin/users/archived-3/archive", {
      method: "PUT",
      body: JSON.stringify({ archived: false }),
      headers: { "Content-Type": "application/json" },
    });

    mutate.mockClear();
    const activeUserButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("활성 사용자"))!;
    await act(async () => activeUserButton.click());
    const archiveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "보관")!;
    expect(archiveButton.disabled).toBe(false);
    await act(async () => {
      archiveButton.click();
      await Promise.resolve();
    });
    expect(mutate).toHaveBeenLastCalledWith("archive:active-2", "/admin/users/active-2/archive", {
      method: "PUT",
      body: JSON.stringify({ archived: true }),
      headers: { "Content-Type": "application/json" },
    });

    await act(async () => root.unmount());
  });

  it("sorts active and archived users by last online time, play time, and Korean name", async () => {
    const user = (id: string, displayName: string, archivedAt: number | null = null) => ({
      ...overview.users[0],
      id,
      username: id,
      gameUsername: id,
      displayName,
      archivedAt,
      isAdmin: false,
    });
    const activeUsers = [user("garam", "가람"), user("nari", "나리"), user("daon", "다온")];
    const archivedUsers = [user("maeum", "마음", 1), user("raon", "라온", 1)];
    const makePlayer = (accountId: string, online: boolean, lastSeenAt: number, playTimeTicks: number): PlayerDetails => ({
      ...player,
      accountId,
      uuid: accountId,
      username: accountId,
      displayName: accountId,
      online,
      dataAvailable: false,
      lastSeenAt,
      playTimeTicks,
      inventory: [],
      enderChest: [],
    });
    const sortedOverview = {
      ...overview,
      users: [...activeUsers, ...archivedUsers],
      players: [
        makePlayer("garam", false, 100, 900),
        makePlayer("nari", true, 50, 100),
        makePlayer("daon", false, 200, 500),
        makePlayer("maeum", false, 400, 200),
        makePlayer("raon", false, 300, 700),
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const ids = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)].map((element) => element.dataset.userId);

    await act(async () => {
      root.render(<AdminPlayersPanel overview={sortedOverview} currentUserId="none" isBusy={() => false} mutate={vi.fn()} notice={vi.fn()} />);
    });

    expect(ids(".admin-list-panel > .admin-list-button")).toEqual(["nari", "daon", "garam"]);
    const archiveToggle = container.querySelector<HTMLButtonElement>(".admin-archive-toggle")!;
    await act(async () => archiveToggle.click());
    expect(ids(".admin-archived-list .admin-list-button")).toEqual(["maeum", "raon"]);

    const sortSelect = container.querySelector<HTMLSelectElement>('select[aria-label="플레이어 정렬"]')!;
    await act(async () => setSelectValue(sortSelect, "playtime"));
    expect(ids(".admin-list-panel > .admin-list-button")).toEqual(["garam", "daon", "nari"]);
    expect(ids(".admin-archived-list .admin-list-button")).toEqual(["raon", "maeum"]);

    await act(async () => setSelectValue(sortSelect, "name"));
    expect(ids(".admin-list-panel > .admin-list-button")).toEqual(["garam", "nari", "daon"]);
    expect(ids(".admin-archived-list .admin-list-button")).toEqual(["raon", "maeum"]);

    await act(async () => root.unmount());
  });
});
