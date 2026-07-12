import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import httpProxy from "http-proxy";
import { config } from "./config.js";
import { AppDatabase } from "./db.js";
import { createApiRouter } from "./api.js";
import { createGameTicket, isSameOriginHeaders, loadOrCreateSecret, sessionFromCookieHeader } from "./security.js";
import { MinecraftServerManager } from "./server-manager.js";
import { SkinService, skinPathForUser } from "./skins.js";
import { GameConnectionTracker, isLaunchId } from "./game-connections.js";

fs.mkdirSync(config.dataDir, { recursive: true });
const sessionSecret = loadOrCreateSecret(config.dataDir, config.sessionSecret);
const database = new AppDatabase(config.dataDir);
const skins = new SkinService(database, config.dataDir, config.clientDir);
const gameConnections = new GameConnectionTracker();
const serverManager = new MinecraftServerManager({
  dataDir: config.dataDir,
  seedDir: config.seedDir,
  javaBin: config.javaBin,
  memoryMb: config.memoryMb,
  idleMinutes: config.idleMinutes,
  startCooldownSeconds: config.startCooldownSeconds,
  maxPlayers: config.maxPlayers,
  eulaAccepted: config.eulaAccepted,
  mockServer: config.mockServer,
});

const app = express();
const gameDir = path.join(config.clientDir, "game");
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  }
  next();
});

app.get("/healthz", (_request, response) => {
  response.json({ ok: true, server: serverManager.getStatus().phase });
});

app.use("/api", createApiRouter({
  database,
  skins,
  serverManager,
  sessionSecret,
  serverPassword: config.serverPassword,
  secureCookies: config.secureCookies,
  sessionDays: config.sessionDays,
  gameTicketMinutes: config.gameTicketMinutes,
  eulaAccepted: config.eulaAccepted || config.mockServer,
  gameConnections,
}));

function preferredGameEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) return null;
  if (/\bbr\b/i.test(acceptEncoding)) return "br";
  if (/\bgzip\b/i.test(acceptEncoding)) return "gzip";
  return null;
}

app.get("/game/stable.html", (request, response, next) => {
  const version = request.query.v;
  if (typeof version !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(version)) {
    next();
    return;
  }
  const encoding = preferredGameEncoding(request.headers["accept-encoding"]);
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
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
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
  },
}));

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
  response.sendFile(path.join(config.clientDir, "index.html"));
});

const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({
  target: "ws://127.0.0.1:25565",
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
    if (!session || !user) {
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
    const tracked = isLaunchId(launchId) && gameConnections.begin(launchId, user.id);
    if (!tracked) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    socket.once("close", () => gameConnections.closed(launchId, user.id));
    const ticket = createGameTicket(user, skinPathForUser(user), sessionSecret, config.gameTicketMinutes);
    parsed.searchParams.set("ticket", ticket);
    request.url = `${parsed.pathname}${parsed.search}`;
    delete request.headers.cookie;
    request.headers["x-real-ip"] = request.socket.remoteAddress ?? "127.0.0.1";
    proxy.ws(request, socket, head);
  } catch {
    socket.destroy();
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`spawnpoint is listening on port ${config.port}`);
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await serverManager.shutdown();
  database.close();
  proxy.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
