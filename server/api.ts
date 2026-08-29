import fs from "node:fs";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AppDatabase } from "./db.js";
import type { MinecraftServerManager } from "./server-manager.js";
import { GameConnectionTracker, isLaunchId } from "./game-connections.js";
import { ServerStartError } from "./server-manager.js";
import {
  adminFromRequest,
  clearAdminCookie,
  clearSessionCookie,
  createAdminToken,
  createPasswordResetCode,
  createSessionToken,
  hashPassword,
  isSameOrigin,
  sessionFromRequest,
  setAdminCookie,
  setSessionCookie,
  validateCredentials,
  validateDisplayName,
  validateNewPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifyPasswordResetCode,
} from "./security.js";
import { SKIN_CATALOG, SkinService, toPublicUser } from "./skins.js";
import type {
  AdminActor,
  AdminAuthorization,
  BridgeSettings,
  LocatorSnapshot,
  LocatorTargetDetails,
  PlayerDetails,
  PublicUser,
  UserAuthentication,
  UserRecord,
} from "./types.js";

export interface ApiContext {
  database: AppDatabase;
  skins: SkinService;
  serverManager: MinecraftServerManager;
  sessionSecret: string;
  serverPassword: string;
  secureCookies: boolean;
  sessionDays: number;
  eulaAccepted: boolean;
  gameConnections: GameConnectionTracker;
  adminUsernames?: readonly string[];
  adminUserIds?: readonly string[];
  adminPassword?: string;
  bridgeOrigin?: string;
  bridgeSecret?: string;
}

const PASSWORD_RESET_WINDOW_MS = 15 * 60_000;
const ADMIN_UNLOCK_MINUTES = 10;
const ADMIN_OVERVIEW_RATE_LIMIT = 1_200;
const ADMIN_OVERVIEW_RATE_WINDOW_MS = 10 * 60_000;
const STANDALONE_ADMIN = {
  id: "spawnpoint-standalone-admin",
  username: "admin",
  sessionVersion: 0,
} as const;

class MemoryRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  take(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    if (this.buckets.size > 5_000) {
      for (const [bucketKey, entries] of this.buckets) {
        if (entries.every((timestamp) => timestamp <= cutoff)) this.buckets.delete(bucketKey);
      }
    }
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

function fail(response: Response, status: number, message: string, code = "REQUEST_FAILED"): void {
  response.status(status).json({ error: { code, message } });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function failFromError(response: Response, status: number, error: unknown, fallback: string, code = "REQUEST_FAILED"): void {
  fail(response, status, errorMessage(error, fallback), code);
}

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function requireSameOrigin(request: Request, response: Response): boolean {
  if (isSameOrigin(request)) return true;
  fail(response, 403, "다른 출처에서 보낸 요청은 허용되지 않아요.", "BAD_ORIGIN");
  return false;
}

function userForRequest(request: Request, context: ApiContext): UserAuthentication | null {
  const session = sessionFromRequest(request, context.sessionSecret);
  if (!session?.csrf) return null;
  const user = context.database.getUserById(session.sub);
  if (
    !user
    || user.username.toLowerCase() !== session.username.toLowerCase()
    || user.sessionVersion !== (session.sessionVersion ?? 0)
  ) return null;
  const admin = adminFromRequest(request, context.sessionSecret);
  const adminExpiresAt = admin
    && admin.sub === user.id
    && admin.sessionVersion === user.sessionVersion
    ? admin.exp * 1_000
    : null;
  return { user, csrf: session.csrf, adminExpiresAt };
}

function standaloneAdminForRequest(request: Request, context: ApiContext): { user: AdminActor; csrf: string; adminExpiresAt: number } | null {
  const admin = adminFromRequest(request, context.sessionSecret);
  if (!admin?.csrf) return null;
  if (
    admin.sub === STANDALONE_ADMIN.id
    && admin.username === STANDALONE_ADMIN.username
    && (admin.sessionVersion ?? 0) === STANDALONE_ADMIN.sessionVersion
  ) {
    return { user: STANDALONE_ADMIN, csrf: admin.csrf, adminExpiresAt: admin.exp * 1_000 };
  }
  const user = context.database.getUserById(admin.sub);
  if (
    !user
    || user.username.toLowerCase() !== admin.username.toLowerCase()
    || user.sessionVersion !== (admin.sessionVersion ?? 0)
  ) return null;
  return { user, csrf: admin.csrf, adminExpiresAt: admin.exp * 1_000 };
}

function isAdmin(user: Pick<UserRecord, "id" | "username">, context: ApiContext): boolean {
  return isAdminId(user.id, context) || isAdminUsername(user.username, context);
}

function isAdminId(id: string, context: ApiContext): boolean {
  const normalized = id.toLowerCase();
  return (context.adminUserIds ?? []).some((candidate) => candidate.toLowerCase() === normalized);
}

function isAdminUsername(username: string, context: ApiContext): boolean {
  const normalized = username.toLowerCase();
  return (context.adminUsernames ?? []).some((candidate) => candidate.toLowerCase() === normalized);
}

function safeSecretEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function publicUser(user: UserRecord, context: ApiContext, adminExpiresAt: number | null = null): PublicUser {
  return {
    ...toPublicUser(user),
    displayName: user.displayName,
    isAdmin: isAdmin(user, context) || (adminExpiresAt !== null && adminExpiresAt > Date.now()),
  };
}

function standaloneAdminPublicUser() {
  return {
    id: STANDALONE_ADMIN.id,
    username: STANDALONE_ADMIN.username,
    displayName: "관리자",
    isAdmin: true,
    skin: {
      type: "preset" as const,
      model: "steve" as const,
      label: "spawnpoint",
      previewUrl: "/api/skins/preset/spawnpoint",
    },
  };
}

function hasActivePasswordReset(user: UserRecord, now = Date.now()): boolean {
  return user.passwordResetDigest !== null
    && user.passwordResetExpiresAt !== null
    && user.passwordResetExpiresAt > now;
}

function requireAuthentication(request: Request, response: Response, context: ApiContext, csrf = false): UserAuthentication | null {
  const authenticated = userForRequest(request, context);
  if (!authenticated) {
    fail(response, 401, "먼저 로그인하세요.", "AUTH_REQUIRED");
    return null;
  }
  if (csrf && !requireCsrf(request, response, authenticated.csrf)) return null;
  return authenticated;
}

function requireUser(request: Request, response: Response, context: ApiContext, csrf = false): UserRecord | null {
  return requireAuthentication(request, response, context, csrf)?.user ?? null;
}

function requireCsrf(request: Request, response: Response, csrf: string): boolean {
  if (request.headers["x-spawnpoint-csrf"] === csrf) return true;
  fail(response, 403, "페이지를 새로고침한 뒤 다시 시도하세요.", "BAD_CSRF");
  return false;
}

function requireAdmin(
  request: Request,
  response: Response,
  context: ApiContext,
  authenticated: UserAuthentication | null = userForRequest(request, context),
): AdminActor | null {
  const standaloneAdmin = authenticated ? null : standaloneAdminForRequest(request, context);
  const csrf = authenticated?.csrf ?? standaloneAdmin?.csrf;
  if (!csrf) {
    fail(response, 401, "관리자 인증이 필요해요.", "AUTH_REQUIRED");
    return null;
  }
  if (!requireCsrf(request, response, csrf)) return null;
  if (standaloneAdmin) return standaloneAdmin.user;
  if (!isAdmin(authenticated!.user, context) && !(authenticated!.adminExpiresAt && authenticated!.adminExpiresAt > Date.now())) {
    fail(response, 403, "관리자 권한이 필요해요.", "ADMIN_REQUIRED");
    return null;
  }
  return authenticated!.user;
}

function requireAdminMutation(
  request: Request,
  response: Response,
  context: ApiContext,
  limiter: MemoryRateLimiter,
): AdminAuthorization | null {
  if (!requireSameOrigin(request, response)) return null;
  const authenticated = userForRequest(request, context);
  const admin = requireAdmin(request, response, context, authenticated);
  if (!admin) return null;
  if (!limiter.take(`${admin.id}:mutation`)) {
    fail(response, 429, "관리자 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
    return null;
  }
  return { admin, authenticated };
}

function validatePlayerTarget(input: unknown): string {
  if (typeof input !== "string") throw new Error("플레이어를 선택하세요.");
  if (/^[A-Za-z0-9_]{3,16}$/.test(input) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
    return input;
  }
  throw new Error("플레이어 정보가 올바르지 않아요.");
}

function validateConsoleCommand(input: unknown): string {
  if (typeof input !== "string") throw new Error("콘솔 명령을 입력하세요.");
  const command = input.trim();
  if (!command || command.length > 256 || /[\r\n\0]/.test(command)) {
    throw new Error("콘솔 명령은 줄바꿈 없이 1~256자로 입력하세요.");
  }
  return command;
}

function validateGameChatMessage(input: unknown): string {
  if (typeof input !== "string") throw new Error("채팅 내용을 입력하세요.");
  const message = input.trim();
  if (!message || message.length > 256 || /[\r\n\0]/.test(message)) {
    throw new Error("채팅은 줄바꿈 없이 1~256자로 입력하세요.");
  }
  if (message === "/") throw new Error("명령어를 입력하세요.");
  return message;
}

async function bridgeRequest(context: ApiContext, pathname: string, init?: RequestInit, timeoutMs = 2_000): Promise<globalThis.Response> {
  if (!context.bridgeOrigin || !context.bridgeSecret) throw new Error("브리지 인증이 설정되지 않았어요.");
  let origin: URL;
  try {
    origin = new URL(context.bridgeOrigin);
  } catch {
    throw new Error("브리지 설정이 올바르지 않아요.");
  }
  if (origin.protocol !== "http:" || (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost")) {
    throw new Error("브리지는 로컬 주소만 사용할 수 있어요.");
  }
  const response = await fetch(new URL(pathname, origin), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${context.bridgeSecret}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`브리지가 ${response.status} 응답을 반환했어요.`);
  return response;
}

async function bridgePlayers(context: ApiContext): Promise<PlayerDetails[]> {
  const response = await bridgeRequest(context, "/v1/players");
  const body = await response.json() as { players?: PlayerDetails[] };
  if (!Array.isArray(body.players)) throw new Error("브리지의 플레이어 응답이 올바르지 않아요.");
  return body.players;
}

function isLocatorTarget(value: unknown): value is LocatorTargetDetails {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<LocatorTargetDetails>;
  return (target.accountId === null || typeof target.accountId === "string")
    && (target.skinUrl === null || (typeof target.skinUrl === "string"
      && (target.skinUrl.startsWith("/api/skins/") || target.skinUrl.startsWith("/assets/skins/"))
      && !target.skinUrl.includes("..")
      && !target.skinUrl.includes("\\")
      && !target.skinUrl.includes("#")))
    && typeof target.uuid === "string"
    && typeof target.username === "string"
    && typeof target.displayName === "string"
    && typeof target.angle === "number"
    && Number.isFinite(target.angle)
    && typeof target.distance === "number"
    && Number.isFinite(target.distance)
    && target.distance >= 0;
}

async function bridgeLocator(context: ApiContext, accountId: string): Promise<LocatorSnapshot> {
  const response = await bridgeRequest(context, `/v1/locator/${encodeURIComponent(accountId)}`, undefined, 1_000);
  const body = await response.json() as Partial<LocatorSnapshot>;
  if (typeof body.active !== "boolean" || !Array.isArray(body.targets) || !body.targets.every(isLocatorTarget)) {
    throw new Error("브리지의 위치 표시 응답이 올바르지 않아요.");
  }
  return { active: body.active, targets: body.targets };
}

async function bridgeSettings(context: ApiContext, init?: RequestInit, timeoutMs?: number): Promise<BridgeSettings> {
  const response = await bridgeRequest(context, init ? "/v1/settings/tpa" : "/v1/settings", init, timeoutMs);
  const body = await response.json() as Partial<BridgeSettings>;
  if (typeof body.tpaEnabled !== "boolean") throw new Error("브리지의 TPA 설정 응답이 올바르지 않아요.");
  return { tpaEnabled: body.tpaEnabled };
}

function requireServerPassword(request: Request, response: Response, context: ApiContext): boolean {
  if (!context.serverPassword) return true;
  const provided = typeof request.body?.serverPassword === "string" ? request.body.serverPassword : "";
  if (safeSecretEqual(provided, context.serverPassword)) return true;
  fail(response, 401, "서버 비밀번호가 올바르지 않아요.", "INVALID_SERVER_PASSWORD");
  return false;
}

export function createApiRouter(context: ApiContext): express.Router {
  const router = express.Router();
  const authLimiter = new MemoryRateLimiter(12, 10 * 60_000);
  const adminUnlockLimiter = new MemoryRateLimiter(6, 10 * 60_000);
  const passwordResetLimiter = new MemoryRateLimiter(8, PASSWORD_RESET_WINDOW_MS);
  const startLimiter = new MemoryRateLimiter(5, 10 * 60_000);
  const skinLimiter = new MemoryRateLimiter(20, 10 * 60_000);
  const accountLimiter = new MemoryRateLimiter(20, 10 * 60_000);
  const gameChatLimiter = new MemoryRateLimiter(8, 5_000);
  // Three tabs polling every two seconds use 900 requests per ten-minute window.
  const adminReadLimiter = new MemoryRateLimiter(ADMIN_OVERVIEW_RATE_LIMIT, ADMIN_OVERVIEW_RATE_WINDOW_MS);
  const adminLimiter = new MemoryRateLimiter(60, 10 * 60_000);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 256 * 1024,
      files: 1,
      fields: 4,
      fieldNestingDepth: 0,
    } as NonNullable<multer.Options["limits"]> & { fieldNestingDepth: number },
  });

  router.use(express.json({ limit: "32kb" }));
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/bootstrap", (request, response) => {
    const authenticated = userForRequest(request, context);
    response.json({
      user: authenticated ? publicUser(authenticated.user, context, authenticated.adminExpiresAt) : null,
      csrf: authenticated?.csrf ?? null,
      adminExpiresAt: authenticated?.adminExpiresAt ?? null,
      server: context.serverManager.getStatus(),
      clients: [
        { id: "stable", version: "1.12.2", label: "안정판", description: "학교 노트북에 가장 균형 잡힌 버전" },
      ],
      setup: { eulaAccepted: context.eulaAccepted },
    });
  });

  router.post("/auth/admin-unlock", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!context.adminPassword) {
      fail(response, 503, "관리자 비밀번호가 설정되지 않았어요.", "ADMIN_NOT_CONFIGURED");
      return;
    }
    const limiterKey = requestIp(request);
    if (!safeSecretEqual(request.body?.password, context.adminPassword)) {
      if (!adminUnlockLimiter.take(limiterKey)) {
        fail(response, 429, "관리자 인증 시도가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
        return;
      }
      fail(response, 401, "비밀번호가 올바르지 않아요.", "INVALID_ADMIN_PASSWORD");
      return;
    }
    adminUnlockLimiter.reset(limiterKey);
    const authenticated = userForRequest(request, context);
    const user = authenticated?.user ?? STANDALONE_ADMIN;
    const admin = createAdminToken(user, context.sessionSecret, ADMIN_UNLOCK_MINUTES);
    setAdminCookie(response, admin.token, ADMIN_UNLOCK_MINUTES, context.secureCookies);
    response.json({
      user: authenticated
        ? publicUser(authenticated.user, context, admin.expiresAt)
        : standaloneAdminPublicUser(),
      csrf: authenticated?.csrf ?? admin.csrf,
      adminExpiresAt: admin.expiresAt,
      standalone: !authenticated,
    });
  });

  router.post("/auth/admin-lock", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const authenticated = userForRequest(request, context);
    if (!authenticated) {
      fail(response, 401, "먼저 로그인하세요.", "AUTH_REQUIRED");
      return;
    }
    if (!requireCsrf(request, response, authenticated.csrf)) return;
    clearAdminCookie(response, context.secureCookies);
    response.json({ user: publicUser(authenticated.user, context), csrf: authenticated.csrf, adminExpiresAt: null });
  });

  router.get("/auth/username-availability", (request, response) => {
    try {
      const username = validateUsername(request.query.username);
      const user = context.database.getUserByUsername(username);
      response.json({
        available: user === null && !isAdminUsername(username, context),
        resetRequired: user ? hasActivePasswordReset(user) : false,
      });
    } catch (error) {
      failFromError(response, 400, error, "플레이어 ID를 확인할 수 없어요.", "INVALID_USERNAME");
    }
  });

  router.get("/server/status", (_request, response) => {
    response.json({ server: context.serverManager.getStatus() });
  });

  router.get("/server/players", (request, response) => {
    if (!requireUser(request, response, context)) return;
    const players = context.serverManager.getStatus().players.map((gameUsername) => {
      const user = context.database.getUserByGameUsername(gameUsername);
      return { gameUsername, displayName: user?.displayName ?? gameUsername };
    });
    response.json({ players });
  });

  router.get("/game/players", (request, response) => {
    const user = requireUser(request, response, context);
    if (!user) return;
    response.setHeader("Cache-Control", "no-store");
    const players = context.serverManager.getStatus().players.flatMap((gameUsername) => {
      if (gameUsername === user.gameUsername) return [];
      const playerUser = context.database.getUserByGameUsername(gameUsername);
      return [{ gameUsername, displayName: playerUser?.displayName ?? gameUsername }];
    });
    response.json({ players });
  });

  router.post("/game/chat", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context);
    if (!user) return;
    const launchId = request.body?.launchId;
    if (!isLaunchId(launchId)) {
      fail(response, 400, "클라이언트 실행 ID가 올바르지 않아요.", "BAD_LAUNCH_ID");
      return;
    }
    const connectionState = context.gameConnections.status(launchId, user.id);
    if (connectionState !== "connecting" && connectionState !== "connected") {
      fail(response, 409, "게임에 접속한 뒤 채팅을 보내세요.", "GAME_NOT_CONNECTED");
      return;
    }
    let message: string;
    try {
      message = validateGameChatMessage(request.body?.message);
    } catch (error) {
      failFromError(response, 400, error, "채팅 내용을 확인하세요.", "INVALID_CHAT");
      return;
    }
    if (!gameChatLimiter.take(user.id)) {
      fail(response, 429, "채팅을 너무 빠르게 보내고 있어요.", "RATE_LIMITED");
      return;
    }
    try {
      const bridgeResponse = await bridgeRequest(context, `/v1/chat/${encodeURIComponent(user.id)}`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      const result = await bridgeResponse.json() as { sent?: boolean; command?: boolean };
      if (result.sent !== true || typeof result.command !== "boolean") throw new Error("브리지의 채팅 응답이 올바르지 않아요.");
      response.json({ sent: true, command: result.command });
    } catch (error) {
      failFromError(response, 503, error, "채팅을 보내지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.get("/server/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    const send = () => response.write(`data: ${JSON.stringify(context.serverManager.getStatus())}\n\n`);
    const ping = setInterval(() => response.write(": ping\n\n"), 20_000);
    const statusListener = () => send();
    context.serverManager.on("status", statusListener);
    send();
    request.on("close", () => {
      clearInterval(ping);
      context.serverManager.off("status", statusListener);
    });
  });

  router.post("/server/start", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!startLimiter.take(user.id)) {
      fail(response, 429, "서버 시작 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const server = await context.serverManager.start();
      response.status(202).json({ server });
    } catch (error) {
      if (error instanceof ServerStartError) {
        const status = error.code === "EULA_REQUIRED" ? 412 : error.code === "COOLDOWN" ? 429 : 503;
        fail(response, status, error.message, error.code);
        return;
      }
      throw error;
    }
  });

  router.post("/auth/register", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    if (!requireServerPassword(request, response, context)) return;
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      validateNewPassword(credentials.password);
      if (isAdminUsername(credentials.username, context) && !context.database.getUserByUsername(credentials.username)) {
        fail(response, 403, "관리자용 플레이어 ID는 새로 등록할 수 없어요.", "RESERVED_USERNAME");
        return;
      }
      if (context.database.getUserByUsername(credentials.username)) {
        fail(response, 409, "이미 등록된 플레이어 ID예요.", "USERNAME_TAKEN");
        return;
      }
      const password = await hashPassword(credentials.password);
      let user: UserRecord;
      try {
        user = context.database.createUser(credentials.username, password.hash, password.salt);
      } catch {
        fail(response, 409, "이미 등록된 플레이어 ID예요.", "USERNAME_TAKEN");
        return;
      }
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.status(201).json({ user: publicUser(user, context), csrf: session.csrf, created: true });
    } catch (error) {
      failFromError(response, 400, error, "회원가입에 실패했어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/login", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      const user = context.database.getUserByUsername(credentials.username);
      if (user && hasActivePasswordReset(user)) {
        fail(response, 409, "새 비밀번호를 설정해 로그인하세요.", "PASSWORD_RESET_REQUIRED");
        return;
      }
      if (user && (user.passwordResetDigest !== null || user.passwordResetExpiresAt !== null)) {
        context.database.clearPasswordReset(user.id);
      }
      const valid = user ? await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash) : false;
      if (!user || !valid) {
        fail(response, 401, "플레이어 ID 또는 비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
        return;
      }
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: publicUser(user, context), csrf: session.csrf, created: false });
    } catch (error) {
      failFromError(response, 400, error, "로그인에 실패했어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/continue", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      let user = context.database.getUserByUsername(credentials.username);
      let created = false;

      if (user && hasActivePasswordReset(user)) {
        validateNewPassword(credentials.password);
        const resetDigest = user.passwordResetDigest!;
        if (!passwordResetLimiter.take(resetDigest.toString("base64url"))) {
          fail(response, 429, "초기화 코드 확인 요청이 너무 많아요. 새 코드를 발급하세요.", "RATE_LIMITED");
          return;
        }
        if (!verifyPasswordResetCode(request.body?.serverPassword, context.sessionSecret, resetDigest)) {
          fail(response, 401, "플레이어 ID 또는 인증 정보가 올바르지 않아요.", "INVALID_LOGIN");
          return;
        }
        const password = await hashPassword(credentials.password);
        user = context.database.completePasswordReset(
          user.id,
          resetDigest,
          password.hash,
          password.salt,
          Date.now(),
        );
        if (!user) {
          fail(response, 401, "플레이어 ID 또는 인증 정보가 올바르지 않아요.", "INVALID_LOGIN");
          return;
        }
      } else {
        if (user && (user.passwordResetDigest !== null || user.passwordResetExpiresAt !== null)) {
          context.database.clearPasswordReset(user.id);
        }
        if (!requireServerPassword(request, response, context)) return;
        if (user) {
          const valid = await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash);
          if (!valid) {
            fail(response, 401, "비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
            return;
          }
        } else {
          if (isAdminUsername(credentials.username, context)) {
            fail(response, 403, "관리자용 플레이어 ID는 새로 등록할 수 없어요.", "RESERVED_USERNAME");
            return;
          }
          const password = await hashPassword(validateNewPassword(credentials.password));
          try {
            user = context.database.createUser(credentials.username, password.hash, password.salt);
            created = true;
          } catch {
            fail(response, 409, "플레이어 ID가 방금 등록됐어요. 다시 시도하세요.", "USERNAME_TAKEN");
            return;
          }
        }
      }

      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: publicUser(user, context), csrf: session.csrf, created });
    } catch (error) {
      failFromError(response, 400, error, "계속할 수 없어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/logout", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!requireUser(request, response, context, true)) return;
    clearSessionCookie(response, context.secureCookies);
    clearAdminCookie(response, context.secureCookies);
    response.status(204).end();
  });

  router.patch("/account/profile", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const authenticated = requireAuthentication(request, response, context, true);
    if (!authenticated) return;
    const { user } = authenticated;
    if (!accountLimiter.take(`${user.id}:profile`)) {
      fail(response, 429, "계정 변경 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const username = request.body?.username === undefined ? user.username : validateUsername(request.body.username);
      const displayName = request.body?.displayName === undefined ? user.displayName : validateDisplayName(request.body.displayName);
      if (isAdmin(user, context) && !isAdminId(user.id, context) && !isAdminUsername(username, context)) {
        fail(response, 400, "관리자 플레이어 ID는 서버 설정과 함께 변경해야 해요.", "ADMIN_USERNAME_FIXED");
        return;
      }
      if (isAdminUsername(username, context) && !isAdmin(user, context)) {
        fail(response, 403, "관리자용 플레이어 ID로 변경할 수 없어요.", "RESERVED_USERNAME");
        return;
      }
      const owner = context.database.getUserByUsername(username);
      if (owner && owner.id !== user.id) {
        fail(response, 409, "이미 등록된 플레이어 ID예요.", "USERNAME_TAKEN");
        return;
      }
      const updated = context.database.updateIdentity(user.id, username, displayName);
      const session = createSessionToken(updated, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({
        user: publicUser(updated, context, authenticated.adminExpiresAt),
        csrf: session.csrf,
        adminExpiresAt: authenticated.adminExpiresAt,
      });
    } catch (error) {
      failFromError(response, 400, error, "계정 정보를 변경하지 못했어요.", "INVALID_PROFILE");
    }
  });

  router.post("/account/password", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!accountLimiter.take(`${user.id}:password`)) {
      fail(response, 429, "비밀번호 변경 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const currentPassword = validatePassword(request.body?.currentPassword);
      const newPassword = validateNewPassword(request.body?.newPassword);
      if (!await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
        fail(response, 401, "현재 비밀번호가 올바르지 않아요.", "INVALID_CURRENT_PASSWORD");
        return;
      }
      const password = await hashPassword(newPassword);
      const updated = context.database.updatePassword(user.id, password.hash, password.salt);
      const session = createSessionToken(updated, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      clearAdminCookie(response, context.secureCookies);
      response.json({ user: publicUser(updated, context), csrf: session.csrf, adminExpiresAt: null });
    } catch (error) {
      failFromError(response, 400, error, "비밀번호를 변경하지 못했어요.", "INVALID_PASSWORD");
    }
  });

  router.get("/skin/catalog", (_request, response) => {
    response.json({ categories: SKIN_CATALOG });
  });

  router.get("/skin/catalog/:skinId.png", async (request, response) => {
    const texture = context.skins.catalogTexture(request.params.skinId);
    if (!texture) {
      response.status(404).end();
      return;
    }
    try {
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      response.send(await texture);
    } catch {
      fail(response, 502, "스킨 텍스처를 불러오지 못했어요.", "SKIN_TEXTURE_UNAVAILABLE");
    }
  });

  router.post("/skin/upload", upload.single("skin"), async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:upload`)) {
      fail(response, 429, "스킨 변경 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyUpload(user, request.file);
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "스킨 업로드에 실패했어요.");
    }
  });

  router.post("/skin/fetch", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:fetch`)) {
      fail(response, 429, "스킨 검색 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyMinecraftUsername(user, request.body?.username);
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "스킨을 찾지 못했어요.");
    }
  });

  router.post("/skin/catalog", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:catalog`)) {
      fail(response, 429, "스킨 변경 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyCatalogSkin(user, request.body?.skinId);
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "스킨을 적용하지 못했어요.");
    }
  });

  router.get("/skins/:id.png", (request, response) => {
    const skinFile = context.skins.skinFile(request.params.id);
    if (!skinFile || !fs.existsSync(skinFile)) {
      response.status(404).end();
      return;
    }
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    response.sendFile(skinFile);
  });

  router.get("/game/locator", async (request, response) => {
    const user = requireUser(request, response, context);
    if (!user) return;
    response.setHeader("Cache-Control", "no-store");
    if (context.serverManager.getStatus().phase !== "online") {
      response.json({ active: false, targets: [] });
      return;
    }
    try {
      const locator = await bridgeLocator(context, user.id);
      const targets = locator.targets.flatMap((target) => {
        if (!target.accountId || !target.skinUrl) return [];
        return [{
          id: target.uuid,
          displayName: target.displayName,
          angle: target.angle,
          distance: target.distance,
          skinUrl: target.skinUrl,
        }];
      });
      response.json({ active: locator.active, targets });
    } catch (error) {
      failFromError(response, 503, error, "위치 표시 정보를 불러오지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.get("/admin/overview", async (request, response) => {
    const admin = requireAdmin(request, response, context);
    if (!admin) return;
    if (!adminReadLimiter.take(`${admin.id}:overview`)) {
      fail(response, 429, "관리자 새로고침 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const [playersResult, settingsResult] = await Promise.allSettled([
        bridgePlayers(context),
        bridgeSettings(context),
      ]);
      const players = playersResult.status === "fulfilled" ? playersResult.value : [];
      const bridgeAvailable = playersResult.status === "fulfilled";
      const tpaEnabled = settingsResult.status === "fulfilled" ? settingsResult.value.tpaEnabled : null;
      response.json({
        users: context.database.listUsers().map((user) => ({
          ...user,
          resetRequired: user.passwordResetPending
            && user.passwordResetExpiresAt !== null
            && user.passwordResetExpiresAt > Date.now(),
          isAdmin: isAdminId(user.id, context) || isAdminUsername(user.username, context),
        })),
        players,
        bridgeAvailable,
        tpaEnabled,
        logs: context.serverManager.getRecentLogs(200),
        server: context.serverManager.getStatus(),
      });
    } catch (error) {
      failFromError(response, 500, error, "관리자 정보를 불러오지 못했어요.", "ADMIN_OVERVIEW_FAILED");
    }
  });

  router.put("/admin/settings/tpa", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    if (typeof request.body?.enabled !== "boolean") {
      fail(response, 400, "TPA 설정 값이 올바르지 않아요.", "INVALID_TPA_SETTING");
      return;
    }
    try {
      const settings = await bridgeSettings(context, {
        method: "PUT",
        body: JSON.stringify({ enabled: request.body.enabled }),
      }, 4_000);
      response.json(settings);
    } catch (error) {
      failFromError(response, 503, error, "TPA 설정을 변경하지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.post("/admin/console", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    let command: string;
    try {
      command = validateConsoleCommand(request.body?.command);
    } catch (error) {
      failFromError(response, 400, error, "콘솔 명령을 확인하세요.", "INVALID_CONSOLE_COMMAND");
      return;
    }
    try {
      await context.serverManager.sendCommand(command);
      response.status(204).end();
    } catch (error) {
      failFromError(response, 409, error, "콘솔 명령을 실행하지 못했어요.", "CONSOLE_UNAVAILABLE");
    }
  });

  router.patch("/admin/users/:id/profile", (request, response) => {
    const authorization = requireAdminMutation(request, response, context, adminLimiter);
    if (!authorization) return;
    const { admin, authenticated } = authorization;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    try {
      const username = request.body?.username === undefined ? target.username : validateUsername(request.body.username);
      const displayName = request.body?.displayName === undefined ? target.displayName : validateDisplayName(request.body.displayName);
      if (target.id === admin.id && isAdmin(admin, context) && !isAdminId(admin.id, context) && !isAdminUsername(username, context)) {
        fail(response, 400, "관리자 플레이어 ID는 서버 설정과 함께 변경해야 해요.", "ADMIN_USERNAME_FIXED");
        return;
      }
      if (isAdminUsername(username, context) && !isAdmin(target, context)) {
        fail(response, 403, "관리자용 플레이어 ID로 변경할 수 없어요.", "RESERVED_USERNAME");
        return;
      }
      const owner = context.database.getUserByUsername(username);
      if (owner && owner.id !== target.id) {
        fail(response, 409, "이미 등록된 플레이어 ID예요.", "USERNAME_TAKEN");
        return;
      }
      const updated = context.database.updateIdentity(target.id, username, displayName);
      if (updated.id === admin.id) {
        if (authenticated) {
          const session = createSessionToken(updated, context.sessionSecret, context.sessionDays);
          setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
          response.json({
            user: publicUser(updated, context, authenticated.adminExpiresAt),
            csrf: session.csrf,
            adminExpiresAt: authenticated.adminExpiresAt,
          });
        } else {
          const standaloneAdmin = createAdminToken(updated, context.sessionSecret, ADMIN_UNLOCK_MINUTES);
          setAdminCookie(response, standaloneAdmin.token, ADMIN_UNLOCK_MINUTES, context.secureCookies);
          response.json({
            user: publicUser(updated, context, standaloneAdmin.expiresAt),
            csrf: standaloneAdmin.csrf,
            adminExpiresAt: standaloneAdmin.expiresAt,
          });
        }
        return;
      }
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "사용자 정보를 변경하지 못했어요.", "INVALID_PROFILE");
    }
  });

  router.post("/admin/users/:id/password-reset", async (request, response) => {
    const authorization = requireAdminMutation(request, response, context, adminLimiter);
    if (!authorization) return;
    const { admin } = authorization;
    if (admin.id === request.params.id) {
      fail(response, 400, "내 비밀번호는 계정 설정에서 변경하세요.", "SELF_RESET_NOT_ALLOWED");
      return;
    }
    if (!context.database.getUserById(request.params.id)) {
      fail(response, 404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    const reset = createPasswordResetCode(context.sessionSecret);
    const updated = context.database.requestPasswordReset(
      request.params.id,
      reset.digest,
      Date.now() + PASSWORD_RESET_WINDOW_MS,
    );
    context.gameConnections.disconnectUser(updated.id);
    try {
      await bridgeRequest(context, `/v1/players/${encodeURIComponent(updated.id)}/disconnect`, { method: "POST" });
    } catch {
      // Reset issuance and web-session revocation must succeed while Minecraft is asleep or unavailable.
    }
    response.json({
      resetCode: reset.code,
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        passwordResetExpiresAt: updated.passwordResetExpiresAt,
        resetRequired: true,
      },
    });
  });

  router.put("/admin/players/:player/operator", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    let player: string;
    try {
      player = validatePlayerTarget(request.params.player);
      if (typeof request.body?.operator !== "boolean") throw new Error("OP 상태를 선택하세요.");
    } catch (error) {
      failFromError(response, 400, error, "OP 상태를 확인하세요.", "INVALID_OPERATOR_REQUEST");
      return;
    }
    try {
      await bridgeRequest(context, `/v1/players/${encodeURIComponent(player)}/operator`, {
        method: "PUT",
        body: JSON.stringify({ operator: request.body.operator }),
      });
      response.status(204).end();
    } catch (error) {
      failFromError(response, 503, error, "OP 상태를 변경하지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.post("/game-ticket", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (context.serverManager.getStatus().phase !== "online") {
      fail(response, 409, "클라이언트를 실행하기 전에 서버를 시작하세요.", "SERVER_OFFLINE");
      return;
    }
    const launchId = request.body?.launchId;
    if (!isLaunchId(launchId)) {
      fail(response, 400, "클라이언트 실행 ID가 올바르지 않아요.", "BAD_LAUNCH_ID");
      return;
    }
    try {
      const profile = await context.skins.createClientProfile(user);
      context.gameConnections.create(launchId, user.id);
      response.json({ username: user.gameUsername, displayName: user.displayName, profile });
    } catch (error) {
      failFromError(response, 500, error, "저장된 프로필을 불러오지 못했어요.", "PROFILE_LOAD_FAILED");
    }
  });

  router.get("/game-connection/:launchId", (request, response) => {
    const user = requireUser(request, response, context);
    if (!user) return;
    const { launchId } = request.params;
    if (!isLaunchId(launchId)) {
      fail(response, 400, "클라이언트 실행 ID가 올바르지 않아요.", "BAD_LAUNCH_ID");
      return;
    }
    const state = context.gameConnections.status(launchId, user.id);
    if (!state) {
      fail(response, 404, "클라이언트 실행 정보를 찾지 못했어요.", "LAUNCH_NOT_FOUND");
      return;
    }
    response.json({ state });
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      fail(response, 400, error.code === "LIMIT_FILE_SIZE" ? "스킨 PNG는 256KB보다 작아야 해요." : error.message);
      return;
    }
    console.error(error);
    fail(response, 500, "서버에서 문제가 발생했어요.", "INTERNAL_ERROR");
  });

  return router;
}
