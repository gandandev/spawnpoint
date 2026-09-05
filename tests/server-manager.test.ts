import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinecraftServerManager } from "../server/server-manager.js";

const managers: MinecraftServerManager[] = [];
const temporaryDirectories: string[] = [];

function manager(mockServer = true, dataDir = "/tmp/spawnpoint-server-manager-test", onLog?: (line: string, occurredAt: number) => void) {
  const instance = new MinecraftServerManager({
    dataDir,
    seedDir: "/tmp/spawnpoint-server-manager-test-seed",
    portalPort: 3000,
    bridgePort: 25566,
    javaBin: "java",
    memoryMb: 256,
    idleMinutes: 10,
    startCooldownSeconds: 45,
    maxPlayers: 12,
    eulaAccepted: false,
    mockServer,
    onLog,
  });
  managers.push(instance);
  return instance;
}

function log(instance: MinecraftServerManager, line: string) {
  (instance as unknown as { handleLogLine(value: string): void }).handleLogLine(line);
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((instance) => instance.shutdown()));
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("MinecraftServerManager player tracking", () => {
  it("does not publish quiet spectator login or logout as player presence", () => {
    const instance = manager();
    const before = instance.getStatus();
    log(instance, "[Server thread/INFO]: spv_123456789abc[/127.0.0.1:56096] logged in with entity id 654 at ([world]0, 64, 0)");
    expect(instance.getStatus()).toEqual(before);
    log(instance, "[Server thread/INFO]: spv_123456789abc lost connection: Disconnected");
    expect(instance.getStatus()).toEqual(before);
  });

  it("allows the expected portal status fanout without hiding real listener leaks", () => {
    expect(manager().getMaxListeners()).toBe(48);
  });

  it("removes players from a localized server after a lost connection line", () => {
    const instance = manager();
    log(instance, "[Server thread/INFO]: telegram[/127.0.0.1:56096] logged in with entity id 654 at ([world]0, 64, 0)");
    log(instance, "[Server thread/INFO]: telegram lost connection: Disconnected");
    log(instance, "[Server thread/INFO]: 텔레그램님이 게임에서 나갔습니다.");

    expect(instance.getStatus().players).toEqual([]);
    expect(instance.getStatus().idleShutdownAt).not.toBeNull();
  });

  it("keeps the standard English leave message compatible", () => {
    const instance = manager();
    log(instance, "[Server thread/INFO]: player_one joined the game");
    log(instance, "[Server thread/INFO]: player_one left the game");

    expect(instance.getStatus().players).toEqual([]);
  });

  it("removes the old connection before a duplicate login rejoins", () => {
    const instance = manager();
    log(instance, "[Server thread/INFO]: telegram joined the game");
    log(instance, "[Server thread/INFO]: telegram lost connection: You logged in from another location");
    expect(instance.getStatus().players).toEqual([]);

    log(instance, "[Server thread/INFO]: telegram[/127.0.0.1:56096] logged in with entity id 655 at ([world]0, 64, 0)");
    expect(instance.getStatus().players).toEqual(["telegram"]);
  });

  it("records commands sent through the administrator console", async () => {
    const onLog = vi.fn();
    const instance = manager(true, "/tmp/spawnpoint-server-manager-test", onLog);
    log(instance, "[Server thread/INFO]: Done (1.234s)! For help, type \"help\"");

    await instance.sendCommand("say 안녕하세요");

    expect((await instance.getLogHistory()).entries).toContainEqual({ source: "현재 실행", line: "> say 안녕하세요" });
    expect(onLog).toHaveBeenCalledWith("[Server thread/INFO]: Done (1.234s)! For help, type \"help\"", expect.any(Number));
    expect(onLog).toHaveBeenCalledWith("> say 안녕하세요", expect.any(Number));
  });

  it("reads and searches current and compressed logs from earlier server runs", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-log-history-"));
    temporaryDirectories.push(dataDir);
    const logsDir = path.join(dataDir, "minecraft", "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, "latest.log"), "현재 준비\n현재 접속\n", "utf8");
    fs.writeFileSync(path.join(logsDir, "2026-08-29-2.log.gz"), gzipSync("이전 준비\n친구 joined the game\n"));
    fs.writeFileSync(path.join(logsDir, "2026-08-28-1.log.gz"), gzipSync("아주 이전 기록\n"));
    const instance = manager(true, dataDir);

    const latest = await instance.getLogHistory({ limit: 3 });
    expect(latest.entries).toEqual([
      { source: "2026-08-29-2.log.gz", line: "친구 joined the game" },
      { source: "latest.log", line: "현재 준비" },
      { source: "latest.log", line: "현재 접속" },
    ]);
    expect(latest.nextOffset).toBe(3);

    const older = await instance.getLogHistory({ offset: latest.nextOffset!, limit: 3 });
    expect(older.entries.map((entry) => entry.line)).toEqual(["아주 이전 기록", "이전 준비"]);
    expect(older.nextOffset).toBeNull();

    const search = await instance.getLogHistory({ query: "친구", limit: 10 });
    expect(search.entries).toEqual([{ source: "2026-08-29-2.log.gz", line: "친구 joined the game" }]);
  });

  it("waits for Minecraft to exit before shutdown completes", async () => {
    const instance = manager(false);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      stdin: {
        destroyed: false,
        writable: true,
        write: vi.fn((_command: string, callback: (error?: Error | null) => void) => {
          callback(null);
          return true;
        }),
      },
      kill: vi.fn(),
    });
    const internal = instance as unknown as {
      child: typeof child | null;
      state: { phase: string };
      handleExit: (code: number | null, signal: NodeJS.Signals | null) => void;
    };
    internal.child = child;
    internal.state.phase = "online";
    child.once("exit", (code, signal) => internal.handleExit(code as number | null, signal as NodeJS.Signals | null));

    let completed = false;
    const shutdown = instance.shutdown().then(() => { completed = true; });
    await Promise.resolve();

    expect(child.stdin.write).toHaveBeenCalledWith("save-all\nstop\n", expect.any(Function));
    expect(completed).toBe(false);

    child.emit("exit", 0, null);
    await shutdown;
    expect(completed).toBe(true);
  });
});
