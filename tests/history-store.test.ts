import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryStore, maskIpAddress } from "../server/history-store.js";

const dataDirectories: string[] = [];

function temporaryDataDirectory(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-history-"));
  dataDirectories.push(dataDir);
  return dataDir;
}

afterEach(() => {
  for (const dataDir of dataDirectories.splice(0)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("permanent administrator history", () => {
  it("stores searchable access sessions with masked and explicit IP views", () => {
    const store = new HistoryStore(temporaryDataDirectory());
    const accountId = crypto.randomUUID();
    const sessionId = store.startGameConnection({
      launchId: crypto.randomUUID(),
      accountId,
      accountUsername: "portal-player",
      gameUsername: "game_player",
      displayName: "친구",
      ipAddress: "203.0.113.42",
      connectedAt: 1_000,
    });
    store.markPlayerJoined(accountId, 1_200);
    store.touchGameConnection(sessionId, 2_000);
    store.markPlayerLeft(accountId, 2_800);
    store.endGameConnection(sessionId, "closed", 3_000);

    expect(store.listAccessHistory({ query: "203.0.113", from: 1_100, to: 2_900 }).entries).toEqual([
      expect.objectContaining({
        id: sessionId,
        ipAddress: "203.0.113.•••",
        joinedAt: 1_200,
        leftAt: 2_800,
        disconnectedAt: 3_000,
      }),
    ]);
    expect(store.listAccessHistory({ query: "친구" }, true).entries[0].ipAddress).toBe("203.0.113.42");
    expect(store.listAccessHistory({ from: 3_001 }).entries).toHaveLength(0);
    store.close();
  });

  it("keeps chat and server logs after reopening and deduplicates retried chat events", () => {
    const dataDir = temporaryDataDirectory();
    const eventId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const first = new HistoryStore(dataDir);
    const chat = {
      eventId,
      occurredAt: 10_000,
      accountId,
      uuid: crypto.randomUUID(),
      gameUsername: "game_player",
      displayName: "친구",
      message: "영구 채팅 테스트",
    };
    first.recordChat(chat);
    first.recordChat(chat);
    first.recordServerLog("Done (1.234s)!", 11_000);
    first.close();

    const reopened = new HistoryStore(dataDir);
    expect(reopened.listChatHistory({ query: "영구", from: 9_000, to: 10_000 }).entries).toEqual([
      expect.objectContaining({ message: "영구 채팅 테스트", displayName: "친구" }),
    ]);
    expect(reopened.listServerLogs({ query: "Done", from: 10_500 }).entries).toEqual([
      expect.objectContaining({ occurredAt: 11_000, line: "Done (1.234s)!" }),
    ]);
    reopened.close();
  });

  it("closes an interrupted live session at its last durable heartbeat", () => {
    const dataDir = temporaryDataDirectory();
    const first = new HistoryStore(dataDir);
    const sessionId = first.startGameConnection({
      launchId: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      accountUsername: "player",
      gameUsername: "player",
      displayName: "player",
      ipAddress: "2001:db8:abcd::1",
      connectedAt: 1_000,
    });
    first.touchGameConnection(sessionId, 9_000);
    first.close();

    const reopened = new HistoryStore(dataDir);
    expect(reopened.listAccessHistory({}, true).entries[0]).toMatchObject({
      disconnectedAt: 9_000,
      disconnectReason: "interrupted",
    });
    reopened.close();
  });

  it("keeps a quit event that arrives just after the gateway socket closes", () => {
    const store = new HistoryStore(temporaryDataDirectory());
    const accountId = crypto.randomUUID();
    const sessionId = store.startGameConnection({
      launchId: crypto.randomUUID(),
      accountId,
      accountUsername: "player",
      gameUsername: "player",
      displayName: "player",
      ipAddress: "192.0.2.8",
      connectedAt: 1_000,
    });
    store.markPlayerJoined(accountId, 1_100);
    store.endGameConnection(sessionId, "closed", 2_000);
    store.markPlayerLeft(accountId, 2_050);

    expect(store.listAccessHistory().entries[0]).toMatchObject({
      joinedAt: 1_100,
      leftAt: 2_050,
      disconnectedAt: 2_000,
    });
    store.close();
  });

  it("imports legacy logs once in one transaction", () => {
    const store = new HistoryStore(temporaryDataDirectory());
    expect(store.needsLegacyServerLogImport()).toBe(true);
    store.importLegacyServerLogs([
      { occurredAt: 100, source: "2026-09-01-1.log.gz", line: "old line" },
      { occurredAt: 200, source: "latest.log", line: "new line" },
    ]);

    expect(store.needsLegacyServerLogImport()).toBe(false);
    expect(store.listServerLogs().entries.map((entry) => entry.line)).toEqual(["new line", "old line"]);
    store.close();
  });

  it("masks IPv4 and IPv6 addresses", () => {
    expect(maskIpAddress("192.0.2.9")).toBe("192.0.2.•••");
    expect(maskIpAddress("2001:db8:abcd::1")).toBe("2001:db8:abcd:…");
    expect(maskIpAddress("unknown")).toBe("숨김");
  });
});
