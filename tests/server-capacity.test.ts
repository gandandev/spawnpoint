import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ServerSettingsStore } from "../server/server-settings.js";
import {
  acknowledgePlayerPosition,
  playerPositionLookPacket,
  writeVarInt,
} from "../server/tools/eagler-capacity-smoke.mjs";

const seed = path.join(process.cwd(), "server-runtime", "seed");

describe("authenticated Eagler capacity settings", () => {
  it("does not collapse simultaneous players behind one public IP", () => {
    const listener = fs.readFileSync(
      path.join(seed, "plugins", "EaglercraftXServer", "listener.yml"),
      "utf8",
    );
    const settings = fs.readFileSync(
      path.join(seed, "plugins", "EaglercraftXServer", "settings.yml"),
      "utf8",
    );
    const bukkit = fs.readFileSync(path.join(seed, "bukkit.yml"), "utf8");

    expect(listener).toMatch(/^forward_ip: true$/m);
    expect(listener).toMatch(/^forward_ip_header: X-Real-IP$/m);
    expect(listener).toMatch(/^  ip:\n    enable: true\n    period: 90\n    limit: 60\n    limit_lockout: 80\n    lockout_duration: 300$/m);
    expect(listener).toMatch(/^  login:\n    enable: false$/m);
    expect(settings).toMatch(/^eagler_login_timeout: 30000$/m);
    expect(bukkit).toMatch(/^  connection-throttle: -1$/m);
  });

  it("keeps the Eagler listener private and deploys both managed configs on every start", () => {
    const properties = fs.readFileSync(path.join(seed, "server.properties"), "utf8");
    const manager = fs.readFileSync(path.join(process.cwd(), "server", "server-manager.ts"), "utf8");

    expect(properties).toMatch(/^server-ip=127\.0\.0\.1$/m);
    expect(manager).toContain('"bukkit.yml"');
    expect(manager).toContain('"plugins/EaglerXServer.jar"');
    expect(manager).toContain('"plugins/EaglercraftXServer/listener.yml"');
    expect(manager).toContain('"plugins/EaglercraftXServer/settings.yml"');
  });

  it("uses 16 players and 512 MB for new deployments", () => {
    const properties = fs.readFileSync(path.join(seed, "server.properties"), "utf8");
    const config = fs.readFileSync(path.join(process.cwd(), "server", "config.ts"), "utf8");
    const backendDockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile.backend"), "utf8");
    const combinedDockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    const exampleEnvironment = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");

    expect(properties).toMatch(/^max-players=16$/m);
    expect(config).toContain('integerEnv("MC_MEMORY_MB", 512, 512, 2_048)');
    expect(config).toContain('integerEnv("MC_MAX_PLAYERS", 16, 2, 40)');
    for (const dockerfile of [backendDockerfile, combinedDockerfile]) {
      expect(dockerfile).toMatch(/^    MC_MEMORY_MB=512 \\$/m);
      expect(dockerfile).toMatch(/^    MC_MAX_PLAYERS=16 \\$/m);
    }
    expect(exampleEnvironment).toMatch(/^MC_MEMORY_MB=512$/m);
    expect(exampleEnvironment).toMatch(/^MC_MAX_PLAYERS=16$/m);
  });

  it("preserves an existing volume's explicit maximum player setting", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-capacity-setting-"));
    const seedDir = path.join(root, "seed");
    const minecraftDir = path.join(root, "minecraft");
    try {
      fs.mkdirSync(seedDir, { recursive: true });
      fs.mkdirSync(minecraftDir, { recursive: true });
      fs.writeFileSync(path.join(seedDir, "server.properties"), "max-players=16\n", "utf8");
      fs.writeFileSync(path.join(minecraftDir, "server.properties"), "max-players=20\n", "utf8");

      const settings = await new ServerSettingsStore(minecraftDir, seedDir, 16).read();

      expect(settings.maxPlayers).toBe(20);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps idle as the default and offers an opt-in cold chunk walk", () => {
    const smoke = fs.readFileSync(
      path.join(process.cwd(), "server", "tools", "eagler-capacity-smoke.mjs"),
      "utf8",
    );

    expect(smoke).toContain('const workload = args.get("workload") ?? "idle"');
    expect(smoke).toContain('sendAdminCommand(origin, admin, "gamemode 3 @a")');
    expect(smoke).toContain('sendAdminCommand(origin, admin, "spreadplayers 0 0 48 256 false @a")');
    expect(smoke).toContain("const CHUNK_WALK_INTERVAL_MS = 50");
    expect(smoke).toContain("session.socket.bufferedAmount >= SOCKET_BACKPRESSURE_BYTES");
    expect(smoke).toContain("chunkWalk.clientsWithMapChunkDelta === clients");
    expect(smoke).toContain("chunkWalk.mapChunkPacketsDelta >= clients");
    expect(smoke).toContain("chunkWalk.connectedClientsAtEnd === clients");
    expect(smoke).toContain("capacityWarnings.length === 0");
  });

  it("acknowledges an absolute 1.12.2 player-position packet", () => {
    const packet = playerPositionPacket({ x: 12.5, y: 70, z: -8.25, yaw: 90, pitch: -10 }, 0, 300);
    const socket = { send: vi.fn() };
    const session = capacitySession();

    expect(acknowledgePlayerPosition(session, socket, packet)).toBe(true);
    expect(session.position).toEqual({ x: 12.5, y: 70, z: -8.25, yaw: 90, pitch: -10 });
    expect(session.teleportPackets).toBe(1);
    expect(session.teleportAcks).toBe(1);
    expect(socket.send).toHaveBeenCalledWith(Buffer.concat([Buffer.from([0x00]), writeVarInt(300)]));
  });

  it("applies relative position flags before acknowledging a teleport", () => {
    const packet = playerPositionPacket({ x: 2, y: -1, z: 3, yaw: 15, pitch: 4 }, 0x1f, 9);
    const socket = { send: vi.fn() };
    const session = capacitySession({ x: 10, y: 64, z: -5, yaw: 30, pitch: -2 });

    expect(acknowledgePlayerPosition(session, socket, packet)).toBe(true);
    expect(session.position).toEqual({ x: 12, y: 63, z: -2, yaw: 45, pitch: 2 });
  });

  it("encodes a 20 Hz walk packet with the 1.12.2 position-look layout", () => {
    const packet = playerPositionLookPacket({ x: 1.25, y: 72.5, z: -4, yaw: 180, pitch: 12.5 });

    expect(packet).toHaveLength(34);
    expect(packet[0]).toBe(0x0e);
    expect(packet.readDoubleBE(1)).toBe(1.25);
    expect(packet.readDoubleBE(9)).toBe(72.5);
    expect(packet.readDoubleBE(17)).toBe(-4);
    expect(packet.readFloatBE(25)).toBe(180);
    expect(packet.readFloatBE(29)).toBe(12.5);
    expect(packet[33]).toBe(0);
  });
});

function capacitySession(position: Position | null = null) {
  return {
    position,
    teleportPackets: 0,
    teleportAcks: 0,
  };
}

function playerPositionPacket(position: Position, flags: number, teleportId: number) {
  const payload = Buffer.allocUnsafe(33);
  payload.writeDoubleBE(position.x, 0);
  payload.writeDoubleBE(position.y, 8);
  payload.writeDoubleBE(position.z, 16);
  payload.writeFloatBE(position.yaw, 24);
  payload.writeFloatBE(position.pitch, 28);
  payload[32] = flags;
  return Buffer.concat([Buffer.from([0x2f]), payload, writeVarInt(teleportId)]);
}

type Position = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};
