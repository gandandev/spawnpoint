import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type { SkinModel, SkinType, UserRecord } from "./types.js";

interface UserRow {
  id: string;
  username: string;
  password_hash: Buffer;
  password_salt: Buffer;
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
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
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
  private readonly byId: Database.Statement<[string], UserRow>;
  private readonly insertUser: Database.Statement;
  private readonly updateSkinStatement: Database.Statement;

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
        password_hash BLOB NOT NULL,
        password_salt BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        skin_type TEXT NOT NULL DEFAULT 'preset',
        skin_ref TEXT NOT NULL DEFAULT 'moss',
        skin_model TEXT NOT NULL DEFAULT 'steve',
        skin_label TEXT NOT NULL DEFAULT 'moss',
        skin_updated_at INTEGER NOT NULL
      );
    `);
    this.byUsername = this.db.prepare("SELECT * FROM users WHERE username = ?");
    this.byId = this.db.prepare("SELECT * FROM users WHERE id = ?");
    this.insertUser = this.db.prepare(`
      INSERT INTO users (
        id, username, password_hash, password_salt, created_at,
        skin_type, skin_ref, skin_model, skin_label, skin_updated_at
      ) VALUES (
        @id, @username, @passwordHash, @passwordSalt, @createdAt,
        'preset', 'moss', 'steve', 'moss', @createdAt
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
  }

  getUserByUsername(username: string): UserRecord | null {
    return mapUser(this.byUsername.get(username));
  }

  getUserById(id: string): UserRecord | null {
    return mapUser(this.byId.get(id));
  }

  createUser(username: string, passwordHash: Buffer, passwordSalt: Buffer): UserRecord {
    const now = Date.now();
    const id = crypto.randomUUID();
    this.insertUser.run({ id, username, passwordHash, passwordSalt, createdAt: now });
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

  close(): void {
    this.db.close();
  }
}

