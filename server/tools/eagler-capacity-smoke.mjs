#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const clients = integerArgument("clients", 10, 1, 40);
const replacements = Math.min(clients, integerArgument("replacements", 1, 0, 8));
const holdSeconds = integerArgument("hold-seconds", 10, 0, 120);
const memoryMb = integerArgument("memory-mb", 512, 512, 2048);
const startupTimeoutMs = integerArgument("startup-timeout-seconds", 90, 15, 300) * 1000;
const workload = args.get("workload") ?? "idle";
const walkSeconds = integerArgument("walk-seconds", 20, 5, 120);
const sharedClientIp = args.get("client-ip") ?? "198.51.100.42";
const keepData = args.get("keep-data") === "true";
const projectRoot = path.resolve(import.meta.dirname, "../..");
const logs = [];
const CHUNK_WALK_INTERVAL_MS = 50;
const CHUNK_WALK_STEP_METERS = 0.2;
const SOCKET_BACKPRESSURE_BYTES = 64 * 1024;

if (!new Set(["idle", "chunk-walk"]).has(workload)) {
  throw new Error(`Unknown workload '${workload}', expected idle or chunk-walk`);
}

async function main() {
  const temporaryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "spawnpoint-capacity-"));
  const portalPort = await unusedPort();
  const bridgePort = await unusedPort();
  const origin = `http://127.0.0.1:${portalPort}`;
  const serverPassword = `capacity-${crypto.randomUUID()}`;
  const sessionSecret = `capacity-secret-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const adminPassword = `capacity-admin-${crypto.randomUUID()}`;
  let application = null;
  let sockets = [];

  try {
  await ensurePortAvailable(25565);
  application = spawn(process.execPath, [
    path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(projectRoot, "server", "index.ts"),
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATA_DIR: temporaryDataDir,
      PORT: String(portalPort),
      SERVE_CLIENT: "false",
      SESSION_SECRET: sessionSecret,
      SERVER_PASSWORD: serverPassword,
      SPAWNPOINT_ADMIN_PASSWORD: adminPassword,
      MC_EULA: "true",
      MC_IDLE_MINUTES: "120",
      MC_MAX_PLAYERS: String(Math.max(2, clients)),
      MC_MEMORY_MB: String(memoryMb),
      SPAWNPOINT_BRIDGE_PORT: String(bridgePort),
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  captureOutput(application.stdout, "stdout");
  captureOutput(application.stderr, "stderr");

  await waitFor(() => fetchJson(`${origin}/healthz`), {
    timeoutMs: 15_000,
    description: "portal HTTP listener",
    accept: (value) => value?.ok === true,
  });

  const accounts = [];
  for (let index = 0; index < clients + replacements; index += 1) {
    const username = `Load${String(index + 1).padStart(2, "0")}`;
    const response = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Forwarded-For": `203.0.113.${index + 1}`,
      },
      body: JSON.stringify({
        username,
        password: `capacity-password-${index + 1}`,
        serverPassword,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`register ${username} failed (${response.status}): ${JSON.stringify(body)}`);
    const cookie = response.headers.get("set-cookie")?.match(/spawnpoint_session=[^;]+/)?.[0];
    if (!cookie || typeof body.csrf !== "string" || typeof body.user?.username !== "string") {
      throw new Error(`register ${username} returned an incomplete session`);
    }
    accounts.push({ username: body.user.username, cookie, csrf: body.csrf });
  }

  const startedAt = performance.now();
  const startResponse = await apiRequest(origin, accounts[0], "/api/server/start", {});
  if (startResponse.response.status !== 202) {
    throw new Error(`server start failed (${startResponse.response.status}): ${JSON.stringify(startResponse.body)}`);
  }
  await waitFor(() => fetchJson(`${origin}/healthz`), {
    timeoutMs: startupTimeoutMs,
    description: "Paper and EaglerXServer readiness",
    accept: (value) => value?.server === "online",
  });
  const startupMs = Math.round(performance.now() - startedAt);

  const launched = await Promise.all(accounts.slice(0, clients).map((account) => issueGameLaunch(origin, account)));

  const attempts = await Promise.all(launched.map((account) => connectClient({
    url: `ws://127.0.0.1:${portalPort}/gateway?launch=${account.launchId}`,
    origin,
    account,
    clientIp: sharedClientIp,
    timeoutMs: 30_000,
  })));
  sockets = attempts.flatMap((attempt) => attempt.socket ? [attempt.socket] : []);

  const successful = attempts.filter((attempt) => attempt.state === "play");
  const playerSnapshot = await waitFor(
    () => fetchJson(`${origin}/api/server/players`, { headers: { Cookie: accounts[0].cookie } }),
    {
      timeoutMs: 15_000,
      description: `${successful.length} joined players in the portal status`,
      accept: (value) => Array.isArray(value?.players) && value.players.length === successful.length,
    },
  ).catch(() => ({ players: [] }));

  const admin = await unlockAdmin(origin, accounts[0], adminPassword);
  const resourceSamples = [];
  let chunkWalk = null;
  if (workload === "chunk-walk") {
    chunkWalk = await runChunkWalkWorkload({
      origin,
      admin,
      sessions: successful,
      applicationPid: application.pid,
      durationSeconds: walkSeconds,
      resourceSamples,
    });
  } else {
    for (let second = 0; second < holdSeconds; second += 1) {
      resourceSamples.push(await processTreeResourceUsage(application.pid));
      await delay(1_000);
    }
  }
  const tpsCommand = await fetch(`${origin}/api/admin/console`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: admin.cookie,
      "Content-Type": "application/json",
      "X-Spawnpoint-CSRF": admin.csrf,
    },
    body: JSON.stringify({ command: "tps" }),
  });
  if (!tpsCommand.ok) throw new Error(`TPS command failed with HTTP ${tpsCommand.status}`);
  const tpsLine = await waitFor(
    async () => logs.findLast(({ line }) => line.includes("TPS from last 1m"))?.line ?? null,
    { timeoutMs: 5_000, description: "Paper TPS result", accept: (value) => typeof value === "string" },
  ).catch(() => null);

  const disconnectedForReplacement = successful.slice(0, replacements);
  await Promise.all(disconnectedForReplacement.map(({ socket }) => closeSocket(socket)));
  if (disconnectedForReplacement.length > 0) {
    await waitFor(
      () => fetchJson(`${origin}/api/server/players`, { headers: { Cookie: accounts[0].cookie } }),
      {
        timeoutMs: 10_000,
        description: "departed players to leave the Paper player list",
        accept: (value) => Array.isArray(value?.players) && value.players.length === clients - disconnectedForReplacement.length,
      },
    );
  }
  const replacementAccounts = accounts.slice(clients, clients + disconnectedForReplacement.length);
  const replacementLaunches = await Promise.all(replacementAccounts.map((account) => issueGameLaunch(origin, account)));
  const replacementAttempts = await Promise.all(replacementLaunches.map((account) => connectClient({
    url: `ws://127.0.0.1:${portalPort}/gateway?launch=${account.launchId}`,
    origin,
    account,
    clientIp: sharedClientIp,
    timeoutMs: 30_000,
  })));
  sockets.push(...replacementAttempts.flatMap((attempt) => attempt.socket ? [attempt.socket] : []));
  const finalPlayerSnapshot = await waitFor(
    () => fetchJson(`${origin}/api/server/players`, { headers: { Cookie: accounts[0].cookie } }),
    {
      timeoutMs: 10_000,
      description: "replacement players to join the Paper player list",
      accept: (value) => Array.isArray(value?.players) && value.players.length === clients,
    },
  ).catch(() => ({ players: [] }));

  const capacityWarnings = logs
    .filter(({ line }) => /outofmemory|out of memory|java heap space|gc overhead|can'?t keep up|skipping \d+ tick|moved too quickly|moved wrongly/i.test(line))
    .map(({ line }) => line);
  const baseAcceptance = successful.length === clients
    && playerSnapshot.players.length === clients
    && replacementAttempts.every((attempt) => attempt.state === "play")
    && finalPlayerSnapshot.players.length === clients;
  const workloadAcceptance = workload === "idle" || (
    chunkWalk !== null
    && chunkWalk.teleportAcks === clients
    && chunkWalk.clientsWithMapChunkDelta === clients
    && chunkWalk.mapChunkPacketsDelta >= clients
    && chunkWalk.movementDeliveryRatio >= 0.9
    && chunkWalk.connectedClientsAtEnd === clients
    && capacityWarnings.length === 0
  );
  const result = {
    clients,
    workload,
    successful: successful.length,
    failed: attempts.length - successful.length,
    sharedClientIp,
    startupMs,
    portalPlayerCount: playerSnapshot.players.length,
    replacements,
    successfulReplacements: replacementAttempts.filter((attempt) => attempt.state === "play").length,
    finalPortalPlayerCount: finalPlayerSnapshot.players.length,
    handshakeMs: successful.map((attempt) => attempt.handshakeMs),
    p50HandshakeMs: percentile(successful.map((attempt) => attempt.handshakeMs), 0.5),
    p95HandshakeMs: percentile(successful.map((attempt) => attempt.handshakeMs), 0.95),
    tpsLine,
    peakJavaRssMb: maximum(resourceSamples.map((sample) => sample.javaRssMb)),
    averageJavaRssMb: average(resourceSamples.map((sample) => sample.javaRssMb)),
    peakJavaCpuPercent: maximum(resourceSamples.map((sample) => sample.javaCpuPercent)),
    averageJavaCpuPercent: average(resourceSamples.map((sample) => sample.javaCpuPercent)),
    peakProcessTreeRssMb: maximum(resourceSamples.map((sample) => sample.treeRssMb)),
    capacityWarnings,
    chunkWalk,
    acceptance: {
      basePassed: baseAcceptance,
      workloadPassed: workloadAcceptance,
      passed: baseAcceptance && workloadAcceptance,
    },
    failures: attempts.filter((attempt) => attempt.state !== "play").map(({ username, state, reason }) => ({
      username,
      state,
      reason,
    })),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.acceptance.passed) process.exitCode = 1;
  } finally {
    await Promise.allSettled(sockets.map((socket) => closeSocket(socket)));
    if (application && application.exitCode === null) {
      application.kill("SIGINT");
      await Promise.race([
        new Promise((resolve) => application.once("exit", resolve)),
        delay(30_000).then(() => application.kill("SIGKILL")),
      ]);
    }
    if (keepData) {
      process.stderr.write(`Kept capacity-test data at ${temporaryDataDir}\n`);
    } else {
      await fs.rm(temporaryDataDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

function integerArgument(name, fallback, minimum, maximum) {
  const value = Number.parseInt(args.get(name) ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function captureOutput(stream, source) {
  let partial = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    partial += chunk;
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? "";
    for (const line of lines) {
      logs.push({ source, line });
      if (/\b(?:ERROR|WARN)\b|rate.?limit|handshake|timed out|logged in with entity|joined the game|lost connection/i.test(line)) {
        process.stderr.write(`[server] ${line}\n`);
      }
    }
  });
}

async function apiRequest(baseUrl, account, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: account.cookie,
      "Content-Type": "application/json",
      "X-Spawnpoint-CSRF": account.csrf,
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function issueGameLaunch(baseUrl, account) {
  const launchId = crypto.randomUUID();
  const ticketResponse = await apiRequest(baseUrl, account, "/api/game-ticket", { launchId });
  if (!ticketResponse.response.ok) {
    throw new Error(`game ticket ${account.username} failed (${ticketResponse.response.status}): ${JSON.stringify(ticketResponse.body)}`);
  }
  return { ...account, launchId };
}

async function unlockAdmin(baseUrl, account, password) {
  const response = await fetch(`${baseUrl}/api/auth/admin-unlock`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: account.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const body = await response.json();
  const cookie = response.headers.get("set-cookie")?.match(/spawnpoint_admin=[^;]+/)?.[0];
  if (!response.ok || !cookie || typeof body.csrf !== "string") {
    throw new Error(`admin unlock failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return { cookie: `${account.cookie}; ${cookie}`, csrf: body.csrf };
}

async function sendAdminCommand(baseUrl, admin, command) {
  const response = await fetch(`${baseUrl}/api/admin/console`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      Cookie: admin.cookie,
      "Content-Type": "application/json",
      "X-Spawnpoint-CSRF": admin.csrf,
    },
    body: JSON.stringify({ command }),
  });
  if (!response.ok) throw new Error(`Console command '${command}' failed with HTTP ${response.status}`);
}

async function runChunkWalkWorkload({ origin, admin, sessions, applicationPid, durationSeconds, resourceSamples }) {
  await waitFor(
    async () => sessions.every((session) => session.connected && session.position !== null && session.teleportAcks > 0),
    { timeoutMs: 15_000, description: "initial player position acknowledgements", accept: Boolean },
  );
  await sendAdminCommand(origin, admin, "gamemode 3 @a");
  await delay(500);

  const baselines = new Map(sessions.map((session) => [session.username, {
    teleportAcks: session.teleportAcks,
    mapChunkPackets: session.mapChunkPackets,
    mapChunkBytes: session.mapChunkBytes,
  }]));
  const spreadStartedAt = performance.now();
  await sendAdminCommand(origin, admin, "spreadplayers 0 0 48 256 false @a");
  await waitFor(
    async () => sessions.every((session) => session.connected
      && session.teleportAcks > baselines.get(session.username).teleportAcks),
    { timeoutMs: 45_000, description: "spread-player position acknowledgements", accept: Boolean },
  );
  const spreadAckMs = Math.round(performance.now() - spreadStartedAt);

  const expectedMovementPackets = sessions.length * Math.floor(durationSeconds * 1000 / CHUNK_WALK_INTERVAL_MS);
  const movementTimer = setInterval(() => {
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      if (!session.connected || session.position === null || session.socket.readyState !== WebSocket.OPEN) continue;
      if (session.socket.bufferedAmount >= SOCKET_BACKPRESSURE_BYTES) {
        session.backpressureSkipped += 1;
        continue;
      }
      const angle = Math.abs(session.position.x) + Math.abs(session.position.z) > 1
        ? Math.atan2(session.position.z, session.position.x)
        : (Math.PI * 2 * index) / sessions.length;
      session.position.x += Math.cos(angle) * CHUNK_WALK_STEP_METERS;
      session.position.z += Math.sin(angle) * CHUNK_WALK_STEP_METERS;
      session.socket.send(playerPositionLookPacket(session.position));
      session.movementPacketsSent += 1;
    }
  }, CHUNK_WALK_INTERVAL_MS);
  try {
    for (let second = 0; second < durationSeconds; second += 1) {
      resourceSamples.push(await processTreeResourceUsage(applicationPid));
      await delay(1_000);
    }
  } finally {
    clearInterval(movementTimer);
  }

  const movementPacketsSent = sessions.reduce((total, session) => total + session.movementPacketsSent, 0);
  const backpressureSkipped = sessions.reduce((total, session) => total + session.backpressureSkipped, 0);
  const mapChunkPacketsDelta = sessions.reduce((total, session) => {
    return total + session.mapChunkPackets - baselines.get(session.username).mapChunkPackets;
  }, 0);
  const mapChunkBytesDelta = sessions.reduce((total, session) => {
    return total + session.mapChunkBytes - baselines.get(session.username).mapChunkBytes;
  }, 0);
  const clientsWithMapChunkDelta = sessions.filter((session) => {
    return session.mapChunkPackets > baselines.get(session.username).mapChunkPackets;
  }).length;
  return {
    durationSeconds,
    movementHz: 1000 / CHUNK_WALK_INTERVAL_MS,
    stepMeters: CHUNK_WALK_STEP_METERS,
    spreadCommand: "spreadplayers 0 0 48 256 false @a",
    spreadAckMs,
    teleportAcks: sessions.filter((session) => {
      return session.teleportAcks > baselines.get(session.username).teleportAcks;
    }).length,
    expectedMovementPackets,
    movementPacketsSent,
    movementDeliveryRatio: expectedMovementPackets === 0 ? 1 : rounded(movementPacketsSent / expectedMovementPackets),
    backpressureSkipped,
    connectedClientsAtEnd: sessions.filter((session) => session.connected).length,
    clientsWithMapChunkDelta,
    mapChunkPacketsDelta,
    mapChunkBytesDelta,
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function ensurePortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`TCP port ${port} is already in use`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitFor(operation, { timeoutMs, description, accept }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  const recentLogs = logs.slice(-30).map(({ source, line }) => `[${source}] ${line}`).join("\n");
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}\n${recentLogs}`);
}

function connectClient({ url, origin, account, clientIp, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const socket = new WebSocket(url, {
      headers: {
        Origin: origin,
        Cookie: account.cookie,
        "X-Real-IP": clientIp,
      },
      perMessageDeflate: true,
    });
    let settled = false;
    let play = false;
    let reason = "connection closed before the Eagler handshake finished";
    const session = {
      username: account.username,
      state: "connecting",
      reason,
      socket: null,
      handshakeMs: null,
      connected: false,
      position: null,
      teleportPackets: 0,
      teleportAcks: 0,
      mapChunkPackets: 0,
      mapChunkBytes: 0,
      unloadChunkPackets: 0,
      inboundBytes: 0,
      movementPacketsSent: 0,
      backpressureSkipped: 0,
    };
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.state = state;
      session.reason = reason;
      session.socket = state === "play" ? socket : null;
      session.handshakeMs = state === "play" ? Math.round(performance.now() - startedAt) : null;
      session.connected = state === "play";
      resolve(session);
      if (state !== "play") socket.close();
    };
    const timer = setTimeout(() => {
      reason = "30 second handshake timeout";
      finish("timeout");
    }, timeoutMs);

    socket.binaryType = "nodebuffer";
    socket.once("open", () => socket.send(clientVersionPacket(account.username)));
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        reason = "server sent a text WebSocket frame";
        finish("error");
        return;
      }
      const packet = Buffer.from(data);
      if (!play) {
        switch (packet[0]) {
          case 0x02:
            socket.send(loginRequestPacket(account.username));
            break;
          case 0x05:
            socket.send(Buffer.from([0x08]));
            break;
          case 0x09:
            play = true;
            finish("play");
            break;
          case 0x06:
          case 0xff:
            reason = handshakeError(packet);
            finish("rejected");
            break;
          default:
            reason = `unexpected handshake packet 0x${packet[0]?.toString(16) ?? "empty"}`;
            finish("error");
            break;
        }
        return;
      }
      handlePlayPacket(session, socket, packet);
    });
    socket.once("unexpected-response", (_request, response) => {
      reason = `WebSocket HTTP ${response.statusCode}`;
      finish("rejected");
    });
    socket.once("error", (error) => {
      reason = error.message;
      finish("error");
    });
    socket.once("close", (code, closeReason) => {
      session.connected = false;
      session.reason = `WebSocket closed (${code}${closeReason.length ? `: ${closeReason.toString()}` : ""})`;
      if (!settled) {
        reason = session.reason;
        finish("closed");
      }
    });
  });
}

function clientVersionPacket(username) {
  const brand = Buffer.from("spawnpoint-capacity", "ascii");
  const version = Buffer.from("u53", "ascii");
  const authUsername = Buffer.from(username, "ascii");
  return Buffer.concat([
    Buffer.from([0x01, 0x02]),
    unsignedShort(1),
    unsignedShort(4),
    unsignedShort(1),
    unsignedShort(340),
    Buffer.from([brand.length]), brand,
    Buffer.from([version.length]), version,
    Buffer.from([0x00, authUsername.length]), authUsername,
  ]);
}

function loginRequestPacket(username) {
  const encodedUsername = Buffer.from(username, "ascii");
  return Buffer.concat([
    Buffer.from([0x04, encodedUsername.length]),
    encodedUsername,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

function unsignedShort(value) {
  const result = Buffer.allocUnsafe(2);
  result.writeUInt16BE(value);
  return result;
}

function handshakeError(packet) {
  if (packet[0] === 0xff && packet.length >= 4) {
    if (packet[1] === 0x06 || packet[1] === 0x07) {
      const length = packet[2];
      return `server error ${packet[1]}: ${packet.subarray(3, 3 + length).toString("utf8")}`;
    }
    const length = packet.readUInt16BE(2);
    return `server error ${packet[1]}: ${packet.subarray(4, 4 + length).toString("utf8")}`;
  }
  if (packet[0] === 0x06 && packet.length >= 3) {
    const length = packet.readUInt16BE(1);
    return `login denied: ${packet.subarray(3, 3 + length).toString("utf8")}`;
  }
  return `handshake rejected with ${packet.toString("hex")}`;
}

function handlePlayPacket(session, socket, packet) {
  session.inboundBytes += packet.length;
  const id = readVarInt(packet, 0);
  if (!id) return;
  if (id.value === 0x1f && packet.length === id.bytes + 8) {
    socket.send(Buffer.concat([Buffer.from([0x0b]), packet.subarray(id.bytes)]));
    return;
  }
  if (id.value === 0x20) {
    session.mapChunkPackets += 1;
    session.mapChunkBytes += packet.length;
    return;
  }
  if (id.value === 0x1d) {
    session.unloadChunkPackets += 1;
    return;
  }
  if (id.value === 0x2f) acknowledgePlayerPosition(session, socket, packet, id.bytes);
}

export function acknowledgePlayerPosition(session, socket, packet, payloadOffset = readVarInt(packet, 0)?.bytes) {
  if (!Number.isInteger(payloadOffset) || packet.length < payloadOffset + 34) return false;
  let offset = payloadOffset;
  const next = {
    x: packet.readDoubleBE(offset),
    y: packet.readDoubleBE(offset + 8),
    z: packet.readDoubleBE(offset + 16),
    yaw: packet.readFloatBE(offset + 24),
    pitch: packet.readFloatBE(offset + 28),
  };
  offset += 32;
  const flags = packet[offset];
  offset += 1;
  const teleportId = readVarInt(packet, offset);
  if (!teleportId || offset + teleportId.bytes !== packet.length) return false;
  const previous = session.position ?? { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  if (flags & 0x01) next.x += previous.x;
  if (flags & 0x02) next.y += previous.y;
  if (flags & 0x04) next.z += previous.z;
  if (flags & 0x08) next.yaw += previous.yaw;
  if (flags & 0x10) next.pitch += previous.pitch;
  session.position = next;
  session.teleportPackets += 1;
  socket.send(Buffer.concat([Buffer.from([0x00]), writeVarInt(teleportId.value)]));
  session.teleportAcks += 1;
  return true;
}

export function playerPositionLookPacket(position, onGround = false) {
  const packet = Buffer.allocUnsafe(34);
  packet[0] = 0x0e;
  packet.writeDoubleBE(position.x, 1);
  packet.writeDoubleBE(position.y, 9);
  packet.writeDoubleBE(position.z, 17);
  packet.writeFloatBE(position.yaw, 25);
  packet.writeFloatBE(position.pitch, 29);
  packet[33] = onGround ? 1 : 0;
  return packet;
}

export function writeVarInt(value) {
  const bytes = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer, offset) {
  let value = 0;
  let position = 0;
  for (let index = offset; index < buffer.length && position < 35; index += 1, position += 7) {
    const byte = buffer[index];
    value |= (byte & 0x7f) << position;
    if ((byte & 0x80) === 0) return { value, bytes: index - offset + 1 };
  }
  return null;
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function maximum(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function average(values) {
  return values.length === 0 ? null : rounded(values.reduce((total, value) => total + value, 0) / values.length);
}

async function processTreeResourceUsage(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,comm="]);
  const rows = stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      cpuPercent: Number(match[4]),
      command: match[5],
    }];
  });
  const processIds = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!processIds.has(row.pid) && processIds.has(row.ppid)) {
        processIds.add(row.pid);
        changed = true;
      }
    }
  }
  const tree = rows.filter((row) => processIds.has(row.pid));
  const java = tree.filter((row) => /(?:^|\/)java$/.test(row.command));
  return {
    treeRssMb: rounded(tree.reduce((total, row) => total + row.rssKb, 0) / 1024),
    javaRssMb: rounded(java.reduce((total, row) => total + row.rssKb, 0) / 1024),
    javaCpuPercent: rounded(java.reduce((total, row) => total + row.cpuPercent, 0)),
  };
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, 2_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close(1000, "capacity test complete");
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
