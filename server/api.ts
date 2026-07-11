import fs from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AppDatabase } from "./db.js";
import type { MinecraftServerManager } from "./server-manager.js";
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
  verifyPassword,
} from "./security.js";
import { PRESET_SKINS, SkinService, skinPathForUser, toPublicUser } from "./skins.js";
import type { UserRecord } from "./types.js";

interface ApiContext {
  database: AppDatabase;
  skins: SkinService;
  serverManager: MinecraftServerManager;
  sessionSecret: string;
  secureCookies: boolean;
  sessionDays: number;
  gameTicketMinutes: number;
  eulaAccepted: boolean;
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
  fail(response, 403, "Cross-origin requests are not allowed.", "BAD_ORIGIN");
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
    fail(response, 401, "Log in first.", "AUTH_REQUIRED");
    return null;
  }
  if (csrf && request.headers["x-spawnpoint-csrf"] !== authenticated.csrf) {
    fail(response, 403, "Refresh the page and try again.", "BAD_CSRF");
    return null;
  }
  return authenticated.user;
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
      presets: PRESET_SKINS,
      clients: [
        { id: "stable", version: "1.12.2", label: "stable", description: "best balance for school laptops" },
        { id: "experimental", version: "1.21.11", label: "beta", description: "real modern port, still rough" },
        { id: "lite", version: "1.8.8", label: "lite", description: "fastest fallback" },
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
      fail(response, 429, "Too many start requests. Give it a few minutes.", "RATE_LIMITED");
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
      fail(response, 429, "Too many attempts. Try again later.", "RATE_LIMITED");
      return;
    }
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      if (context.database.getUserByUsername(credentials.username)) {
        fail(response, 409, "That player ID is already registered.", "USERNAME_TAKEN");
        return;
      }
      const password = await hashPassword(credentials.password);
      let user: UserRecord;
      try {
        user = context.database.createUser(credentials.username, password.hash, password.salt);
      } catch {
        fail(response, 409, "That player ID is already registered.", "USERNAME_TAKEN");
        return;
      }
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.status(201).json({ user: toPublicUser(user), csrf: session.csrf });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "Registration failed.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/login", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "Too many attempts. Try again later.", "RATE_LIMITED");
      return;
    }
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      const user = context.database.getUserByUsername(credentials.username);
      const valid = user ? await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash) : false;
      if (!user || !valid) {
        fail(response, 401, "Player ID or password is incorrect.", "INVALID_LOGIN");
        return;
      }
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: toPublicUser(user), csrf: session.csrf });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "Login failed.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/logout", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!requireUser(request, response, context, true)) return;
    clearSessionCookie(response, context.secureCookies);
    response.status(204).end();
  });

  router.post("/skin/preset", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    try {
      const updated = await context.skins.applyPreset(user, request.body?.preset);
      response.json({ user: toPublicUser(updated) });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "Skin could not be changed.");
    }
  });

  router.post("/skin/upload", upload.single("skin"), async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:upload`)) {
      fail(response, 429, "Too many skin updates. Try again in a few minutes.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyUpload(user, request.file, request.body?.model);
      response.json({ user: toPublicUser(updated) });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "Skin upload failed.");
    }
  });

  router.post("/skin/fetch", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:fetch`)) {
      fail(response, 429, "Too many skin lookups. Try again in a few minutes.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyMinecraftUsername(user, request.body?.username);
      response.json({ user: toPublicUser(updated) });
    } catch (error) {
      fail(response, 400, error instanceof Error ? error.message : "Skin lookup failed.");
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

  router.post("/game-ticket", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (context.serverManager.getStatus().phase !== "online") {
      fail(response, 409, "Start the server before launching the client.", "SERVER_OFFLINE");
      return;
    }
    const ticket = createGameTicket(
      user,
      skinPathForUser(user),
      context.sessionSecret,
      context.gameTicketMinutes,
    );
    response.json({ ticket, username: user.username });
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      fail(response, 400, error.code === "LIMIT_FILE_SIZE" ? "Skin PNG must be smaller than 256KB." : error.message);
      return;
    }
    console.error(error);
    fail(response, 500, "Something went wrong on the server.", "INTERNAL_ERROR");
  });

  return router;
}

