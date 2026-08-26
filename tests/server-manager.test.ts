import { afterEach, describe, expect, it } from "vitest";
import { MinecraftServerManager } from "../server/server-manager.js";

const managers: MinecraftServerManager[] = [];

function manager() {
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
    mockServer: true,
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
});
