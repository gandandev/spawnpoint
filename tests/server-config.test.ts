import { afterEach, describe, expect, it, vi } from "vitest";

const originalMemory = process.env.MC_MEMORY_MB;
const originalMaxPlayers = process.env.MC_MAX_PLAYERS;

async function loadConfig(memory: string, maxPlayers: string) {
  process.env.MC_MEMORY_MB = memory;
  process.env.MC_MAX_PLAYERS = maxPlayers;
  vi.resetModules();
  return (await import("../server/config.js")).config;
}

afterEach(() => {
  if (originalMemory === undefined) delete process.env.MC_MEMORY_MB;
  else process.env.MC_MEMORY_MB = originalMemory;
  if (originalMaxPlayers === undefined) delete process.env.MC_MAX_PLAYERS;
  else process.env.MC_MAX_PLAYERS = originalMaxPlayers;
  vi.resetModules();
});

describe.sequential("server capacity environment", () => {
  it("defaults to the tested 16-player 512 MB profile", async () => {
    const config = await loadConfig("", "");

    expect(config.memoryMb).toBe(512);
    expect(config.maxPlayers).toBe(16);
  });

  it("lets deployment variables override image defaults", async () => {
    const config = await loadConfig("640", "20");

    expect(config.memoryMb).toBe(640);
    expect(config.maxPlayers).toBe(20);
  });
});
