import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiRouter } from "../server/api.js";
import { AppDatabase } from "../server/db.js";
import { GameConnectionTracker } from "../server/game-connections.js";
import { HistoryStore } from "../server/history-store.js";
import type { PlayerAccountReference, PlayerInventoryPatch, PlayerStatePatch } from "../server/player-data.js";
import { createSessionToken, hashPassword, verifyPassword } from "../server/security.js";
import type { ConsoleLogPage, MinecraftServerManager } from "../server/server-manager.js";
import { SkinService, skinPathForUser } from "../server/skins.js";
import type { PlayerDetails, ServerSettings, ServerStatus } from "../server/types.js";

const secret = "api-test-secret-that-is-longer-than-thirty-two-characters";
const sharedServerPassword = "명심보감";
const cleanups: Array<() => void | Promise<void>> = [];

const serverStatus: ServerStatus = {
  phase: "off",
  players: [],
  startedAt: null,
  readyAt: null,
  idleShutdownAt: null,
  lastError: null,
  startAllowedAt: 0,
  maxPlayers: 12,
  version: "Paper 1.12.2",
};

const serverSettings: ServerSettings = {
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
};

function settingsUpdateForApi(base: ServerSettings): ServerSettings {
  return {
    ...base,
    motd: "관리 API 테스트",
    maxPlayers: 18,
    difficulty: "hard",
    defaultGameMode: "adventure",
    viewDistance: 10,
    playerIdleTimeout: 15,
    pvp: false,
    allowFlight: true,
    commandBlocks: true,
    keepInventory: false,
    tpaEnabled: false,
  };
}

function fakePlayer(account: PlayerAccountReference, changes: Partial<PlayerDetails> = {}): PlayerDetails {
  return {
    accountId: account.id,
    uuid: account.id,
    username: account.gameUsername,
    displayName: account.displayName,
    online: false,
    dataAvailable: false,
    firstSeenAt: null,
    lastSeenAt: null,
    playTimeTicks: 0,
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
    gameMode: "survival",
    inventory: [],
    enderChest: [],
    ...changes,
  };
}

function fakeServerManager(
  status = serverStatus,
  consoleCommands: string[] = [],
  logHistory: ConsoleLogPage = { entries: [], nextOffset: null },
  logRequests: Array<{ query?: string; offset?: number; limit?: number }> = [],
): MinecraftServerManager {
  return {
    getStatus: () => ({ ...status, players: [...status.players] }),
    getServerSettings: async () => ({ ...serverSettings, maxPlayers: status.maxPlayers }),
    updateServerSettings: async (settings: ServerSettings) => settings,
    getStoredPlayers: async (accounts) => accounts.map((account) => fakePlayer(account)),
    getStoredPlayer: async (account: PlayerAccountReference) => fakePlayer(account),
    updateStoredPlayerState: async (account: PlayerAccountReference, patch: PlayerStatePatch) => fakePlayer(account, {
      dataAvailable: true,
      ...(patch.health === undefined ? {} : { health: patch.health }),
      ...(patch.foodLevel === undefined ? {} : { foodLevel: patch.foodLevel }),
      ...(patch.gameMode === undefined ? {} : { gameMode: patch.gameMode }),
      ...(patch.location ?? {}),
    }),
    updateStoredPlayerInventory: async (account: PlayerAccountReference, patch: PlayerInventoryPatch) => fakePlayer(account, {
      dataAvailable: true,
      inventory: patch.section === "ender" || !patch.item ? [] : [{ section: patch.section, slot: patch.slot, ...patch.item }],
      enderChest: patch.section === "ender" && patch.item ? [{ section: "ender", slot: patch.slot, ...patch.item }] : [],
    }),
    setStoredPlayerOperator: async (account: PlayerAccountReference, operator: boolean) => fakePlayer(account, { operator }),
    setStoredPlayerBanned: async (account: PlayerAccountReference, banned: boolean) => fakePlayer(account, { banned }),
    isPlayerOnline: (username: string) => status.players.some((player) => player.toLowerCase() === username.toLowerCase()),
    getLogHistory: async (options) => {
      logRequests.push(options);
      return logHistory;
    },
    sendCommand: async (command: string) => {
      if (status.phase !== "online") throw new Error("게임 서버가 온라인일 때만 명령을 실행할 수 있어요.");
      consoleCommands.push(command);
    },
  } as unknown as MinecraftServerManager;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${address.port}`;
}

async function createHarness(options: {
  bridgeOrigin?: string;
  adminUserIds?: string[];
  adminUsernames?: string[];
  serverStatus?: ServerStatus;
  consoleCommands?: string[];
  logHistory?: ConsoleLogPage;
  logRequests?: Array<{ query?: string; offset?: number; limit?: number }>;
} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-api-"));
  const database = new AppDatabase(dataDir);
  const history = new HistoryStore(dataDir);
  cleanups.push(() => {
    history.close();
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const adminPassword = await hashPassword("admin-password");
  const userPassword = await hashPassword("user-password");
  const admin = database.createUser("adminuser", adminPassword.hash, adminPassword.salt);
  const user = database.createUser("normaluser", userPassword.hash, userPassword.salt);
  const session = createSessionToken(admin, secret, 1);
  const gameConnections = new GameConnectionTracker();
  const app = express();
  app.use("/api", createApiRouter({
    database,
    skins: new SkinService(database, dataDir, path.join(process.cwd(), "public")),
    serverManager: fakeServerManager(options.serverStatus, options.consoleCommands, options.logHistory, options.logRequests),
    sessionSecret: secret,
    serverPassword: sharedServerPassword,
    secureCookies: false,
    sessionDays: 1,
    eulaAccepted: true,
    gameConnections,
    history,
    adminUserIds: options.adminUserIds ?? [admin.id],
    adminUsernames: options.adminUsernames,
    adminPassword: "G4ndan",
    bridgeOrigin: options.bridgeOrigin,
    bridgeSecret: secret,
  }));
  const origin = await listen(http.createServer(app));
  const adminHeaders = {
    Cookie: `spawnpoint_session=${session.token}`,
    "x-spawnpoint-csrf": session.csrf,
  };
  return { admin, adminHeaders, database, gameConnections, history, origin, user };
}

describe("unified player names", () => {
  it("keeps the login name and in-game display name identical", async () => {
    const harness = await createHarness();
    const session = createSessionToken(harness.user, secret, 1);
    const response = await fetch(`${harness.origin}/api/account/profile`, {
      method: "PATCH",
      headers: {
        Cookie: `spawnpoint_session=${session.token}`,
        "x-spawnpoint-csrf": session.csrf,
        "Content-Type": "application/json",
        Origin: harness.origin,
      },
      body: JSON.stringify({ username: "텔레그램", displayName: "다른이름" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { username: "텔레그램", displayName: "텔레그램" },
    });
    expect(harness.database.getUserById(harness.user.id)).toMatchObject({
      username: "텔레그램",
      displayName: "텔레그램",
    });
  });

  it("exposes technical name mappings only to the local plugin secret", async () => {
    const harness = await createHarness();
    const rejected = await fetch(`${harness.origin}/api/internal/game-identities`);
    expect(rejected.status).toBe(401);

    const allowed = await fetch(`${harness.origin}/api/internal/game-identities`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      identities: expect.arrayContaining([
        { displayName: "adminuser", gameUsername: "adminuser" },
        { displayName: "normaluser", gameUsername: "normaluser" },
      ]),
    });
  });
});

describe("hidden administrator unlock", () => {
  it("unlocks without a configured administrator account", async () => {
    const harness = await createHarness({ adminUserIds: [], adminUsernames: [] });
    const unlocked = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "G4ndan" }),
    });
    const body = await unlocked.json() as { user: { id: string; displayName: string; isAdmin: boolean }; csrf: string };

    expect(unlocked.status).toBe(200);
    expect(body.user).toMatchObject({
      id: "spawnpoint-standalone-admin",
      displayName: "관리자",
      isAdmin: true,
    });

    const adminCookie = unlocked.headers.get("set-cookie")!.split(";", 1)[0];
    const overview = await fetch(`${harness.origin}/api/admin/overview`, {
      headers: { Cookie: adminCookie, "x-spawnpoint-csrf": body.csrf },
    });
    expect(overview.status).toBe(200);
  });

  it("counts only wrong passwords and resets the limit after a correct password", async () => {
    const harness = await createHarness();
    const wrong = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(wrong.status).toBe(401);

    const unlocked = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "G4ndan" }),
    });
    const body = await unlocked.json() as { user: { id: string; isAdmin: boolean }; csrf: string; adminExpiresAt: number };
    expect(unlocked.status).toBe(200);
    expect(body.user).toMatchObject({ id: "spawnpoint-standalone-admin", isAdmin: true });
    expect(body.csrf).toEqual(expect.any(String));
    expect(body.adminExpiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(unlocked.headers.get("set-cookie")).not.toContain("spawnpoint_session=");
    expect(unlocked.headers.get("set-cookie")).toContain("spawnpoint_admin=");
    expect(unlocked.headers.get("set-cookie")).toContain("Max-Age=600");

    const adminCookie = unlocked.headers.get("set-cookie")!.split(";", 1)[0];
    const overview = await fetch(`${harness.origin}/api/admin/overview`, {
      headers: { Cookie: adminCookie, "x-spawnpoint-csrf": body.csrf },
    });
    expect(overview.status).toBe(200);

    const bootstrap = await fetch(`${harness.origin}/api/bootstrap`, { headers: { Cookie: adminCookie } });
    const bootstrapBody = await bootstrap.json() as { user: unknown };
    expect(bootstrapBody.user).toBeNull();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const failed = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
        method: "POST",
        headers: { Origin: harness.origin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(failed.status).toBe(401);
    }
    const limited = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(limited.status).toBe(429);

    const recovered = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "G4ndan" }),
    });
    expect(recovered.status).toBe(200);
    const afterReset = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(afterReset.status).toBe(401);
  });

  it("keeps the signed-in account and revokes only its temporary administrator grant", async () => {
    const harness = await createHarness();
    const session = createSessionToken(harness.user, secret, 1);
    const sessionCookie = `spawnpoint_session=${session.token}`;
    const unlocked = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Origin: harness.origin, "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ password: "G4ndan" }),
    });
    const unlockedBody = await unlocked.json() as { user: { id: string; isAdmin: boolean }; csrf: string; adminExpiresAt: number };
    expect(unlocked.status).toBe(200);
    expect(unlockedBody.user).toMatchObject({ id: harness.user.id, isAdmin: true });
    expect(unlockedBody.csrf).toBe(session.csrf);

    const adminCookie = unlocked.headers.get("set-cookie")!.split(";", 1)[0];
    const elevatedHeaders = {
      Cookie: `${sessionCookie}; ${adminCookie}`,
      "x-spawnpoint-csrf": session.csrf,
    };
    const overview = await fetch(`${harness.origin}/api/admin/overview`, { headers: elevatedHeaders });
    expect(overview.status).toBe(200);

    const bootstrap = await fetch(`${harness.origin}/api/bootstrap`, { headers: { Cookie: elevatedHeaders.Cookie } });
    const bootstrapBody = await bootstrap.json() as { user: { id: string; isAdmin: boolean }; adminExpiresAt: number };
    expect(bootstrapBody.user).toMatchObject({ id: harness.user.id, isAdmin: true });
    expect(bootstrapBody.adminExpiresAt).toBe(unlockedBody.adminExpiresAt);

    const locked = await fetch(`${harness.origin}/api/auth/admin-lock`, {
      method: "POST",
      headers: { ...elevatedHeaders, Origin: harness.origin },
    });
    const lockedBody = await locked.json() as { user: { id: string; isAdmin: boolean }; adminExpiresAt: null };
    expect(locked.status).toBe(200);
    expect(lockedBody.user).toMatchObject({ id: harness.user.id, isAdmin: false });
    expect(lockedBody.adminExpiresAt).toBeNull();
    expect(locked.headers.get("set-cookie")).toContain("spawnpoint_admin=; Max-Age=0");

    const revokedOverview = await fetch(`${harness.origin}/api/admin/overview`, {
      headers: { Cookie: sessionCookie, "x-spawnpoint-csrf": session.csrf },
    });
    expect(revokedOverview.status).toBe(403);
  });
});

describe("player locator API", () => {
  it("returns other online players for the TPA picker", async () => {
    const harness = await createHarness({
      serverStatus: { ...serverStatus, phase: "online", players: ["adminuser", "normaluser"] },
    });

    const unauthenticated = await fetch(`${harness.origin}/api/game/players`);
    expect(unauthenticated.status).toBe(401);

    const response = await fetch(`${harness.origin}/api/game/players`, {
      headers: { Cookie: harness.adminHeaders.Cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      players: [{ gameUsername: harness.user.gameUsername, displayName: harness.user.displayName }],
    });
  });

  it("returns only the signed-in player's relative targets with current skin URLs", async () => {
    let bridgeRequest: { path?: string; authorization?: string } = {};
    let bridgeRequestCount = 0;
    let targetAccountId = "";
    let targetUsername = "";
    let targetDisplayName = "";
    let targetSkinUrl = "";
    let harnessAdminId = "";
    const targetUuid = "c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb";
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      bridgeRequestCount += 1;
      bridgeRequest = {
        path: request.url,
        authorization: request.headers.authorization,
      };
      setTimeout(() => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          snapshots: {
            [harnessAdminId]: {
              active: true,
              targets: [{
                accountId: targetAccountId,
                skinUrl: targetSkinUrl,
                uuid: targetUuid,
                username: targetUsername,
                displayName: targetDisplayName,
                angle: -37.5,
                distance: 18.25,
              }],
            },
          },
        }));
      }, 25);
    }));
    const harness = await createHarness({
      bridgeOrigin,
      serverStatus: { ...serverStatus, phase: "online" },
    });
    targetAccountId = harness.user.id;
    harnessAdminId = harness.admin.id;
    targetUsername = harness.user.gameUsername;
    targetDisplayName = harness.user.displayName;
    targetSkinUrl = skinPathForUser(harness.user);

    const unauthenticated = await fetch(`${harness.origin}/api/game/locator`);
    expect(unauthenticated.status).toBe(401);

    const [response, concurrentResponse] = await Promise.all([
      fetch(`${harness.origin}/api/game/locator`, {
        headers: { Cookie: harness.adminHeaders.Cookie },
      }),
      fetch(`${harness.origin}/api/game/locator`, {
        headers: { Cookie: harness.adminHeaders.Cookie },
      }),
    ]);
    expect([response.status, concurrentResponse.status]).toEqual([200, 200]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(bridgeRequest).toEqual({
      path: "/v1/locators",
      authorization: `Bearer ${secret}`,
    });
    const firstBody = await response.json();
    expect(await concurrentResponse.json()).toEqual(firstBody);
    expect(firstBody).toEqual({
      active: true,
      targets: [{
        id: targetUuid,
        displayName: harness.user.displayName,
        angle: -37.5,
        distance: 18.25,
        skinUrl: skinPathForUser(harness.user),
      }],
    });

    const cachedResponse = await fetch(`${harness.origin}/api/game/locator`, {
      headers: { Cookie: harness.adminHeaders.Cookie },
    });
    expect(cachedResponse.status).toBe(200);
    expect(await cachedResponse.json()).toEqual(firstBody);
    expect(bridgeRequestCount).toBe(1);
  });

  it("rejects an invalid locator batch and retries the bridge on the next request", async () => {
    let bridgeRequestCount = 0;
    let accountId = "";
    const bridgeOrigin = await listen(http.createServer((_request, response) => {
      bridgeRequestCount += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(bridgeRequestCount === 1
        ? { snapshots: { broken: { active: true, targets: [{ angle: "wrong" }] } } }
        : { snapshots: { [accountId]: { active: true, targets: [] } } }));
    }));
    const harness = await createHarness({
      bridgeOrigin,
      serverStatus: { ...serverStatus, phase: "online" },
    });
    accountId = harness.admin.id;

    const invalid = await fetch(`${harness.origin}/api/game/locator`, {
      headers: { Cookie: harness.adminHeaders.Cookie },
    });
    expect(invalid.status).toBe(503);
    expect(await invalid.json()).toMatchObject({ error: { code: "BRIDGE_UNAVAILABLE" } });

    const recovered = await fetch(`${harness.origin}/api/game/locator`, {
      headers: { Cookie: harness.adminHeaders.Cookie },
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ active: true, targets: [] });
    expect(bridgeRequestCount).toBe(2);
  });
});

describe("game chat API", () => {
  it("sends chat through the loopback bridge for the signed-in active launch", async () => {
    let bridgeRequest: { method?: string; path?: string; authorization?: string; body?: unknown } = {};
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        bridgeRequest = {
          method: request.method,
          path: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(body),
        };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ sent: true, command: false }));
      });
    }));
    const harness = await createHarness({ bridgeOrigin });
    const launchId = crypto.randomUUID();
    harness.gameConnections.create(launchId, harness.admin.id);
    expect(harness.gameConnections.begin(launchId, harness.admin.id)).not.toBeNull();

    const response = await fetch(`${harness.origin}/api/game/chat`, {
      method: "POST",
      headers: {
        Cookie: harness.adminHeaders.Cookie,
        Origin: harness.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ launchId, message: "한글 채팅" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true, command: false });
    expect(bridgeRequest).toEqual({
      method: "POST",
      path: `/v1/chat/${harness.admin.id}`,
      authorization: `Bearer ${secret}`,
      body: { message: "한글 채팅" },
    });

    const inactive = await fetch(`${harness.origin}/api/game/chat`, {
      method: "POST",
      headers: {
        Cookie: harness.adminHeaders.Cookie,
        Origin: harness.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ launchId: crypto.randomUUID(), message: "보내면 안 됨" }),
    });
    expect(inactive.status).toBe(409);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("separate login and registration", () => {
  it("requires strong new passwords while letting an existing weak account sign in", async () => {
    const harness = await createHarness();
    const weakPassword = await hashPassword("한");
    harness.database.createUser("기존계정", weakPassword.hash, weakPassword.salt);

    const rejectedRegistration = await fetch(`${harness.origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ username: "새계정", password: "한", serverPassword: sharedServerPassword }),
    });
    expect(rejectedRegistration.status).toBe(400);

    const registerResponse = await fetch(`${harness.origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ username: "새계정", password: "충분히긴비밀번호", serverPassword: sharedServerPassword }),
    });
    expect(registerResponse.status).toBe(201);

    const loginResponse = await fetch(`${harness.origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ username: "기존계정", password: "한" }),
    });
    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.json()).toMatchObject({ created: false });

    const existingAvailability = await fetch(`${harness.origin}/api/auth/username-availability?username=${encodeURIComponent("기존계정")}`);
    expect(await existingAvailability.json()).toMatchObject({ available: false, exists: true });
    const missingAvailability = await fetch(`${harness.origin}/api/auth/username-availability?username=${encodeURIComponent("없는계정")}`);
    expect(await missingAvailability.json()).toMatchObject({ available: true, exists: false });
  });
});

describe("account session updates", () => {
  it("revokes temporary administrator access after a password change", async () => {
    const harness = await createHarness({ adminUserIds: [] });
    const playerSession = createSessionToken(harness.user, secret, 1);
    const sessionCookie = `spawnpoint_session=${playerSession.token}`;
    const unlocked = await fetch(`${harness.origin}/api/auth/admin-unlock`, {
      method: "POST",
      headers: { Cookie: sessionCookie, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "G4ndan" }),
    });
    const unlockBody = await unlocked.json() as { csrf: string; adminExpiresAt: number };
    const adminCookie = unlocked.headers.get("set-cookie")!.split(";", 1)[0];

    const changed = await fetch(`${harness.origin}/api/account/password`, {
      method: "POST",
      headers: {
        Cookie: `${sessionCookie}; ${adminCookie}`,
        Origin: harness.origin,
        "Content-Type": "application/json",
        "x-spawnpoint-csrf": unlockBody.csrf,
      },
      body: JSON.stringify({ currentPassword: "user-password", newPassword: "new-user-password" }),
    });
    const body = await changed.json() as { user: { isAdmin: boolean }; adminExpiresAt: number | null };

    expect(changed.status).toBe(200);
    expect(body).toMatchObject({ user: { isAdmin: false }, adminExpiresAt: null });
    expect(changed.headers.get("set-cookie")).toContain("spawnpoint_admin=; Max-Age=0");
  });
});

describe("skin catalog usage", () => {
  it("shows signed-in players who already use each catalog skin", async () => {
    const harness = await createHarness();
    harness.database.updateSkin(harness.user.id, "preset", "alex", "alex", "알렉스");

    const response = await fetch(`${harness.origin}/api/skin/catalog`, { headers: harness.adminHeaders });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as {
      categories: Array<{ skins: Array<{ id: string; usedBy: Array<{ id: string; displayName: string }> }> }>;
    };
    const skins = body.categories.flatMap((category) => category.skins);
    expect(skins.find((skin) => skin.id === "steve")?.usedBy).toEqual([
      { id: harness.admin.id, displayName: harness.admin.displayName },
    ]);
    expect(skins.find((skin) => skin.id === "alex")?.usedBy).toEqual([
      { id: harness.user.id, displayName: harness.user.displayName },
    ]);

    const anonymous = await fetch(`${harness.origin}/api/skin/catalog`);
    expect(anonymous.status).toBe(401);
  });
});

describe("game launch", () => {
  it("creates the client profile without returning a discarded game ticket", async () => {
    const harness = await createHarness({ serverStatus: { ...serverStatus, phase: "online" } });
    const response = await fetch(`${harness.origin}/api/game-ticket`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ launchId: crypto.randomUUID() }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.profile).toEqual(expect.any(String));
    expect(body.resourcePackPreference).toBe("new-default");
    expect(body).not.toHaveProperty("ticket");
  });

  it("limits repeated game launches per account", async () => {
    const harness = await createHarness({ serverStatus: { ...serverStatus, phase: "online" } });
    const launch = () => fetch(`${harness.origin}/api/game-ticket`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ launchId: crypto.randomUUID() }),
    });

    for (let index = 0; index < 12; index++) {
      expect((await launch()).status).toBe(200);
    }
    const limited = await launch();
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("returns the account resource-pack choice on a later game launch", async () => {
    const harness = await createHarness({ serverStatus: { ...serverStatus, phase: "online" } });
    const changed = await fetch(`${harness.origin}/api/account/resource-pack`, {
      method: "PUT",
      headers: {
        ...harness.adminHeaders,
        Origin: harness.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resourcePackPreference: "programmer-art" }),
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ resourcePackPreference: "programmer-art" });

    const launched = await fetch(`${harness.origin}/api/game-ticket`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ launchId: crypto.randomUUID() }),
    });
    expect(launched.status).toBe(200);
    expect(await launched.json()).toMatchObject({ resourcePackPreference: "programmer-art" });
  });

  it("rejects unknown resource-pack choices", async () => {
    const harness = await createHarness();
    const response = await fetch(`${harness.origin}/api/account/resource-pack`, {
      method: "PUT",
      headers: {
        ...harness.adminHeaders,
        Origin: harness.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resourcePackPreference: "xray" }),
    });

    expect(response.status).toBe(400);
    expect(harness.database.getUserById(harness.admin.id)?.resourcePackPreference).toBe("new-default");
  });
});

describe("secure administrator password resets", () => {
  it("returns one reset code, stores only its digest, and consumes it once", async () => {
    let disconnectRequest: { method?: string; path?: string; authorization?: string } = {};
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      disconnectRequest = {
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
      };
      response.statusCode = 404;
      response.end();
    }));
    const harness = await createHarness({ bridgeOrigin });
    const resetResponse = await fetch(`${harness.origin}/api/admin/users/${harness.user.id}/password-reset`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin },
    });
    const resetBody = await resetResponse.json() as { resetCode: string; user: { resetRequired: boolean } };

    expect(resetResponse.status).toBe(200);
    expect(resetBody.resetCode).toMatch(/^\d{6}$/);
    expect(resetBody.user.resetRequired).toBe(true);
    expect(harness.database.getUserById(harness.user.id)?.passwordResetDigest).toHaveLength(32);
    expect(harness.database.getUserById(harness.user.id)?.passwordResetDigest?.toString("utf8"))
      .not.toContain(resetBody.resetCode);
    expect(disconnectRequest).toEqual({
      method: "POST",
      path: `/v1/players/${harness.user.id}/disconnect`,
      authorization: `Bearer ${secret}`,
    });
    const overviewResponse = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    expect(await overviewResponse.text()).not.toContain(resetBody.resetCode);

    const wrongResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({
        username: harness.user.username,
        password: "new-user-password",
        serverPassword: "wrong-reset-code",
      }),
    });
    const wrongBody = await wrongResponse.json() as { error: { code: string; message: string } };
    expect(wrongResponse.status).toBe(401);
    expect(wrongBody.error.code).toBe("INVALID_LOGIN");
    expect(wrongBody.error.message).not.toMatch(/reset|초기화|코드/i);

    const completeResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({
        username: harness.user.username,
        password: "new-user-password",
        serverPassword: resetBody.resetCode,
      }),
    });
    expect(completeResponse.status).toBe(200);
    const completed = harness.database.getUserById(harness.user.id)!;
    expect(completed.passwordResetDigest).toBeNull();
    expect(completed.passwordResetExpiresAt).toBeNull();
    await expect(verifyPassword("new-user-password", completed.passwordSalt, completed.passwordHash)).resolves.toBe(true);

    const reusedResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({
        username: harness.user.username,
        password: "another-password",
        serverPassword: resetBody.resetCode,
      }),
    });
    expect(reusedResponse.status).toBe(401);
  });

  it("replaces a password with a one-time displayed temporary value and never exposes its hash", async () => {
    const harness = await createHarness();
    const before = harness.database.getUserById(harness.user.id)!;
    const response = await fetch(`${harness.origin}/api/admin/users/${harness.user.id}/temporary-password`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin },
    });
    const body = await response.json() as { temporaryPassword: string; user: { passwordUpdatedAt: number } };

    expect(response.status).toBe(200);
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|passwordSalt|passwordResetDigest/);
    const updated = harness.database.getUserById(harness.user.id)!;
    expect(updated.sessionVersion).toBe(before.sessionVersion + 1);
    expect(updated.passwordUpdatedAt).toBeGreaterThanOrEqual(before.passwordUpdatedAt);
    await expect(verifyPassword(body.temporaryPassword, updated.passwordSalt, updated.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("user-password", updated.passwordSalt, updated.passwordHash)).resolves.toBe(false);
  });

  it("keeps the shared server password for ordinary login and registration", async () => {
    const harness = await createHarness();
    harness.database.requestPasswordReset(harness.user.id, Buffer.alloc(32, 3), Date.now() - 1);
    const loginResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({
        username: harness.user.username,
        password: "user-password",
        serverPassword: sharedServerPassword,
      }),
    });
    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.json()).toMatchObject({ created: false });
    expect(harness.database.getUserById(harness.user.id)?.passwordResetDigest).toBeNull();
    expect(harness.database.getUserById(harness.user.id)?.passwordResetExpiresAt).toBeNull();

    const registerResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({
        username: "newmember",
        password: "member-password",
        serverPassword: sharedServerPassword,
      }),
    });
    expect(registerResponse.status).toBe(200);
    expect(await registerResponse.json()).toMatchObject({ created: true });
    expect(harness.database.getUserByUsername("newmember")).not.toBeNull();
  });

  it("registers and logs in with a Korean account name while keeping a Minecraft-safe identity", async () => {
    const harness = await createHarness();
    const credentials = {
      username: "텔레그램",
      password: "member-password",
      serverPassword: sharedServerPassword,
    };
    const registerResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify(credentials),
    });

    expect(registerResponse.status).toBe(200);
    expect(await registerResponse.json()).toMatchObject({ created: true });
    const created = harness.database.getUserByUsername("텔레그램");
    expect(created?.displayName).toBe("텔레그램");
    expect(created?.gameUsername).toMatch(/^sp_[a-f0-9]{13}$/);

    const loginResponse = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify(credentials),
    });
    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.json()).toMatchObject({ created: false });
  });

  it("limits guesses for the same issued reset digest", async () => {
    const harness = await createHarness();
    const resetResponse = await fetch(`${harness.origin}/api/admin/users/${harness.user.id}/password-reset`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin },
    });
    const { resetCode } = await resetResponse.json() as { resetCode: string };
    const wrongCode = resetCode === "000000" ? "000001" : "000000";

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetch(`${harness.origin}/api/auth/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: harness.origin },
        body: JSON.stringify({
          username: harness.user.username,
          password: "new-user-password",
          serverPassword: wrongCode,
        }),
      });
      expect(response.status).toBe(401);
    }

    const limited = await fetch(`${harness.origin}/api/auth/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({
        username: harness.user.username,
        password: "new-user-password",
        serverPassword: wrongCode,
      }),
    });
    const body = await limited.json() as { error: { code: string } };
    expect(limited.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});

describe("administrator route guards", () => {
  it("allows overview GET without Origin while still requiring session CSRF", async () => {
    const harness = await createHarness();
    const allowed = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    expect(allowed.status).toBe(200);

    const rejected = await fetch(`${harness.origin}/api/admin/overview`, {
      headers: { Cookie: harness.adminHeaders.Cookie },
    });
    expect(rejected.status).toBe(403);
  });

  it("does not let an administrator rename an ordinary account to an allowlisted username", async () => {
    const harness = await createHarness({ adminUsernames: ["reservedadmin"] });
    const response = await fetch(`${harness.origin}/api/admin/users/${harness.user.id}/profile`, {
      method: "PATCH",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ username: "reservedadmin" }),
    });
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("RESERVED_USERNAME");
    expect(harness.database.getUserById(harness.user.id)?.username).toBe("normaluser");
  });

  it("archives an inactive user and restores the account when it returns", async () => {
    const harness = await createHarness();
    const userSession = createSessionToken(harness.user, secret, 1);
    const archive = await fetch(`${harness.origin}/api/admin/users/${harness.user.id}/archive`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ archived: true }),
    });

    expect(archive.status).toBe(200);
    expect(await archive.json()).toEqual({ archived: true });
    expect(harness.database.getUserById(harness.user.id)?.archivedAt).toEqual(expect.any(Number));

    const overview = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    const overviewBody = await overview.json() as { users: Array<{ id: string; archivedAt: number | null }> };
    expect(overviewBody.users.find((user) => user.id === harness.user.id)?.archivedAt).toEqual(expect.any(Number));

    const returned = await fetch(`${harness.origin}/api/bootstrap`, {
      headers: { Cookie: `spawnpoint_session=${userSession.token}` },
    });
    expect(returned.status).toBe(200);
    expect(harness.database.getUserById(harness.user.id)?.archivedAt).toBeNull();

    const selfArchive = await fetch(`${harness.origin}/api/admin/users/${harness.admin.id}/archive`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ archived: true }),
    });
    expect(selfArchive.status).toBe(400);
    expect(await selfArchive.json()).toMatchObject({ error: { code: "SELF_ARCHIVE_NOT_ALLOWED" } });
  });

  it("does not archive a player who is still in the game", async () => {
    const harness = await createHarness({ serverStatus: { ...serverStatus, phase: "online", players: ["normaluser"] } });
    const response = await fetch(`${harness.origin}/api/admin/users/${harness.user.id}/archive`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ archived: true }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "PLAYER_ONLINE" } });
    expect(harness.database.getUserById(harness.user.id)?.archivedAt).toBeNull();
  });

  it("allows three overview polling tabs plus refresh headroom", async () => {
    const harness = await createHarness();
    const statuses: number[] = [];
    for (let offset = 0; offset < 1_200; offset += 100) {
      const responses = await Promise.all(Array.from({ length: 100 }, () => (
        fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders })
      )));
      statuses.push(...responses.map((response) => response.status));
    }
    expect(statuses).toHaveLength(1_200);
    expect(statuses.every((status) => status === 200)).toBe(true);

    const limited = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    expect(limited.status).toBe(429);
  });
});

describe("administrator TPA settings", () => {
  it("loads players and settings independently and updates an exact boolean", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    let updateBody = "";
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET" && request.url === "/v1/players") {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "server_busy" }));
        return;
      }
      if (request.method === "GET" && request.url === "/v1/settings") {
        response.end(JSON.stringify({ tpaEnabled: true, keepInventory: true }));
        return;
      }
      if (request.method === "PUT" && request.url === "/v1/settings/tpa") {
        request.setEncoding("utf8");
        request.on("data", (chunk) => { updateBody += chunk; });
        request.on("end", () => response.end(JSON.stringify({ tpaEnabled: false, keepInventory: true })));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    }));
    const harness = await createHarness({ bridgeOrigin, serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() } });

    const overviewResponse = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    const overview = await overviewResponse.json() as { bridgeAvailable: boolean; players: unknown[]; tpaEnabled: boolean | null };
    expect(overviewResponse.status).toBe(200);
    expect(overview).toMatchObject({ bridgeAvailable: false, tpaEnabled: true, users: expect.arrayContaining([expect.objectContaining({ skin: expect.objectContaining({ model: "steve", previewUrl: expect.stringContaining("/assets/skins/") }) })]) });
    expect(overview.players).toHaveLength(2);
    expect(overview.players).toEqual(expect.arrayContaining([expect.objectContaining({ online: false, dataAvailable: false })]));
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 2_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 2_000);
    timeoutSpy.mockClear();

    const missingCsrfResponse = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers: { Cookie: harness.adminHeaders.Cookie, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ ...serverSettings, tpaEnabled: false }),
    });
    expect(missingCsrfResponse.status).toBe(403);

    const updateResponse = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ ...serverSettings, tpaEnabled: false }),
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ settings: { tpaEnabled: false, keepInventory: true }, liveApplied: true });
    expect(JSON.parse(updateBody)).toEqual({ enabled: false });
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(4_000);

    const invalidResponse = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ ...serverSettings, tpaEnabled: "false" }),
    });
    expect(invalidResponse.status).toBe(400);
  });

  it("keeps player availability when the settings endpoint fails", async () => {
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET" && request.url === "/v1/players") {
        response.end(JSON.stringify({ players: [] }));
        return;
      }
      response.statusCode = 503;
      response.end(JSON.stringify({ error: "settings_unavailable" }));
    }));
    const harness = await createHarness({ bridgeOrigin, serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() } });

    const overviewResponse = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    const overview = await overviewResponse.json() as { bridgeAvailable: boolean; tpaEnabled: boolean | null };
    expect(overviewResponse.status).toBe(200);
    expect(overview).toMatchObject({ bridgeAvailable: true, tpaEnabled: true });

    const updateResponse = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ ...serverSettings, tpaEnabled: false }),
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ settings: { tpaEnabled: false }, liveApplied: false, restartRequired: true });
  });
});

describe("administrator offline controls", () => {
  it("stores the full settings form while Minecraft is off", async () => {
    const harness = await createHarness();
    const requested = settingsUpdateForApi(serverSettings);
    const response = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify(requested),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ settings: requested, restartRequired: false, liveApplied: true });
  });

  it("distinguishes live settings from values that need a server restart", async () => {
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      response.setHeader("Content-Type", "application/json");
      expect(request.method).toBe("PUT");
      expect(request.url).toBe("/v1/settings/tpa");
      response.end(JSON.stringify({ tpaEnabled: false, keepInventory: true }));
    }));
    const harness = await createHarness({
      bridgeOrigin,
      serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() },
    });
    const headers = { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" };

    const liveResponse = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...serverSettings, tpaEnabled: false }),
    });
    expect(liveResponse.status).toBe(200);
    await expect(liveResponse.json()).resolves.toMatchObject({ restartRequired: false, liveApplied: true });

    const restartResponse = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...serverSettings, maxPlayers: 18 }),
    });
    expect(restartResponse.status).toBe(200);
    await expect(restartResponse.json()).resolves.toMatchObject({ restartRequired: true, liveApplied: true });
  });

  it("keeps saved settings and requests a restart when a live update fails", async () => {
    const bridgeOrigin = await listen(http.createServer((_request, response) => {
      response.statusCode = 503;
      response.end();
    }));
    const harness = await createHarness({
      bridgeOrigin,
      serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() },
    });
    const response = await fetch(`${harness.origin}/api/admin/settings/server`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ...serverSettings, keepInventory: false }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ restartRequired: true, liveApplied: false });
  });

  it("updates offline state, inventory, OP, and ban status while rejecting an offline kick", async () => {
    const harness = await createHarness();
    const base = `${harness.origin}/api/admin/players/${harness.user.id}`;
    const headers = { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" };
    const stateResponse = await fetch(`${base}/state`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ health: 7.5, foodLevel: 8, gameMode: "creative", location: { world: "world", x: 2, y: 70, z: -3, yaw: 90, pitch: 0 } }),
    });
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({ player: { online: false, health: 7.5, foodLevel: 8, gameMode: "creative", x: 2, y: 70, z: -3 } });

    const inventoryResponse = await fetch(`${base}/inventory`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ section: "storage", slot: 4, item: { type: "diamond", amount: 6, durability: 0 } }),
    });
    expect(inventoryResponse.status).toBe(200);
    await expect(inventoryResponse.json()).resolves.toMatchObject({ player: { inventory: [{ section: "storage", slot: 4, type: "diamond", amount: 6 }] } });

    const operatorResponse = await fetch(`${base}/operator`, { method: "PUT", headers, body: JSON.stringify({ operator: true }) });
    expect(operatorResponse.status).toBe(200);
    await expect(operatorResponse.json()).resolves.toMatchObject({ player: { operator: true } });

    const banResponse = await fetch(`${base}/ban`, { method: "PUT", headers, body: JSON.stringify({ banned: true, reason: "통합 테스트" }) });
    expect(banResponse.status).toBe(200);
    await expect(banResponse.json()).resolves.toMatchObject({ player: { banned: true } });

    const kickResponse = await fetch(`${base}/kick`, { method: "POST", headers, body: JSON.stringify({ reason: "통합 테스트" }) });
    expect(kickResponse.status).toBe(409);
  });
});

describe("administrator console", () => {
  it("sends one validated command while the game server is online", async () => {
    const consoleCommands: string[] = [];
    const harness = await createHarness({
      consoleCommands,
      serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() },
    });
    const response = await fetch(`${harness.origin}/api/admin/console`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "say 안녕하세요" }),
    });

    expect(response.status).toBe(204);
    expect(consoleCommands).toEqual(["say 안녕하세요"]);

    const slashCommand = await fetch(`${harness.origin}/api/admin/console`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "/help" }),
    });
    expect(slashCommand.status).toBe(204);
    expect(consoleCommands).toEqual(["say 안녕하세요", "help"]);

    const injected = await fetch(`${harness.origin}/api/admin/console`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "say hello\nstop" }),
    });
    expect(injected.status).toBe(400);
    expect(consoleCommands).toEqual(["say 안녕하세요", "help"]);
  });

  it("rejects commands while the game server is offline", async () => {
    const harness = await createHarness();
    const response = await fetch(`${harness.origin}/api/admin/console`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "list" }),
    });

    expect(response.status).toBe(409);
  });

  it("returns searchable console history with an older-page offset", async () => {
    const logRequests: Array<{ query?: string; offset?: number; limit?: number }> = [];
    const logHistory: ConsoleLogPage = {
      entries: [{ source: "2026-08-29-1.log.gz", line: "친구 joined the game" }],
      nextOffset: 501,
    };
    const harness = await createHarness({ logHistory, logRequests });
    const response = await fetch(`${harness.origin}/api/admin/logs?q=${encodeURIComponent("친구")}&offset=1`, {
      headers: harness.adminHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(logHistory);
    expect(logRequests).toEqual([{ query: "친구", offset: 1, limit: 500 }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("administrator titles", () => {
  it("sends a validated title to selected players through the loopback bridge", async () => {
    let bridgeRequest: { authorization?: string; body?: unknown } = {};
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        bridgeRequest = { authorization: request.headers.authorization, body: JSON.parse(body) };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ sent: 1 }));
      });
    }));
    const harness = await createHarness({
      bridgeOrigin,
      serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() },
    });
    const target = "00000000-0000-4000-8000-000000000001";
    const response = await fetch(`${harness.origin}/api/admin/title`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "서버 공지",
        subtitle: "곧 저장합니다",
        color: "gold",
        audience: "selected",
        targets: [target, target],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: 1 });
    expect(bridgeRequest).toEqual({
      authorization: `Bearer ${secret}`,
      body: {
        title: "서버 공지",
        subtitle: "곧 저장합니다",
        color: "gold",
        audience: "selected",
        targets: [target],
      },
    });
  });

  it("rejects an empty title or invalid color before calling the bridge", async () => {
    const harness = await createHarness({
      serverStatus: { ...serverStatus, phase: "online", readyAt: Date.now() },
    });
    const response = await fetch(`${harness.origin}/api/admin/title`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", subtitle: "", color: "rainbow", audience: "all", targets: [] }),
    });

    expect(response.status).toBe(400);
  });
});

describe("permanent player and server history", () => {
  it("accepts authenticated plugin chat events and returns them with player skin metadata", async () => {
    const harness = await createHarness();
    const eventId = crypto.randomUUID();
    const response = await fetch(`${harness.origin}/api/internal/player-history`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        type: "chat",
        occurredAt: Date.now(),
        accountId: harness.user.id,
        uuid: crypto.randomUUID(),
        gameUsername: harness.user.gameUsername,
        displayName: "위조된 이름",
        message: "기록할 공개 채팅",
      }),
    });

    expect(response.status).toBe(204);
    const historyResponse = await fetch(`${harness.origin}/api/admin/history/chats?q=${encodeURIComponent("공개 채팅")}`, {
      headers: harness.adminHeaders,
    });
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.headers.get("cache-control")).toBe("no-store");
    const history = await historyResponse.json() as { entries: Array<Record<string, unknown>> };
    expect(history.entries).toEqual([
      expect.objectContaining({
        accountId: harness.user.id,
        displayName: harness.user.displayName,
        gameUsername: harness.user.gameUsername,
        message: "기록할 공개 채팅",
        channel: "public",
        recipientDisplayName: null,
        skinUrl: "/assets/skins/steve.png?v=texture-v2",
      }),
    ]);
  });

  it("stores whisper participants and message text in permanent chat history", async () => {
    const harness = await createHarness();
    const recipient = harness.database.createUser(
      "recipient",
      Buffer.alloc(32, 1),
      Buffer.alloc(16, 2),
    );
    const response = await fetch(`${harness.origin}/api/internal/player-history`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        type: "whisper",
        occurredAt: Date.now(),
        accountId: harness.user.id,
        uuid: crypto.randomUUID(),
        gameUsername: harness.user.gameUsername,
        displayName: harness.user.displayName,
        recipientUuid: crypto.randomUUID(),
        recipientGameUsername: recipient.gameUsername,
        recipientDisplayName: "위조된 수신자",
        message: "귓속말 원문",
      }),
    });

    expect(response.status).toBe(204);
    const historyResponse = await fetch(`${harness.origin}/api/admin/history/chats?q=${encodeURIComponent(recipient.displayName)}`, {
      headers: harness.adminHeaders,
    });
    const history = await historyResponse.json() as { entries: Array<Record<string, unknown>> };
    expect(history.entries[0]).toMatchObject({
      channel: "whisper",
      recipientAccountId: recipient.id,
      recipientGameUsername: recipient.gameUsername,
      recipientDisplayName: recipient.displayName,
      message: "귓속말 원문",
    });
  });

  it("returns full IP addresses in access history", async () => {
    const harness = await createHarness();
    const connectedAt = Date.now() - 10_000;
    const sessionId = harness.history.startGameConnection({
      launchId: crypto.randomUUID(),
      accountId: harness.user.id,
      accountUsername: harness.user.username,
      gameUsername: harness.user.gameUsername,
      displayName: harness.user.displayName,
      ipAddress: "198.51.100.77",
      connectedAt,
    });
    harness.history.markPlayerJoined(harness.user.id, connectedAt + 1_000);
    harness.history.endGameConnection(sessionId, "closed", connectedAt + 9_000);

    const response = await fetch(`${harness.origin}/api/admin/history/access?from=${connectedAt}&to=${connectedAt + 20_000}`, {
      headers: harness.adminHeaders,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json() as { entries: Array<Record<string, unknown>> };
    expect(result.entries[0]).toMatchObject({ ipAddress: "198.51.100.77", joinedAt: connectedAt + 1_000 });
  });

  it("rejects unauthenticated event writes and backwards time ranges", async () => {
    const harness = await createHarness();
    const eventResponse = await fetch(`${harness.origin}/api/internal/player-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(eventResponse.status).toBe(401);

    const historyResponse = await fetch(`${harness.origin}/api/admin/history/logs?from=200&to=100`, {
      headers: harness.adminHeaders,
    });
    expect(historyResponse.status).toBe(400);
  });
});
