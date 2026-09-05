import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import httpProxy from "http-proxy";
import { config } from "./config.js";
import { AppDatabase } from "./db.js";
import { createApiRouter } from "./api.js";
import {
  createGameTicket, gameProxyClientIp, isSameOriginHeaders, loadOrCreateSecret, sessionFromCookieHeader,
} from "./security.js";
import { MinecraftServerManager } from "./server-manager.js";
import { presetSkinFile, SkinService, skinPathForUser } from "./skins.js";
import { GameConnectionTracker, isLaunchId } from "./game-connections.js";
import { HistoryStore, type LegacyServerLogEntry } from "./history-store.js";
import { siteIndexForHostname } from "./site-index.js";
import { announceServerUpdateCountdown, FrontendReleaseMonitor } from "./deployment-notices.js";

fs.mkdirSync(config.dataDir, { recursive: true });
const sessionSecret = loadOrCreateSecret(config.dataDir, config.sessionSecret);
const database = new AppDatabase(config.dataDir);
const history = new HistoryStore(config.dataDir);
const skins = new SkinService(database, config.dataDir, config.assetRootDir);
const gameConnections = new GameConnectionTracker();
const serverManager = new MinecraftServerManager({
  minecraftVersion: config.minecraftVersion,
  sessionSecret,
  dataDir: config.dataDir,
  seedDir: config.seedDir,
  portalPort: config.port,
  bridgePort: config.bridgePort,
  javaBin: config.javaBin,
  memoryMb: config.memoryMb,
  idleMinutes: config.idleMinutes,
  startCooldownSeconds: config.startCooldownSeconds,
  maxPlayers: config.maxPlayers,
  eulaAccepted: config.eulaAccepted,
  mockServer: config.mockServer,
  onLog: (line, occurredAt) => history.recordServerLog(line, occurredAt),
});
const frontendReleaseMonitor = new FrontendReleaseMonitor(serverManager, config.frontendVersionUrl);

const app = express();
const gameDir = path.join(config.clientDir, "game");
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (request.path.startsWith("/game/")) {
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: blob: data:; worker-src 'self' blob:; media-src 'self' blob: data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    );
  } else {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  }
  next();
});

app.get("/healthz", (_request, response) => {
  response.json({ ok: true, server: serverManager.getStatus().phase });
});

// The backend runs without the frontend bundle in production, but the Bukkit
// plugin loads preset skins from this loopback-only origin during login.
app.get("/assets/skins/:file", (request, response) => {
  const skinFile = presetSkinFile(config.assetRootDir, request.params.file);
  if (!skinFile || !fs.existsSync(skinFile)) {
    response.status(404).end();
    return;
  }
  response.setHeader("Content-Type", "image/png");
  response.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  response.sendFile(skinFile);
});

app.use("/api", createApiRouter({
  database,
  skins,
  serverManager,
  sessionSecret,
  serverPassword: config.serverPassword,
  secureCookies: config.secureCookies,
  sessionDays: config.sessionDays,
  eulaAccepted: config.eulaAccepted || config.mockServer,
  gameConnections,
  history,
  adminUsernames: config.adminUsernames,
  adminUserIds: config.adminUserIds,
  adminPassword: config.adminPassword,
  bridgeOrigin: `http://127.0.0.1:${config.bridgePort}`,
  bridgeSecret: sessionSecret,
}));

function preferredEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) return null;
  if (/\bbr\b/i.test(acceptEncoding)) return "br";
  if (/\bgzip\b/i.test(acceptEncoding)) return "gzip";
  return null;
}

if (config.serveClient && config.minecraftVersion === "26.2") {
  const modernClientDir = path.resolve("work/minecraft-26/client-26.2");
  app.get("/game/stable.html", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(path.join(modernClientDir, "launch.html"));
  });
  app.get("/profile-26.2.js", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(path.resolve("experiments/minecraft-26/profile-26.2.js"));
  });
  app.use("/game", express.static(modernClientDir, { index: false, maxAge: "1h" }));
}

if (config.serveClient) {
  app.get("/game/:file", (request, response, next) => {
    const file = request.params.file;
    if (!/^classes-[0-9a-f]{16}\.wasm$/.test(file)) {
      next();
      return;
    }
    const encoding = preferredEncoding(request.headers["accept-encoding"]);
    if (!encoding) {
      next();
      return;
    }
    const extension = encoding === "br" ? "br" : "gz";
    const precompressed = path.join(gameDir, `${file}.${extension}`);
    if (!fs.existsSync(precompressed)) {
      next();
      return;
    }
    response.setHeader("Content-Encoding", encoding);
    response.setHeader("Content-Type", "application/wasm");
    response.setHeader("Vary", "Accept-Encoding");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.sendFile(precompressed, (error) => {
      if (error) next(error);
    });
  });

  app.get("/game/stable.html", (request, response, next) => {
    const version = request.query.v;
    if (typeof version !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(version)) {
      next();
      return;
    }
    const encoding = preferredEncoding(request.headers["accept-encoding"]);
    if (!encoding) {
      next();
      return;
    }
    const extension = encoding === "br" ? "br" : "gz";
    const precompressed = path.join(gameDir, `stable.html.${extension}`);
    if (!fs.existsSync(precompressed)) {
      next();
      return;
    }
    response.setHeader("Content-Encoding", encoding);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Vary", "Accept-Encoding");
    // The query value is a release label, not a content hash, so the small loader
    // HTML must revalidate. Its large EPW payload has a separate content-hashed URL.
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.sendFile(precompressed, (error) => {
      if (error) next(error);
    });
  });

  app.use("/game", express.static(gameDir, {
    fallthrough: false,
    index: false,
    maxAge: "1h",
    setHeaders(response, filePath) {
      if (filePath.endsWith(".html")) response.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
      if (/stable-[0-9a-f]{16}\.epw$/.test(filePath)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.setHeader("Content-Type", "application/octet-stream");
      }
      if (/classes-[0-9a-f]{16}\.wasm$/.test(filePath)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.setHeader("Content-Type", "application/wasm");
      }
    },
  }));

  app.get("/assets/:file", (request, response, next) => {
    const file = request.params.file;
    if (!/^[A-Za-z0-9_.-]+\.(?:css|js|json|svg)$/.test(file)) {
      next();
      return;
    }
    const encoding = preferredEncoding(request.headers["accept-encoding"]);
    if (!encoding) {
      next();
      return;
    }
    const extension = encoding === "br" ? "br" : "gz";
    const precompressed = path.join(config.clientDir, "assets", `${file}.${extension}`);
    if (!fs.existsSync(precompressed)) {
      next();
      return;
    }
    response.setHeader("Content-Encoding", encoding);
    response.setHeader("Content-Type", file.endsWith(".css") ? "text/css; charset=utf-8" : file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".json") ? "application/json; charset=utf-8" : "image/svg+xml");
    response.setHeader("Vary", "Accept-Encoding");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.sendFile(precompressed, (error) => {
      if (error) next(error);
    });
  });

  app.use(express.static(config.clientDir, {
    index: false,
    maxAge: "1h",
    setHeaders(response, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/") || request.path.startsWith("/gateway")) {
      next();
      return;
    }
    response.sendFile(path.join(config.clientDir, siteIndexForHostname(request.hostname)));
  });
}

const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({
  target: config.minecraftVersion === "26.2" ? "ws://127.0.0.1:25576" : "ws://127.0.0.1:25565",
  ws: true,
  xfwd: true,
  changeOrigin: false,
  proxyTimeout: 15_000,
});

proxy.on("error", (_error, _request, socket) => {
  if (socket && "destroy" in socket) socket.destroy();
});

server.on("upgrade", (request, socket, head) => {
  try {
    const parsed = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (parsed.pathname !== "/gateway") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!isSameOriginHeaders(request.headers.origin, request.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const session = sessionFromCookieHeader(request.headers.cookie, sessionSecret);
    const user = session ? database.getUserById(session.sub) : null;
    if (
      !session
      || !user
      || user.username.toLowerCase() !== session.username.toLowerCase()
      || user.sessionVersion !== (session.sessionVersion ?? 0)
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (serverManager.getStatus().phase !== "online") {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n\r\n");
      socket.destroy();
      return;
    }
    const launchId = parsed.searchParams.get("launch");
    const validLaunchId = isLaunchId(launchId) ? launchId : null;
    const closeTrackedConnection = validLaunchId
      ? gameConnections.begin(validLaunchId, user.id, () => socket.destroy())
      : null;
    if (!closeTrackedConnection) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const clientIp = gameProxyClientIp(
      request.headers["x-real-ip"],
      request.socket.remoteAddress,
    );
    let historySessionId: number | null = null;
    try {
      historySessionId = history.startGameConnection({
        launchId: validLaunchId!,
        accountId: user.id,
        accountUsername: user.username,
        gameUsername: user.gameUsername,
        displayName: user.displayName,
        ipAddress: clientIp,
      });
    } catch (error) {
      console.error("Could not record the game connection:", error);
    }
    let lastHistoryTouchAt = Date.now();
    socket.on("data", () => {
      if (historySessionId === null || Date.now() - lastHistoryTouchAt < 60_000) return;
      lastHistoryTouchAt = Date.now();
      try {
        history.touchGameConnection(historySessionId, lastHistoryTouchAt);
      } catch (error) {
        console.error("Could not update the game connection history:", error);
      }
    });
    socket.once("close", () => {
      closeTrackedConnection();
      if (historySessionId === null) return;
      try {
        history.endGameConnection(historySessionId);
      } catch (error) {
        console.error("Could not close the game connection history:", error);
      }
    });
    const ticket = createGameTicket(user, skinPathForUser(user), sessionSecret, config.gameTicketMinutes);
    parsed.searchParams.set("ticket", ticket);
    request.url = `${parsed.pathname}${parsed.search}`;
    delete request.headers.cookie;
    request.headers["x-real-ip"] = clientIp;
    proxy.ws(request, socket, head);
  } catch {
    socket.destroy();
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`spawnpoint is listening on port ${config.port}`);
  void importLegacyServerLogs();
  frontendReleaseMonitor.start();
});

function legacyLogTimestamp(source: string, line: string, fallback: number): number {
  const sourceDate = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const time = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
  if (!time) return fallback;
  const fallbackDate = new Date(fallback);
  const date = sourceDate
    ? sourceDate.slice(1).map(Number)
    : [fallbackDate.getFullYear(), fallbackDate.getMonth() + 1, fallbackDate.getDate()];
  const parsed = new Date(date[0], date[1] - 1, date[2], Number(time[1]), Number(time[2]), Number(time[3])).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function importLegacyServerLogs(): Promise<void> {
  if (!history.needsLegacyServerLogImport()) return;
  try {
    const imported: LegacyServerLogEntry[] = [];
    let offset = 0;
    while (true) {
      const page = await serverManager.getLogHistory({ offset, limit: 500 });
      const fallback = Date.now();
      imported.push(...page.entries.map((entry) => ({
        occurredAt: legacyLogTimestamp(entry.source, entry.line, fallback),
        source: entry.source,
        line: entry.line,
      })));
      if (page.nextOffset === null || page.nextOffset <= offset) break;
      offset = page.nextOffset;
    }
    imported.sort((left, right) => left.occurredAt - right.occurredAt);
    history.importLegacyServerLogs(imported);
    if (imported.length > 0) console.log(`Imported ${imported.length} existing Minecraft log lines into permanent history.`);
  } catch (error) {
    console.error("Could not import existing Minecraft logs:", error);
  }
}

let closing = false;
async function shutdown(announceUpdate = false): Promise<void> {
  if (closing) return;
  closing = true;
  frontendReleaseMonitor.stop();
  if (announceUpdate) {
    try {
      await announceServerUpdateCountdown(serverManager);
    } catch (error) {
      console.error("Could not finish the server update countdown:", error);
    }
  }
  await serverManager.shutdown();
  proxy.close();
  server.close(() => {
    history.close();
    database.close();
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on("SIGTERM", () => void shutdown(true));
process.on("SIGINT", () => void shutdown());
