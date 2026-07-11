import fs from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AppDatabase } from "./db.js";
import type { MinecraftServerManager } from "./server-manager.js";
import { GameConnectionTracker, isLaunchId } from "./game-connections.js";
import { ServerStartError } from "./server-manager.js";
import {
  clearSessionCookie,
  createGameTicket,
  createSessionToken,
  hashPassword,
  isSameOrigin,
  sessionFromRequest,
  setSessionCookie,
  validateCredentials,
  validateUsername,
  verifyPassword,
} from "./security.js";
import { SkinService, skinPathForUser, toPublicUser } from "./skins.js";
import type { UserRecord } from "./types.js";

interface ApiContext {
  database: AppDatabase;
  skins: SkinService;
  serverManager: MinecraftServerManager;
  sessionSecret: string;
  serverPassword: string;
  secureCookies: boolean;
  sessionDays: number;
  gameTicketMinutes: number;
  eulaAccepted: boolean;
  gameConnections: GameConnectionTracker;
}

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
}

function requestIp(request: Request): string {
  const cloudflare = request.headers["cf-connecting-ip"];
  if (typeof cloudflare === "string") return cloudflare;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return request.ip || request.socket.remoteAddress || "unknown";
}

function fail(response: Response, status: number, message: string, code = "REQUEST_FAILED"): void {
  response.status(status).json({ error: { code, message } });
}

function requireSameOrigin(request: Request, response: Response): boolean {
  if (isSameOrigin(request)) return true;
  fail(response, 403, "다른 출처에서 보낸 요청은 허용되지 않아요.", "BAD_ORIGIN");
  return false;
}

function userForRequest(request: Request, context: ApiContext): { user: UserRecord; csrf: string } | null {
  const session = sessionFromRequest(request, context.sessionSecret);
  if (!session?.csrf) return null;
  const user = context.database.getUserById(session.sub);
  if (!user || user.username.toLowerCase() !== session.username.toLowerCase()) return null;
  return { user, csrf: session.csrf };
}

function requireUser(request: Request, response: Response, context: ApiContext, csrf = false): UserRecord | null {
  const authenticated = userForRequest(request, context);
  if (!authenticated) {
    fail(response, 401, "먼저 로그인하세요.", "AUTH_REQUIRED");
    return null;
  }
  if (csrf && request.headers["x-spawnpoint-csrf"] !== authenticated.csrf) {
    fail(response, 403, "페이지를 새로고침한 뒤 다시 시도하세요.", "BAD_CSRF");
    return null;
  }
  return authenticated.user;
}

function requireServerPassword(request: Request, response: Response, context: ApiContext): boolean {
  if (!context.serverPassword) return true;
  const provided = typeof request.body?.serverPassword === "string" ? request.body.serverPassword : "";
  if (provided === context.serverPassword) return true;
  fail(response, 401, "서버 비밀번호가 올바르지 않아요.", "INVALID_SERVER_PASSWORD");
  return false;
}

export function createApiRouter(context: ApiContext): express.Router {
  const router = express.Router();
  const authLimiter = new MemoryRateLimiter(12, 10 * 60_000);
  const startLimiter = new MemoryRateLimiter(5, 10 * 60_000);
  const skinLimiter = new MemoryRateLimiter(20, 10 * 60_000);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024, files: 1, fields: 4 },
  });

  router.use(express.json({ limit: "32kb" }));
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/bootstrap", (request, response) => {
    const authenticated = userForRequest(request, context);
    response.json({
      user: authenticated ? toPublicUser(authenticated.user) : null,
      csrf: authenticated?.csrf ?? null,
      server: context.serverManager.getStatus(),
      clients: [
        { id: "stable", version: "1.12.2", label: "안정판", description: "학교 노트북에 가장 균형 잡힌 버전" },
      ],
      setup: { eulaAccepted: context.eulaAccepted },
    });
  });

  router.get("/server/status", (_request, response) => {
    response.json({ server: context.serverManager.getStatus() });
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
    if (!startLimiter.take(requestIp(request))) {
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

  router.post("/auth/lookup", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    try {
      const username = validateUsername(request.body?.username);
      response.json({ exists: Boolean(context.database.getUserByUsername(username)) });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "플레이어 ID를 확인할 수 없어요.", "INVALID_USERNAME");
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
      response.status(201).json({ user: toPublicUser(user), csrf: session.csrf });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "회원가입에 실패했어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/login", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    if (!requireServerPassword(request, response, context)) return;
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      const user = context.database.getUserByUsername(credentials.username);
      const valid = user ? await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash) : false;
      if (!user || !valid) {
        fail(response, 401, "플레이어 ID 또는 비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
        return;
      }
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: toPublicUser(user), csrf: session.csrf });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "로그인에 실패했어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/continue", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    if (!requireServerPassword(request, response, context)) return;
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      let user = context.database.getUserByUsername(credentials.username);

      if (user) {
        const valid = await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash);
        if (!valid) {
          fail(response, 401, "비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
          return;
        }
      } else {
        const password = await hashPassword(credentials.password);
        try {
          user = context.database.createUser(credentials.username, password.hash, password.salt);
        } catch {
          fail(response, 409, "플레이어 ID가 방금 등록됐어요. 다시 시도하세요.", "USERNAME_TAKEN");
          return;
        }
      }

      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: toPublicUser(user), csrf: session.csrf });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "계속할 수 없어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/logout", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!requireUser(request, response, context, true)) return;
    clearSessionCookie(response, context.secureCookies);
    response.status(204).end();
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
      response.json({ user: toPublicUser(updated) });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "스킨 업로드에 실패했어요.");
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
      response.json({ user: toPublicUser(updated) });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "스킨을 찾지 못했어요.");
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
      const [ticket, profile] = await Promise.all([
        Promise.resolve(createGameTicket(
          user,
          skinPathForUser(user),
          context.sessionSecret,
          context.gameTicketMinutes,
        )),
        context.skins.createClientProfile(user),
      ]);
      context.gameConnections.create(launchId, user.id);
      response.json({ ticket, username: user.username, profile });
    } catch (error) {
      fail(response, 500, error instanceof Error ? error.message : "저장된 프로필을 불러오지 못했어요.", "PROFILE_LOAD_FAILED");
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
