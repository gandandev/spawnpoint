import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type { AdminUser, SkinModel, SkinType, UserRecord } from "./types.js";

interface UserRow {
  id: string;
  username: string;
  game_username: string;
  display_name: string;
  password_hash: Buffer;
  password_salt: Buffer;
  password_reset_digest: Buffer | null;
  password_reset_expires_at: number | null;
  session_version: number;
  created_at: number;
  skin_type: SkinType;
  skin_ref: string;
  skin_model: SkinModel;
  skin_label: string;
  skin_updated_at: number;
}

function mapUser(row: UserRow | undefined): UserRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    gameUsername: row.game_username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordResetDigest: row.password_reset_digest,
    passwordResetExpiresAt: row.password_reset_expires_at,
    sessionVersion: row.session_version,
    createdAt: row.created_at,
    skinType: row.skin_type,
    skinRef: row.skin_ref,
    skinModel: row.skin_model,
    skinLabel: row.skin_label,
    skinUpdatedAt: row.skin_updated_at,
  };
}

export class AppDatabase {
  private readonly db: Database.Database;
  private readonly byUsername: Database.Statement<[string], UserRow>;
  private readonly byGameUsername: Database.Statement<[string], UserRow>;
  private readonly byId: Database.Statement<[string], UserRow>;
  private readonly insertUser: Database.Statement;
  private readonly updateSkinStatement: Database.Statement;
  private readonly updateIdentityStatement: Database.Statement;
  private readonly updatePasswordStatement: Database.Statement;
  private readonly requestPasswordResetStatement: Database.Statement;
  private readonly completePasswordResetStatement: Database.Statement;
  private readonly clearPasswordResetStatement: Database.Statement;
  private readonly listUsersStatement: Database.Statement;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "spawnpoint.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        game_username TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        password_hash BLOB NOT NULL,
        password_salt BLOB NOT NULL,
        password_reset_digest BLOB,
        password_reset_expires_at INTEGER,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        skin_type TEXT NOT NULL DEFAULT 'preset',
        skin_ref TEXT NOT NULL DEFAULT 'spawnpoint',
        skin_model TEXT NOT NULL DEFAULT 'steve',
        skin_label TEXT NOT NULL DEFAULT 'spawnpoint',
        skin_updated_at INTEGER NOT NULL
      );
    `);
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!columns.has("game_username")) this.db.exec("ALTER TABLE users ADD COLUMN game_username TEXT NOT NULL DEFAULT ''");
    if (!columns.has("display_name")) this.db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
    if (!columns.has("password_reset_digest")) this.db.exec("ALTER TABLE users ADD COLUMN password_reset_digest BLOB");
    if (!columns.has("password_reset_expires_at")) this.db.exec("ALTER TABLE users ADD COLUMN password_reset_expires_at INTEGER");
    if (!columns.has("session_version")) this.db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
    this.db.exec("UPDATE users SET game_username = username WHERE game_username = ''");
    this.db.exec("UPDATE users SET display_name = username WHERE display_name = ''");
    this.db.exec("UPDATE users SET password_reset_expires_at = NULL WHERE password_reset_digest IS NULL");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_game_username_unique ON users(game_username COLLATE NOCASE)");
    this.byUsername = this.db.prepare("SELECT * FROM users WHERE username = ?");
    this.byGameUsername = this.db.prepare("SELECT * FROM users WHERE game_username = ? COLLATE NOCASE");
    this.byId = this.db.prepare("SELECT * FROM users WHERE id = ?");
    this.insertUser = this.db.prepare(`
      INSERT INTO users (
        id, username, game_username, display_name, password_hash, password_salt, created_at,
        skin_type, skin_ref, skin_model, skin_label, skin_updated_at
      ) VALUES (
        @id, @username, @gameUsername, @username, @passwordHash, @passwordSalt, @createdAt,
        'preset', 'spawnpoint', 'steve', 'spawnpoint', @createdAt
      )
    `);
    this.updateSkinStatement = this.db.prepare(`
      UPDATE users
      SET skin_type = @skinType,
          skin_ref = @skinRef,
          skin_model = @skinModel,
          skin_label = @skinLabel,
          skin_updated_at = @skinUpdatedAt
      WHERE id = @id
    `);
    this.updateIdentityStatement = this.db.prepare(`
      UPDATE users
      SET username = @username,
          display_name = @displayName
      WHERE id = @id
    `);
    this.updatePasswordStatement = this.db.prepare(`
      UPDATE users
      SET password_hash = @passwordHash,
          password_salt = @passwordSalt,
          password_reset_digest = NULL,
          password_reset_expires_at = NULL,
          session_version = session_version + 1
      WHERE id = @id
    `);
    this.requestPasswordResetStatement = this.db.prepare(`
      UPDATE users
      SET password_reset_digest = @digest,
          password_reset_expires_at = @expiresAt,
          session_version = session_version + 1
      WHERE id = @id
    `);
    this.completePasswordResetStatement = this.db.prepare(`
      UPDATE users
      SET password_hash = @passwordHash,
          password_salt = @passwordSalt,
          password_reset_digest = NULL,
          password_reset_expires_at = NULL,
          session_version = session_version + 1
      WHERE id = @id
        AND password_reset_digest = @expectedDigest
        AND password_reset_expires_at > @now
    `);
    this.clearPasswordResetStatement = this.db.prepare(`
      UPDATE users
      SET password_reset_digest = NULL,
          password_reset_expires_at = NULL
      WHERE id = @id
    `);
    this.listUsersStatement = this.db.prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE");
  }

  getUserByUsername(username: string): UserRecord | null {
    return mapUser(this.byUsername.get(username));
  }

  getUserByGameUsername(gameUsername: string): UserRecord | null {
    return mapUser(this.byGameUsername.get(gameUsername));
  }

  getUserById(id: string): UserRecord | null {
    return mapUser(this.byId.get(id));
  }

  createUser(username: string, passwordHash: Buffer, passwordSalt: Buffer): UserRecord {
    const now = Date.now();
    const id = crypto.randomUUID();
    const preferredGameUsername = /^[A-Za-z0-9_]{3,16}$/.test(username) ? username : null;
    const gameUsername = preferredGameUsername && !this.getUserByGameUsername(preferredGameUsername)
      ? preferredGameUsername
      : `sp_${id.replaceAll("-", "").slice(0, 13)}`;
    this.insertUser.run({ id, username, gameUsername, passwordHash, passwordSalt, createdAt: now });
    const created = this.getUserById(id);
    if (!created) throw new Error("User insert succeeded but could not be read back");
    return created;
  }

  updateSkin(id: string, skinType: SkinType, skinRef: string, skinModel: SkinModel, skinLabel: string): UserRecord {
    this.updateSkinStatement.run({
      id,
      skinType,
      skinRef,
      skinModel,
      skinLabel,
      skinUpdatedAt: Date.now(),
    });
    const updated = this.getUserById(id);
    if (!updated) throw new Error("User disappeared while updating skin");
    return updated;
  }

  updateIdentity(id: string, username: string, displayName: string): UserRecord {
    this.updateIdentityStatement.run({ id, username, displayName });
    const updated = this.getUserById(id);
    if (!updated) throw new Error("User disappeared while updating identity");
    return updated;
  }

  updatePassword(id: string, passwordHash: Buffer, passwordSalt: Buffer): UserRecord {
    this.updatePasswordStatement.run({ id, passwordHash, passwordSalt });
    const updated = this.getUserById(id);
    if (!updated) throw new Error("User disappeared while updating password");
    return updated;
  }

  requestPasswordReset(id: string, digest: Buffer, expiresAt: number): UserRecord {
    this.requestPasswordResetStatement.run({ id, digest, expiresAt });
    const updated = this.getUserById(id);
    if (!updated) throw new Error("User disappeared while requesting a password reset");
    return updated;
  }

  completePasswordReset(
    id: string,
    expectedDigest: Buffer,
    passwordHash: Buffer,
    passwordSalt: Buffer,
    now: number,
  ): UserRecord | null {
    const result = this.completePasswordResetStatement.run({ id, expectedDigest, passwordHash, passwordSalt, now });
    return result.changes === 1 ? this.getUserById(id) : null;
  }

  clearPasswordReset(id: string): void {
    this.clearPasswordResetStatement.run({ id });
  }

  listUsers(): AdminUser[] {
    return (this.listUsersStatement.all() as UserRow[]).map((row) => ({
      id: row.id,
      username: row.username,
      gameUsername: row.game_username,
      displayName: row.display_name,
      createdAt: row.created_at,
      passwordResetPending: row.password_reset_digest !== null,
      passwordResetExpiresAt: row.password_reset_expires_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
