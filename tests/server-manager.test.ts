import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinecraftServerManager } from "../server/server-manager.js";

const managers: MinecraftServerManager[] = [];

function manager(mockServer = true) {
  const instance = new MinecraftServerManager({
    dataDir: "/tmp/spawnpoint-server-manager-test",
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
  });
  managers.push(instance);
  return instance;
}

function log(instance: MinecraftServerManager, line: string) {
  (instance as unknown as { handleLogLine(value: string): void }).handleLogLine(line);
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((instance) => instance.shutdown()));
});

describe("MinecraftServerManager player tracking", () => {
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
    const instance = manager();
    log(instance, "[Server thread/INFO]: Done (1.234s)! For help, type \"help\"");

    await instance.sendCommand("say 안녕하세요");

    expect(instance.getRecentLogs()).toContain("> say 안녕하세요");
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
