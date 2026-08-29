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
import { createSessionToken, hashPassword, verifyPassword } from "../server/security.js";
import type { MinecraftServerManager } from "../server/server-manager.js";
import { SkinService, skinPathForUser } from "../server/skins.js";
import type { ServerStatus } from "../server/types.js";

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

function fakeServerManager(status = serverStatus, consoleCommands: string[] = []): MinecraftServerManager {
  return {
    getStatus: () => ({ ...status, players: [...status.players] }),
    getRecentLogs: () => [],
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

async function createHarness(options: { bridgeOrigin?: string; adminUserIds?: string[]; adminUsernames?: string[]; serverStatus?: ServerStatus; consoleCommands?: string[] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-api-"));
  const database = new AppDatabase(dataDir);
  cleanups.push(() => {
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
    serverManager: fakeServerManager(options.serverStatus, options.consoleCommands),
    sessionSecret: secret,
    serverPassword: sharedServerPassword,
    secureCookies: false,
    sessionDays: 1,
    gameTicketMinutes: 2,
    eulaAccepted: true,
    gameConnections,
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
  return { admin, adminHeaders, database, gameConnections, origin, user };
}

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
    let targetAccountId = "";
    let targetUsername = "";
    let targetDisplayName = "";
    let targetSkinUrl = "";
    const targetUuid = "c7aa85c9-1a36-4fb2-a38d-62c0aa26bceb";
    const bridgeOrigin = await listen(http.createServer((request, response) => {
      bridgeRequest = {
        path: request.url,
        authorization: request.headers.authorization,
      };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
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
      }));
    }));
    const harness = await createHarness({
      bridgeOrigin,
      serverStatus: { ...serverStatus, phase: "online" },
    });
    targetAccountId = harness.user.id;
    targetUsername = harness.user.gameUsername;
    targetDisplayName = harness.user.displayName;
    targetSkinUrl = skinPathForUser(harness.user);

    const unauthenticated = await fetch(`${harness.origin}/api/game/locator`);
    expect(unauthenticated.status).toBe(401);

    const response = await fetch(`${harness.origin}/api/game/locator`, {
      headers: { Cookie: harness.adminHeaders.Cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(bridgeRequest).toEqual({
      path: `/v1/locator/${harness.admin.id}`,
      authorization: `Bearer ${secret}`,
    });
    expect(await response.json()).toEqual({
      active: true,
      targets: [{
        id: targetUuid,
        displayName: harness.user.displayName,
        angle: -37.5,
        distance: 18.25,
        skinUrl: skinPathForUser(harness.user),
      }],
    });
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
    expect(harness.gameConnections.begin(launchId, harness.admin.id)).toBe(true);

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
  it("requires the shared answer only for signup and accepts a one-character password", async () => {
    const harness = await createHarness();
    const registerResponse = await fetch(`${harness.origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ username: "짧은비번", password: "한", serverPassword: sharedServerPassword }),
    });
    expect(registerResponse.status).toBe(201);

    const loginResponse = await fetch(`${harness.origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ username: "짧은비번", password: "한" }),
    });
    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.json()).toMatchObject({ created: false });
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
        response.end(JSON.stringify({ tpaEnabled: true }));
        return;
      }
      if (request.method === "PUT" && request.url === "/v1/settings/tpa") {
        request.setEncoding("utf8");
        request.on("data", (chunk) => { updateBody += chunk; });
        request.on("end", () => response.end(JSON.stringify({ tpaEnabled: false })));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not_found" }));
    }));
    const harness = await createHarness({ bridgeOrigin });

    const overviewResponse = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    const overview = await overviewResponse.json() as { bridgeAvailable: boolean; players: unknown[]; tpaEnabled: boolean | null };
    expect(overviewResponse.status).toBe(200);
    expect(overview).toMatchObject({ bridgeAvailable: false, players: [], tpaEnabled: true });
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 2_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 2_000);
    timeoutSpy.mockClear();

    const missingCsrfResponse = await fetch(`${harness.origin}/api/admin/settings/tpa`, {
      method: "PUT",
      headers: { Cookie: harness.adminHeaders.Cookie, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ enabled: false }),
    });
    expect(missingCsrfResponse.status).toBe(403);

    const updateResponse = await fetch(`${harness.origin}/api/admin/settings/tpa`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ enabled: false }),
    });
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toEqual({ tpaEnabled: false });
    expect(JSON.parse(updateBody)).toEqual({ enabled: false });
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(4_000);

    const invalidResponse = await fetch(`${harness.origin}/api/admin/settings/tpa`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ enabled: "false" }),
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
    const harness = await createHarness({ bridgeOrigin });

    const overviewResponse = await fetch(`${harness.origin}/api/admin/overview`, { headers: harness.adminHeaders });
    const overview = await overviewResponse.json() as { bridgeAvailable: boolean; tpaEnabled: boolean | null };
    expect(overviewResponse.status).toBe(200);
    expect(overview).toMatchObject({ bridgeAvailable: true, tpaEnabled: null });

    const updateResponse = await fetch(`${harness.origin}/api/admin/settings/tpa`, {
      method: "PUT",
      headers: { ...harness.adminHeaders, "Content-Type": "application/json", Origin: harness.origin },
      body: JSON.stringify({ enabled: true }),
    });
    expect(updateResponse.status).toBe(503);
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

    const injected = await fetch(`${harness.origin}/api/admin/console`, {
      method: "POST",
      headers: { ...harness.adminHeaders, Origin: harness.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "say hello\nstop" }),
    });
    expect(injected.status).toBe(400);
    expect(consoleCommands).toEqual(["say 안녕하세요"]);
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
});
