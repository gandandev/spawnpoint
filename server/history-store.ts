import net from "node:net";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const MAX_LOG_LINE_LENGTH = 32_768;

export interface HistoryQuery {
  query?: string;
  from?: number;
  to?: number;
  before?: number;
  limit?: number;
}

export interface HistoryPage<T> {
  entries: T[];
  nextCursor: number | null;
}

export interface AccessHistoryEntry {
  id: number;
  accountId: string;
  accountUsername: string;
  gameUsername: string;
  displayName: string;
  ipAddress: string;
  connectedAt: number;
  lastSeenAt: number;
  joinedAt: number | null;
  leftAt: number | null;
  disconnectedAt: number | null;
  disconnectReason: string | null;
}

export interface ChatHistoryEntry {
  id: number;
  occurredAt: number;
  accountId: string | null;
  uuid: string;
  gameUsername: string;
  displayName: string;
  message: string;
}

export interface ServerLogHistoryEntry {
  id: number;
  occurredAt: number;
  source: string;
  line: string;
}

export interface LegacyServerLogEntry {
  occurredAt: number;
  source: string;
  line: string;
}

interface AccessHistoryRow {
  id: number;
  account_id: string;
  account_username: string;
  game_username: string;
  display_name: string;
  ip_address: string;
  connected_at: number;
  last_seen_at: number;
  joined_at: number | null;
  left_at: number | null;
  disconnected_at: number | null;
  disconnect_reason: string | null;
}

interface ChatHistoryRow {
  id: number;
  occurred_at: number;
  account_id: string | null;
  player_uuid: string;
  game_username: string;
  display_name: string;
  message: string;
}

interface ServerLogHistoryRow {
  id: number;
  occurred_at: number;
  source: string;
  line: string;
}

function clampPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(Math.trunc(value), MAX_PAGE_SIZE));
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function pageFromRows<T extends { id: number }>(rows: T[], limit: number): HistoryPage<T> {
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  return { entries, nextCursor: hasMore ? entries.at(-1)!.id : null };
}

function mapAccessRow(row: AccessHistoryRow, revealIp: boolean): AccessHistoryEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    accountUsername: row.account_username,
    gameUsername: row.game_username,
    displayName: row.display_name,
    ipAddress: revealIp ? row.ip_address : maskIpAddress(row.ip_address),
    connectedAt: row.connected_at,
    lastSeenAt: row.last_seen_at,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    disconnectedAt: row.disconnected_at,
    disconnectReason: row.disconnect_reason,
  };
}

function mapChatRow(row: ChatHistoryRow): ChatHistoryEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    accountId: row.account_id,
    uuid: row.player_uuid,
    gameUsername: row.game_username,
    displayName: row.display_name,
    message: row.message,
  };
}

function mapServerLogRow(row: ServerLogHistoryRow): ServerLogHistoryEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    source: row.source,
    line: row.line,
  };
}

export function maskIpAddress(value: string): string {
  if (net.isIPv4(value)) {
    const parts = value.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.•••`;
  }
  if (net.isIPv6(value)) {
    const parts = value.split(":").filter(Boolean);
    return `${parts.slice(0, 3).join(":")}:…`;
  }
  return "숨김";
}

export class HistoryStore {
  private readonly db: Database.Database;
  private readonly insertSessionStatement: Database.Statement;
  private readonly touchSessionStatement: Database.Statement;
  private readonly endSessionStatement: Database.Statement;
  private readonly markJoinedStatement: Database.Statement;
  private readonly markLeftStatement: Database.Statement;
  private readonly insertChatStatement: Database.Statement;
  private readonly insertServerLogStatement: Database.Statement;

  constructor(dataDir: string) {
    this.db = new Database(path.join(dataDir, "spawnpoint.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_connection_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        launch_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_username TEXT NOT NULL,
        game_username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        connected_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        joined_at INTEGER,
        left_at INTEGER,
        disconnected_at INTEGER,
        disconnect_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS game_connection_history_time_idx
        ON game_connection_history(connected_at DESC);
      CREATE INDEX IF NOT EXISTS game_connection_history_account_idx
        ON game_connection_history(account_id, connected_at DESC);
      CREATE INDEX IF NOT EXISTS game_connection_history_ip_idx
        ON game_connection_history(ip_address, connected_at DESC);

      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        occurred_at INTEGER NOT NULL,
        account_id TEXT,
        player_uuid TEXT NOT NULL,
        game_username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chat_history_time_idx ON chat_history(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS chat_history_account_idx ON chat_history(account_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS server_log_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        line TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS server_log_history_time_idx ON server_log_history(occurred_at DESC);

      CREATE TABLE IF NOT EXISTS history_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.db.prepare(`
      UPDATE game_connection_history
      SET disconnected_at = last_seen_at,
          disconnect_reason = COALESCE(disconnect_reason, 'interrupted')
      WHERE disconnected_at IS NULL
    `).run();

    this.insertSessionStatement = this.db.prepare(`
      INSERT INTO game_connection_history (
        launch_id, account_id, account_username, game_username, display_name,
        ip_address, connected_at, last_seen_at
      ) VALUES (
        @launchId, @accountId, @accountUsername, @gameUsername, @displayName,
        @ipAddress, @connectedAt, @connectedAt
      )
    `);
    this.touchSessionStatement = this.db.prepare(`
      UPDATE game_connection_history
      SET last_seen_at = @lastSeenAt
      WHERE id = @id AND disconnected_at IS NULL
    `);
    this.endSessionStatement = this.db.prepare(`
      UPDATE game_connection_history
      SET last_seen_at = MAX(last_seen_at, @disconnectedAt),
          disconnected_at = @disconnectedAt,
          disconnect_reason = @reason
      WHERE id = @id AND disconnected_at IS NULL
    `);
    this.markJoinedStatement = this.db.prepare(`
      UPDATE game_connection_history
      SET joined_at = COALESCE(joined_at, @occurredAt),
          last_seen_at = MAX(last_seen_at, @occurredAt)
      WHERE id = (
        SELECT id FROM game_connection_history
        WHERE account_id = @accountId
          AND joined_at IS NULL
          AND connected_at <= @occurredAt
          AND COALESCE(disconnected_at, @occurredAt) >= @occurredAt - 60000
        ORDER BY connected_at DESC LIMIT 1
      )
    `);
    this.markLeftStatement = this.db.prepare(`
      UPDATE game_connection_history
      SET left_at = @occurredAt,
          last_seen_at = MAX(last_seen_at, @occurredAt)
      WHERE id = (
        SELECT id FROM game_connection_history
        WHERE account_id = @accountId
          AND joined_at IS NOT NULL
          AND left_at IS NULL
          AND connected_at <= @occurredAt
          AND COALESCE(disconnected_at, @occurredAt) >= @occurredAt - 60000
        ORDER BY connected_at DESC LIMIT 1
      )
    `);
    this.insertChatStatement = this.db.prepare(`
      INSERT INTO chat_history (
        event_id, occurred_at, account_id, player_uuid, game_username, display_name, message
      ) VALUES (
        @eventId, @occurredAt, @accountId, @uuid, @gameUsername, @displayName, @message
      )
      ON CONFLICT(event_id) DO NOTHING
    `);
    this.insertServerLogStatement = this.db.prepare(`
      INSERT INTO server_log_history (occurred_at, source, line)
      VALUES (@occurredAt, @source, @line)
    `);
  }

  startGameConnection(input: {
    launchId: string;
    accountId: string;
    accountUsername: string;
    gameUsername: string;
    displayName: string;
    ipAddress: string;
    connectedAt?: number;
  }): number {
    const result = this.insertSessionStatement.run({ ...input, connectedAt: input.connectedAt ?? Date.now() });
    return Number(result.lastInsertRowid);
  }

  touchGameConnection(id: number, lastSeenAt = Date.now()): void {
    this.touchSessionStatement.run({ id, lastSeenAt });
  }

  endGameConnection(id: number, reason = "closed", disconnectedAt = Date.now()): void {
    this.endSessionStatement.run({ id, reason, disconnectedAt });
  }

  markPlayerJoined(accountId: string, occurredAt = Date.now()): void {
    this.markJoinedStatement.run({ accountId, occurredAt });
  }

  markPlayerLeft(accountId: string, occurredAt = Date.now()): void {
    this.markLeftStatement.run({ accountId, occurredAt });
  }

  recordChat(input: Omit<ChatHistoryEntry, "id"> & { eventId: string }): void {
    this.insertChatStatement.run(input);
  }

  recordServerLog(line: string, occurredAt = Date.now(), source = "실시간"): void {
    this.insertServerLogStatement.run({
      occurredAt,
      source,
      line: line.slice(0, MAX_LOG_LINE_LENGTH),
    });
  }

  needsLegacyServerLogImport(): boolean {
    return this.db.prepare("SELECT 1 FROM history_metadata WHERE key = 'legacy_server_logs_v1'").get() === undefined;
  }

  importLegacyServerLogs(entries: LegacyServerLogEntry[]): void {
    const importAll = this.db.transaction((values: LegacyServerLogEntry[]) => {
      for (const entry of values) this.recordServerLog(entry.line, entry.occurredAt, entry.source);
      this.db.prepare(`
        INSERT INTO history_metadata (key, value) VALUES ('legacy_server_logs_v1', @completedAt)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run({ completedAt: String(Date.now()) });
    });
    importAll(entries);
  }

  listAccessHistory(options: HistoryQuery = {}, revealIp = false): HistoryPage<AccessHistoryEntry> {
    const limit = clampPageSize(options.limit);
    const query = options.query?.trim() ?? "";
    const rows = this.db.prepare(`
      SELECT * FROM game_connection_history
      WHERE (@before IS NULL OR id < @before)
        AND (@fromTime IS NULL OR COALESCE(disconnected_at, last_seen_at) >= @fromTime)
        AND (@toTime IS NULL OR connected_at <= @toTime)
        AND (
          @query = ''
          OR account_username LIKE @pattern ESCAPE '\\' COLLATE NOCASE
          OR game_username LIKE @pattern ESCAPE '\\' COLLATE NOCASE
          OR display_name LIKE @pattern ESCAPE '\\' COLLATE NOCASE
          OR ip_address LIKE @pattern ESCAPE '\\' COLLATE NOCASE
        )
      ORDER BY id DESC
      LIMIT @rowLimit
    `).all({
      before: options.before ?? null,
      fromTime: options.from ?? null,
      toTime: options.to ?? null,
      query,
      pattern: `%${escapeLike(query)}%`,
      rowLimit: limit + 1,
    }) as AccessHistoryRow[];
    return pageFromRows(rows.map((row) => mapAccessRow(row, revealIp)), limit);
  }

  listChatHistory(options: HistoryQuery = {}): HistoryPage<ChatHistoryEntry> {
    const limit = clampPageSize(options.limit);
    const query = options.query?.trim() ?? "";
    const rows = this.db.prepare(`
      SELECT * FROM chat_history
      WHERE (@before IS NULL OR id < @before)
        AND (@fromTime IS NULL OR occurred_at >= @fromTime)
        AND (@toTime IS NULL OR occurred_at <= @toTime)
        AND (
          @query = ''
          OR game_username LIKE @pattern ESCAPE '\\' COLLATE NOCASE
          OR display_name LIKE @pattern ESCAPE '\\' COLLATE NOCASE
          OR message LIKE @pattern ESCAPE '\\' COLLATE NOCASE
        )
      ORDER BY id DESC
      LIMIT @rowLimit
    `).all({
      before: options.before ?? null,
      fromTime: options.from ?? null,
      toTime: options.to ?? null,
      query,
      pattern: `%${escapeLike(query)}%`,
      rowLimit: limit + 1,
    }) as ChatHistoryRow[];
    return pageFromRows(rows.map(mapChatRow), limit);
  }

  listServerLogs(options: HistoryQuery = {}): HistoryPage<ServerLogHistoryEntry> {
    const limit = clampPageSize(options.limit);
    const query = options.query?.trim() ?? "";
    const rows = this.db.prepare(`
      SELECT * FROM server_log_history
      WHERE (@before IS NULL OR id < @before)
        AND (@fromTime IS NULL OR occurred_at >= @fromTime)
        AND (@toTime IS NULL OR occurred_at <= @toTime)
        AND (@query = '' OR line LIKE @pattern ESCAPE '\\' COLLATE NOCASE)
      ORDER BY id DESC
      LIMIT @rowLimit
    `).all({
      before: options.before ?? null,
      fromTime: options.from ?? null,
      toTime: options.to ?? null,
      query,
      pattern: `%${escapeLike(query)}%`,
      rowLimit: limit + 1,
    }) as ServerLogHistoryRow[];
    return pageFromRows(rows.map(mapServerLogRow), limit);
  }

  close(): void {
    this.db.close();
  }
}
