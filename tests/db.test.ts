import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../server/db.js";

const dataDirectories: string[] = [];

function temporaryDataDirectory(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnpoint-db-"));
  dataDirectories.push(dataDir);
  return dataDir;
}

afterEach(() => {
  for (const dataDir of dataDirectories.splice(0)) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("account database migrations", () => {
  it("defaults to New Default V2 and keeps a resource-pack choice after reopening", () => {
    const dataDir = temporaryDataDirectory();
    const database = new AppDatabase(dataDir);
    const created = database.createUser("textureplayer", Buffer.from("hash"), Buffer.from("salt"));

    expect(created.resourcePackPreference).toBe("new-default");
    expect(database.updateResourcePack(created.id, "programmer-art").resourcePackPreference).toBe("programmer-art");
    database.close();

    const reopened = new AppDatabase(dataDir);
    expect(reopened.getUserById(created.id)?.resourcePackPreference).toBe("programmer-art");
    reopened.close();
  });

  it("preserves the original Minecraft identity when an account is renamed", () => {
    const database = new AppDatabase(temporaryDataDirectory());
    const created = database.createUser("oldplayer", Buffer.from("hash"), Buffer.from("salt"));
    const renamed = database.updateIdentity(created.id, "새플레이어");

    expect(renamed.username).toBe("새플레이어");
    expect(renamed.displayName).toBe("새플레이어");
    expect(renamed.gameUsername).toBe("oldplayer");
    expect(database.getUserByGameUsername("OLDPLAYER")?.id).toBe(created.id);
    database.close();
  });

  it("gives a Korean account name a separate Minecraft-safe identity", () => {
    const database = new AppDatabase(temporaryDataDirectory());
    const created = database.createUser("텔레그램", Buffer.from("hash"), Buffer.from("salt"));

    expect(created.username).toBe("텔레그램");
    expect(created.displayName).toBe("텔레그램");
    expect(created.gameUsername).toMatch(/^sp_[a-f0-9]{13}$/);
    expect(created.gameUsername).toHaveLength(16);
    database.close();
  });

  it("migrates a separate display name back to the account name", () => {
    const dataDir = temporaryDataDirectory();
    const database = new AppDatabase(dataDir);
    const created = database.createUser("텔레그램", Buffer.from("hash"), Buffer.from("salt"));
    database.close();

    const raw = new Database(path.join(dataDir, "spawnpoint.sqlite"));
    raw.prepare("UPDATE users SET display_name = ? WHERE id = ?").run("다른이름", created.id);
    raw.close();

    const migrated = new AppDatabase(dataDir);
    expect(migrated.getUserById(created.id)).toMatchObject({
      username: "텔레그램",
      displayName: "텔레그램",
      gameUsername: created.gameUsername,
    });
    migrated.close();
  });

  it("backfills immutable game and display names in a legacy database", () => {
    const dataDir = temporaryDataDirectory();
    const legacy = new Database(path.join(dataDir, "spawnpoint.sqlite"));
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash BLOB NOT NULL,
        password_salt BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        skin_type TEXT NOT NULL,
        skin_ref TEXT NOT NULL,
        skin_model TEXT NOT NULL,
        skin_label TEXT NOT NULL,
        skin_updated_at INTEGER NOT NULL
      );
    `);
    legacy.prepare(`
      INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("user-1", "legacyplayer", Buffer.from("hash"), Buffer.from("salt"), 1, "preset", "steve", "steve", "steve", 1);
    legacy.close();

    const migrated = new AppDatabase(dataDir);
    const user = migrated.getUserById("user-1");
    expect(user?.gameUsername).toBe("legacyplayer");
    expect(user?.displayName).toBe("legacyplayer");
    expect(user?.passwordResetDigest).toBeNull();
    expect(user?.sessionVersion).toBe(0);
    expect(user?.resourcePackPreference).toBe("new-default");
    migrated.close();
  });

  it("stores only a reset digest and consumes it once while revoking sessions", () => {
    const database = new AppDatabase(temporaryDataDirectory());
    const created = database.createUser("resetplayer", Buffer.from("hash"), Buffer.from("salt"));
    const digest = Buffer.alloc(32, 7);
    const requested = database.requestPasswordReset(created.id, digest, Date.now() + 60_000);
    const changed = database.completePasswordReset(
      created.id,
      digest,
      Buffer.from("new-hash"),
      Buffer.from("new-salt"),
      Date.now(),
    );
    const reused = database.completePasswordReset(
      created.id,
      digest,
      Buffer.from("other-hash"),
      Buffer.from("other-salt"),
      Date.now(),
    );

    expect(requested.sessionVersion).toBe(1);
    expect(requested.passwordResetDigest).toEqual(digest);
    expect(requested.passwordResetExpiresAt).not.toBeNull();
    expect(changed?.sessionVersion).toBe(2);
    expect(changed?.passwordResetDigest).toBeNull();
    expect(changed?.passwordResetExpiresAt).toBeNull();
    expect(reused).toBeNull();
    database.close();
  });
});
