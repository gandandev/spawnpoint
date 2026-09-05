import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  announceServerUpdateCountdown,
  FRONTEND_UPDATE_MESSAGE,
  FrontendReleaseMonitor,
} from "../server/deployment-notices.js";
import type { ServerStatus } from "../server/types.js";

function status(phase: ServerStatus["phase"] = "online", players = ["mossrunner"]): ServerStatus {
  return {
    phase,
    players,
    startedAt: null,
    readyAt: null,
    idleShutdownAt: null,
    lastError: null,
    startAllowedAt: 0,
    maxPlayers: 12,
    version: "Paper 1.12.2",
  };
}

function target(current = status()) {
  return {
    current,
    getStatus: vi.fn(() => current),
    sendCommand: vi.fn(async () => {}),
  };
}

function versionResponse(version: string): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("deployment notices", () => {
  it("announces a frontend deployment once with the exact refresh message", async () => {
    const server = target();
    const versions = ["frontend-a", "frontend-b", "frontend-b"];
    const fetchVersion = vi.fn(async () => versionResponse(versions.shift()!));
    const monitor = new FrontendReleaseMonitor(server, "https://example.test/frontend-version", 10_000, fetchVersion);

    await monitor.checkNow();
    await monitor.checkNow();
    await monitor.checkNow();

    expect(server.sendCommand).toHaveBeenCalledOnce();
    expect(server.sendCommand).toHaveBeenCalledWith(
      `tellraw @a ${JSON.stringify({ text: FRONTEND_UPDATE_MESSAGE })}`,
    );
    expect(FRONTEND_UPDATE_MESSAGE).toBe("새 업데이트가 있어요.  새로고침해서 적용하세요");
  });

  it("does not announce a frontend deployment when nobody is playing", async () => {
    const server = target(status("online", []));
    const versions = ["frontend-a", "frontend-b"];
    const monitor = new FrontendReleaseMonitor(
      server,
      "https://example.test/frontend-version",
      10_000,
      vi.fn(async () => versionResponse(versions.shift()!)),
    );

    await monitor.checkNow();
    await monitor.checkNow();

    expect(server.sendCommand).not.toHaveBeenCalled();
  });

  it("skips idle requests and resets the baseline before players return", async () => {
    const server = target();
    const fetchVersion = vi.fn(async () => versionResponse("frontend-a"));
    const monitor = new FrontendReleaseMonitor(server, "https://example.test/frontend-version", 10_000, fetchVersion);
    await monitor.checkNow();
    server.getStatus.mockReturnValue(status("online", []));
    for (let index = 0; index < 60; index++) await monitor.checkNow();
    server.getStatus.mockReturnValue(status("off", []));
    await monitor.checkNow();
    expect(fetchVersion).toHaveBeenCalledOnce();
    fetchVersion.mockImplementation(async () => versionResponse("frontend-b"));
    server.getStatus.mockReturnValue(status());
    await monitor.checkNow();
    expect(server.sendCommand).not.toHaveBeenCalled();
    fetchVersion.mockImplementation(async () => versionResponse("frontend-c"));
    await monitor.checkNow();
    expect(server.sendCommand).toHaveBeenCalledOnce();
  });

  it("counts down 30, 10, 3, 2, 1 before allowing server shutdown", async () => {
    const server = target();
    const waits: number[] = [];

    await expect(announceServerUpdateCountdown(server, async (milliseconds) => {
      waits.push(milliseconds);
    })).resolves.toBe(true);

    expect(waits).toEqual([20_000, 7_000, 1_000, 1_000, 1_000]);
    expect(server.sendCommand.mock.calls.map(([command]) => command)).toEqual([
      `tellraw @a ${JSON.stringify({ text: "30초 후 서버 업데이트가 있어요" })}`,
      `tellraw @a ${JSON.stringify({ text: "10초 후 서버 업데이트가 있어요" })}`,
      `tellraw @a ${JSON.stringify({ text: "3" })}`,
      `tellraw @a ${JSON.stringify({ text: "2" })}`,
      `tellraw @a ${JSON.stringify({ text: "1" })}`,
    ]);
  });

  it("skips the server countdown when nobody is playing", async () => {
    const server = target(status("online", []));
    const pause = vi.fn(async () => {});

    await expect(announceServerUpdateCountdown(server, pause)).resolves.toBe(false);

    expect(server.sendCommand).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("exposes an uncached Railway deployment id and keeps enough shutdown time", async () => {
    const [caddyfile, railwayConfig] = await Promise.all([
      fs.readFile(path.join(process.cwd(), "Caddyfile.frontend"), "utf8"),
      fs.readFile(path.join(process.cwd(), ".railway", "railway.ts"), "utf8"),
    ]);

    expect(caddyfile).toContain("@frontendVersion path /frontend-version");
    expect(caddyfile).toContain("{$RAILWAY_DEPLOYMENT_ID:local}");
    expect(caddyfile).toContain('header Cache-Control "no-store"');
    expect(railwayConfig).toContain("deploy: { drainingSeconds: 60 }");
    expect(railwayConfig).toContain("SPAWNPOINT_FRONTEND_VERSION_URL");
  });
});
