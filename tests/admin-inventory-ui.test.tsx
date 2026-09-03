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
});
