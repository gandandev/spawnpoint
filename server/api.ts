import fs from "node:fs";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AppDatabase } from "./db.js";
import type { MinecraftServerManager } from "./server-manager.js";
import type { HistoryQuery, HistoryStore } from "./history-store.js";
import { GameConnectionTracker, isLaunchId } from "./game-connections.js";
import { ServerStartError } from "./server-manager.js";
import {
  adminFromRequest,
  clearAdminCookie,
  clearSessionCookie,
  createAdminToken,
  createPasswordResetCode,
  createSessionToken,
  spectatorUsername,
  createTemporaryPassword,
  hashPassword,
  isSameOrigin,
  sessionFromRequest,
  setAdminCookie,
  setSessionCookie,
  validateCredentials,
  validateNewPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifyPasswordResetCode,
} from "./security.js";
import { SKIN_CATALOG, SkinService, toPublicUser } from "./skins.js";
import type {
  AdminActor,
  AdminAuthorization,
  BridgeSettings,
  BridgeTitleRequest,
  LocatorSnapshot,
  LocatorTargetDetails,
  PlayerDetails,
  PublicUser,
  ResourcePackPreference,
  ServerGameMode,
  ServerSettings,
  TitleColor,
  UserAuthentication,
  UserRecord,
} from "./types.js";
import type { PlayerInventoryPatch, PlayerStatePatch } from "./player-data.js";

export interface ApiContext {
  database: AppDatabase;
  skins: SkinService;
  serverManager: MinecraftServerManager;
  sessionSecret: string;
  serverPassword: string;
  secureCookies: boolean;
  sessionDays: number;
  eulaAccepted: boolean;
  gameConnections: GameConnectionTracker;
  history: HistoryStore;
  adminUsernames?: readonly string[];
  adminUserIds?: readonly string[];
  adminPassword?: string;
  bridgeOrigin?: string;
  bridgeSecret?: string;
}

const PASSWORD_RESET_WINDOW_MS = 15 * 60_000;
const ADMIN_UNLOCK_MINUTES = 10;
const ADMIN_OVERVIEW_RATE_LIMIT = 1_200;
const ADMIN_OVERVIEW_RATE_WINDOW_MS = 10 * 60_000;
const LOCATOR_BRIDGE_CACHE_MS = 200;
const TITLE_COLORS = new Set<TitleColor>(["white", "gray", "red", "gold", "yellow", "green", "aqua", "blue", "light_purple"]);
const SERVER_DIFFICULTIES = new Set(["peaceful", "easy", "normal", "hard"]);
const SERVER_GAME_MODES = new Set<ServerGameMode>(["survival", "creative", "adventure", "spectator"]);
const STANDALONE_ADMIN = {
  id: "spawnpoint-standalone-admin",
  username: "admin",
  sessionVersion: 0,
} as const;

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 5_000,
  ) {}

  private setBucket(key: string, entries: number[]): void {
    this.buckets.delete(key);
    this.buckets.set(key, entries);
  }

  take(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    if (!this.buckets.has(key) && this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    const recent = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit) {
      this.setBucket(key, recent);
      return false;
    }
    recent.push(now);
    this.setBucket(key, recent);
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

function fail(response: Response, status: number, message: string, code = "REQUEST_FAILED"): void {
  response.status(status).json({ error: { code, message } });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function failFromError(response: Response, status: number, error: unknown, fallback: string, code = "REQUEST_FAILED"): void {
  fail(response, status, errorMessage(error, fallback), code);
}

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function requireSameOrigin(request: Request, response: Response): boolean {
  if (isSameOrigin(request)) return true;
  fail(response, 403, "다른 출처에서 보낸 요청은 허용되지 않아요.", "BAD_ORIGIN");
  return false;
}

function userForRequest(request: Request, context: ApiContext): UserAuthentication | null {
  const session = sessionFromRequest(request, context.sessionSecret);
  if (!session?.csrf) return null;
  let user = context.database.getUserById(session.sub);
  if (
    !user
    || user.username.toLowerCase() !== session.username.toLowerCase()
    || user.sessionVersion !== (session.sessionVersion ?? 0)
  ) return null;
  if (user.archivedAt !== null) user = context.database.setUserArchived(user.id, false);
  const admin = adminFromRequest(request, context.sessionSecret);
  const adminExpiresAt = admin
    && admin.sub === user.id
    && admin.sessionVersion === user.sessionVersion
    ? admin.exp * 1_000
    : null;
  return { user, csrf: session.csrf, adminExpiresAt };
}

function standaloneAdminForRequest(request: Request, context: ApiContext): { user: AdminActor; csrf: string; adminExpiresAt: number } | null {
  const admin = adminFromRequest(request, context.sessionSecret);
  if (!admin?.csrf) return null;
  if (
    admin.sub === STANDALONE_ADMIN.id
    && admin.username === STANDALONE_ADMIN.username
    && (admin.sessionVersion ?? 0) === STANDALONE_ADMIN.sessionVersion
  ) {
    return { user: STANDALONE_ADMIN, csrf: admin.csrf, adminExpiresAt: admin.exp * 1_000 };
  }
  const user = context.database.getUserById(admin.sub);
  if (
    !user
    || user.username.toLowerCase() !== admin.username.toLowerCase()
    || user.sessionVersion !== (admin.sessionVersion ?? 0)
  ) return null;
  return { user, csrf: admin.csrf, adminExpiresAt: admin.exp * 1_000 };
}

function isAdmin(user: Pick<UserRecord, "id" | "username">, context: ApiContext): boolean {
  return isAdminId(user.id, context) || isAdminUsername(user.username, context);
}

function isAdminId(id: string, context: ApiContext): boolean {
  const normalized = id.toLowerCase();
  return (context.adminUserIds ?? []).some((candidate) => candidate.toLowerCase() === normalized);
}

function isAdminUsername(username: string, context: ApiContext): boolean {
  const normalized = username.toLowerCase();
  return (context.adminUsernames ?? []).some((candidate) => candidate.toLowerCase() === normalized);
}

function safeSecretEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function publicUser(user: UserRecord, context: ApiContext, adminExpiresAt: number | null = null): PublicUser {
  return {
    ...toPublicUser(user),
    displayName: user.displayName,
    isAdmin: isAdmin(user, context) || (adminExpiresAt !== null && adminExpiresAt > Date.now()),
  };
}

function standaloneAdminPublicUser() {
  return {
    id: STANDALONE_ADMIN.id,
    username: STANDALONE_ADMIN.username,
    displayName: "관리자",
    isAdmin: true,
    skin: {
      type: "preset" as const,
      model: "steve" as const,
      label: "스티브",
      previewUrl: "/assets/skins/steve.png?v=texture-v2",
    },
  };
}

function hasActivePasswordReset(user: UserRecord, now = Date.now()): boolean {
  return user.passwordResetDigest !== null
    && user.passwordResetExpiresAt !== null
    && user.passwordResetExpiresAt > now;
}

function requireAuthentication(request: Request, response: Response, context: ApiContext, csrf = false): UserAuthentication | null {
  const authenticated = userForRequest(request, context);
  if (!authenticated) {
    fail(response, 401, "먼저 로그인하세요.", "AUTH_REQUIRED");
    return null;
  }
  if (csrf && !requireCsrf(request, response, authenticated.csrf)) return null;
  return authenticated;
}

function requireUser(request: Request, response: Response, context: ApiContext, csrf = false): UserRecord | null {
  return requireAuthentication(request, response, context, csrf)?.user ?? null;
}

function requireCsrf(request: Request, response: Response, csrf: string): boolean {
  if (request.headers["x-spawnpoint-csrf"] === csrf) return true;
  fail(response, 403, "페이지를 새로고침한 뒤 다시 시도하세요.", "BAD_CSRF");
  return false;
}

function requireAdmin(
  request: Request,
  response: Response,
  context: ApiContext,
  authenticated: UserAuthentication | null = userForRequest(request, context),
): AdminActor | null {
  const standaloneAdmin = authenticated ? null : standaloneAdminForRequest(request, context);
  const csrf = authenticated?.csrf ?? standaloneAdmin?.csrf;
  if (!csrf) {
    fail(response, 401, "관리자 인증이 필요해요.", "AUTH_REQUIRED");
    return null;
  }
  if (!requireCsrf(request, response, csrf)) return null;
  if (standaloneAdmin) return standaloneAdmin.user;
  if (!isAdmin(authenticated!.user, context) && !(authenticated!.adminExpiresAt && authenticated!.adminExpiresAt > Date.now())) {
    fail(response, 403, "관리자 권한이 필요해요.", "ADMIN_REQUIRED");
    return null;
  }
  return authenticated!.user;
}

function requireAdminMutation(
  request: Request,
  response: Response,
  context: ApiContext,
  limiter: MemoryRateLimiter,
): AdminAuthorization | null {
  if (!requireSameOrigin(request, response)) return null;
  const authenticated = userForRequest(request, context);
  const admin = requireAdmin(request, response, context, authenticated);
  if (!admin) return null;
  if (!limiter.take(`${admin.id}:mutation`)) {
    fail(response, 429, "관리자 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
    return null;
  }
  return { admin, authenticated };
}

function validatePlayerTarget(input: unknown): string {
  if (typeof input !== "string") throw new Error("플레이어를 선택하세요.");
  if (/^[A-Za-z0-9_]{3,16}$/.test(input) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) {
    return input;
  }
  throw new Error("플레이어 정보가 올바르지 않아요.");
}

function validateConsoleCommand(input: unknown): string {
  if (typeof input !== "string") throw new Error("콘솔 명령을 입력하세요.");
  const command = input.trim();
  if (!command || command.length > 256 || /[\r\n\0]/.test(command)) {
    throw new Error("콘솔 명령은 줄바꿈 없이 1~256자로 입력하세요.");
  }
  const normalized = command.startsWith("/") ? command.slice(1).trimStart() : command;
  if (!normalized) throw new Error("콘솔 명령을 입력하세요.");
  return normalized;
}

function validateLogSearch(input: unknown): string {
  if (input === undefined) return "";
  if (typeof input !== "string" || input.length > 100 || /[\r\n\0]/.test(input)) {
    throw new Error("로그 검색어는 줄바꿈 없이 100자까지 입력하세요.");
  }
  return input.trim();
}

function validateLogOffset(input: unknown): number {
  if (input === undefined) return 0;
  if (typeof input !== "string" || !/^\d{1,7}$/.test(input)) throw new Error("로그 위치가 올바르지 않아요.");
  return Number(input);
}

function validateHistoryNumber(input: unknown, label: string): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !/^\d{1,16}$/.test(input)) throw new Error(`${label} 값이 올바르지 않아요.`);
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 값이 올바르지 않아요.`);
  return value;
}

function validateHistoryQuery(query: Request["query"]): HistoryQuery {
  const from = validateHistoryNumber(query.from, "시작 시간");
  const to = validateHistoryNumber(query.to, "끝 시간");
  if (from !== undefined && to !== undefined && from > to) throw new Error("시작 시간은 끝 시간보다 빨라야 해요.");
  return {
    query: validateLogSearch(query.q),
    from,
    to,
    before: validateHistoryNumber(query.before, "기록 위치"),
    limit: 100,
  };
}

interface BridgeHistoryEvent {
  eventId: string;
  type: "join" | "quit" | "chat" | "whisper";
  occurredAt: number;
  accountId: string | null;
  uuid: string;
  gameUsername: string;
  displayName: string;
  message: string | null;
  recipientUuid: string | null;
  recipientGameUsername: string | null;
  recipientDisplayName: string | null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateBridgeHistoryEvent(input: unknown): BridgeHistoryEvent {
  const value = objectInput(input, "기록 이벤트가 올바르지 않아요.");
  if (!isUuid(value.eventId)) {
    throw new Error("기록 ID가 올바르지 않아요.");
  }
  if (value.type !== "join" && value.type !== "quit" && value.type !== "chat" && value.type !== "whisper") {
    throw new Error("기록 종류가 올바르지 않아요.");
  }
  const occurredAt = numberInput(value.occurredAt, "기록 시간", 0, Date.now() + 5 * 60_000, true);
  if (value.accountId !== null && !isUuid(value.accountId)) throw new Error("계정 ID가 올바르지 않아요.");
  const accountId = value.accountId;
  if (!isUuid(value.uuid)) throw new Error("플레이어 UUID가 올바르지 않아요.");
  if (typeof value.gameUsername !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(value.gameUsername)) {
    throw new Error("게임 이름이 올바르지 않아요.");
  }
  if (typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 64 || /[\r\n\0]/.test(value.displayName)) {
    throw new Error("표시 이름이 올바르지 않아요.");
  }
  let message: string | null = null;
  if (value.type === "chat" || value.type === "whisper") message = validateGameChatMessage(value.message);
  let recipientUuid: string | null = null;
  let recipientGameUsername: string | null = null;
  let recipientDisplayName: string | null = null;
  if (value.type === "whisper") {
    if (!isUuid(value.recipientUuid)) throw new Error("귓속말 수신자 UUID가 올바르지 않아요.");
    if (typeof value.recipientGameUsername !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(value.recipientGameUsername)) {
      throw new Error("귓속말 수신자 게임 이름이 올바르지 않아요.");
    }
    if (typeof value.recipientDisplayName !== "string" || !value.recipientDisplayName.trim()
      || value.recipientDisplayName.length > 64 || /[\r\n\0]/.test(value.recipientDisplayName)) {
      throw new Error("귓속말 수신자 표시 이름이 올바르지 않아요.");
    }
    recipientUuid = value.recipientUuid;
    recipientGameUsername = value.recipientGameUsername;
    recipientDisplayName = value.recipientDisplayName.trim();
  }
  return {
    eventId: value.eventId,
    type: value.type,
    occurredAt,
    accountId,
    uuid: value.uuid,
    gameUsername: value.gameUsername,
    displayName: value.displayName.trim(),
    message,
    recipientUuid,
    recipientGameUsername,
    recipientDisplayName,
  };
}

function objectInput(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(message);
  return input as Record<string, unknown>;
}

function booleanInput(input: unknown, message: string): boolean {
  if (typeof input !== "boolean") throw new Error(message);
  return input;
}

function numberInput(input: unknown, label: string, minimum: number, maximum: number, integer = false): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < minimum || input > maximum || (integer && !Number.isInteger(input))) {
    throw new Error(`${label} 값이 올바르지 않아요.`);
  }
  return input;
}

function validateServerSettings(input: unknown): ServerSettings {
  const value = objectInput(input, "서버 설정이 올바르지 않아요.");
  const motd = typeof value.motd === "string" ? value.motd.trim() : "";
  if (!motd || motd.length > 80 || /[\r\n\0]/.test(motd)) throw new Error("서버 설명은 한 줄로 1~80자를 입력하세요.");
  if (typeof value.difficulty !== "string" || !SERVER_DIFFICULTIES.has(value.difficulty)) {
    throw new Error("난이도 선택이 올바르지 않아요.");
  }
  if (typeof value.defaultGameMode !== "string" || !SERVER_GAME_MODES.has(value.defaultGameMode as ServerGameMode)) {
    throw new Error("기본 게임 모드 선택이 올바르지 않아요.");
  }
  return {
    motd,
    maxPlayers: numberInput(value.maxPlayers, "최대 인원", 2, 40, true),
    difficulty: value.difficulty as ServerSettings["difficulty"],
    defaultGameMode: value.defaultGameMode as ServerGameMode,
    forceGameMode: booleanInput(value.forceGameMode, "게임 모드 설정이 올바르지 않아요."),
    viewDistance: numberInput(value.viewDistance, "시야 거리", 2, 12, true),
    playerIdleTimeout: numberInput(value.playerIdleTimeout, "자리 비움 제한", 0, 120, true),
    pvp: booleanInput(value.pvp, "PVP 설정이 올바르지 않아요."),
    allowFlight: booleanInput(value.allowFlight, "비행 설정이 올바르지 않아요."),
    hardcore: booleanInput(value.hardcore, "하드코어 설정이 올바르지 않아요."),
    allowNether: booleanInput(value.allowNether, "네더 설정이 올바르지 않아요."),
    generateStructures: booleanInput(value.generateStructures, "구조물 설정이 올바르지 않아요."),
    spawnAnimals: booleanInput(value.spawnAnimals, "동물 설정이 올바르지 않아요."),
    spawnMonsters: booleanInput(value.spawnMonsters, "몬스터 설정이 올바르지 않아요."),
    spawnNpcs: booleanInput(value.spawnNpcs, "주민 설정이 올바르지 않아요."),
    whiteList: booleanInput(value.whiteList, "화이트리스트 설정이 올바르지 않아요."),
    commandBlocks: booleanInput(value.commandBlocks, "명령 블록 설정이 올바르지 않아요."),
    keepInventory: booleanInput(value.keepInventory, "인벤토리 보존 설정이 올바르지 않아요."),
    tpaEnabled: booleanInput(value.tpaEnabled, "TPA 설정이 올바르지 않아요."),
  };
}

function serverSettingsRequireRestart(previous: ServerSettings, next: ServerSettings): boolean {
  return (Object.keys(next) as Array<keyof ServerSettings>).some((key) => (
    key !== "tpaEnabled" && key !== "keepInventory" && previous[key] !== next[key]
  ));
}

function validatePlayerStatePatch(input: unknown): PlayerStatePatch {
  const value = objectInput(input, "플레이어 상태가 올바르지 않아요.");
  const allowed = new Set(["health", "foodLevel", "gameMode", "location"]);
  if (!Object.keys(value).length || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("변경할 플레이어 상태를 선택하세요.");
  }
  const patch: PlayerStatePatch = {};
  if (value.health !== undefined) patch.health = numberInput(value.health, "체력", 0, 20);
  if (value.foodLevel !== undefined) patch.foodLevel = numberInput(value.foodLevel, "허기", 0, 20, true);
  if (value.gameMode !== undefined) {
    if (typeof value.gameMode !== "string" || !SERVER_GAME_MODES.has(value.gameMode as ServerGameMode)) {
      throw new Error("게임 모드 선택이 올바르지 않아요.");
    }
    patch.gameMode = value.gameMode as ServerGameMode;
  }
  if (value.location !== undefined) {
    const location = objectInput(value.location, "위치 정보가 올바르지 않아요.");
    if (typeof location.world !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(location.world)) {
      throw new Error("월드 선택이 올바르지 않아요.");
    }
    patch.location = {
      world: location.world,
      x: numberInput(location.x, "X 좌표", -30_000_000, 30_000_000),
      y: numberInput(location.y, "Y 좌표", -64, 512),
      z: numberInput(location.z, "Z 좌표", -30_000_000, 30_000_000),
      yaw: numberInput(location.yaw, "방향", -360, 360),
      pitch: numberInput(location.pitch, "고개 각도", -90, 90),
    };
  }
  return patch;
}

function validateInventoryPatch(input: unknown): PlayerInventoryPatch {
  const value = objectInput(input, "인벤토리 변경 값이 올바르지 않아요.");
  if (value.section !== "storage" && value.section !== "armor" && value.section !== "extra" && value.section !== "ender") {
    throw new Error("인벤토리 종류가 올바르지 않아요.");
  }
  const maximumSlot = value.section === "storage" ? 35 : value.section === "armor" ? 3 : value.section === "extra" ? 0 : 26;
  const slot = numberInput(value.slot, "아이템 칸", 0, maximumSlot, true);
  if (value.item === null) return { section: value.section, slot, item: null };
  const item = objectInput(value.item, "아이템 정보가 올바르지 않아요.");
  const type = typeof item.type === "string" ? item.type.trim().toLowerCase().replace(/^minecraft:/, "") : "";
  if (!/^[a-z0-9_]{1,80}$/.test(type)) throw new Error("아이템 ID가 올바르지 않아요.");
  return {
    section: value.section,
    slot,
    item: {
      type,
      amount: numberInput(item.amount, "아이템 수량", 1, 64, true),
      durability: numberInput(item.durability ?? 0, "아이템 내구도", 0, 32_767, true),
    },
  };
}

function validateAdminReason(input: unknown, fallback: string): string {
  if (input !== undefined && typeof input !== "string") throw new Error("사유는 한 줄로 1~160자를 입력하세요.");
  if (typeof input === "string" && /[\r\n\0]/.test(input)) throw new Error("사유는 한 줄로 1~160자를 입력하세요.");
  const reason = typeof input === "string" ? input.trim() || fallback : fallback;
  if (reason.length > 160) throw new Error("사유는 한 줄로 1~160자를 입력하세요.");
  return reason;
}

function validateTitleText(input: unknown, label: string, maxLength: number): string {
  if (typeof input !== "string") throw new Error(`${label} 문구를 입력하세요.`);
  const text = input.trim();
  if (text.length > maxLength || /[\r\n\0\u00a7]/.test(text)) {
    throw new Error(`${label} 문구는 줄바꿈 없이 ${maxLength}자까지 입력하세요.`);
  }
  return text;
}

function validateTitleRequest(input: unknown): BridgeTitleRequest {
  if (!input || typeof input !== "object") throw new Error("타이틀 설정이 올바르지 않아요.");
  const value = input as Record<string, unknown>;
  const title = validateTitleText(value.title, "제목", 64);
  const subtitle = validateTitleText(value.subtitle, "부제목", 128);
  if (!title && !subtitle) throw new Error("제목이나 부제목을 하나 이상 입력하세요.");
  if (typeof value.color !== "string" || !TITLE_COLORS.has(value.color as TitleColor)) {
    throw new Error("타이틀 색깔이 올바르지 않아요.");
  }
  if (value.audience !== "all" && value.audience !== "selected") {
    throw new Error("타이틀을 받을 사용자를 선택하세요.");
  }
  if (!Array.isArray(value.targets) || value.targets.length > 100) {
    throw new Error("타이틀을 받을 사용자 목록이 올바르지 않아요.");
  }
  const targets = [...new Set(value.targets.map(validatePlayerTarget))];
  if (value.audience === "selected" && targets.length === 0) throw new Error("타이틀을 받을 사용자를 선택하세요.");
  return {
    title,
    subtitle,
    color: value.color as TitleColor,
    audience: value.audience,
    targets: value.audience === "all" ? [] : targets,
  };
}

function validateGameChatMessage(input: unknown): string {
  if (typeof input !== "string") throw new Error("채팅 내용을 입력하세요.");
  const message = input.trim();
  if (!message || message.length > 256 || /[\r\n\0]/.test(message)) {
    throw new Error("채팅은 줄바꿈 없이 1~256자로 입력하세요.");
  }
  if (message === "/") throw new Error("명령어를 입력하세요.");
  return message;
}

async function bridgeRequest(context: ApiContext, pathname: string, init?: RequestInit, timeoutMs = 2_000): Promise<globalThis.Response> {
  if (!context.bridgeOrigin || !context.bridgeSecret) throw new Error("브리지 인증이 설정되지 않았어요.");
  let origin: URL;
  try {
    origin = new URL(context.bridgeOrigin);
  } catch {
    throw new Error("브리지 설정이 올바르지 않아요.");
  }
  if (origin.protocol !== "http:" || (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost")) {
    throw new Error("브리지는 로컬 주소만 사용할 수 있어요.");
  }
  const response = await fetch(new URL(pathname, origin), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${context.bridgeSecret}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`브리지가 ${response.status} 응답을 반환했어요.`);
  return response;
}

async function bridgePlayers(context: ApiContext): Promise<PlayerDetails[]> {
  const response = await bridgeRequest(context, "/v1/players");
  const body = await response.json() as { players?: PlayerDetails[] };
  if (!Array.isArray(body.players)) throw new Error("브리지의 플레이어 응답이 올바르지 않아요.");
  return body.players;
}

function isLocatorTarget(value: unknown): value is LocatorTargetDetails {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<LocatorTargetDetails>;
  return (target.accountId === null || typeof target.accountId === "string")
    && (target.skinUrl === null || (typeof target.skinUrl === "string"
      && (target.skinUrl.startsWith("/api/skins/") || target.skinUrl.startsWith("/assets/skins/"))
      && !target.skinUrl.includes("..")
      && !target.skinUrl.includes("\\")
      && !target.skinUrl.includes("#")))
    && typeof target.uuid === "string"
    && typeof target.username === "string"
    && typeof target.displayName === "string"
    && typeof target.angle === "number"
    && Number.isFinite(target.angle)
    && typeof target.distance === "number"
    && Number.isFinite(target.distance)
    && target.distance >= 0;
}

function parseLocatorSnapshot(value: unknown): LocatorSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<LocatorSnapshot>;
  if (typeof snapshot.active !== "boolean" || !Array.isArray(snapshot.targets) || !snapshot.targets.every(isLocatorTarget)) {
    return null;
  }
  const state = snapshot.clientState;
  const clientState = state && [state.x, state.y, state.z].every(Number.isFinite)
    && typeof state.mainHand === "string" && typeof state.offHand === "string"
    ? state : undefined;
  return { active: snapshot.active, targets: snapshot.targets, ...(clientState ? { clientState } : {}) };
}

async function bridgeLocators(context: ApiContext): Promise<Map<string, LocatorSnapshot>> {
  const response = await bridgeRequest(context, "/v1/locators", undefined, 1_000);
  const body = await response.json() as { snapshots?: unknown };
  if (!body.snapshots || typeof body.snapshots !== "object" || Array.isArray(body.snapshots)) {
    throw new Error("브리지의 위치 표시 응답이 올바르지 않아요.");
  }
  const entries = Object.entries(body.snapshots);
  if (entries.length > 100) throw new Error("브리지의 위치 표시 응답이 너무 커요.");
  const snapshots = new Map<string, LocatorSnapshot>();
  for (const [accountId, value] of entries) {
    const snapshot = parseLocatorSnapshot(value);
    if (!accountId || !snapshot) throw new Error("브리지의 위치 표시 응답이 올바르지 않아요.");
    snapshots.set(accountId, snapshot);
  }
  return snapshots;
}

async function bridgeSettings(context: ApiContext): Promise<BridgeSettings> {
  const response = await bridgeRequest(context, "/v1/settings");
  const body = await response.json() as Partial<BridgeSettings>;
  if (typeof body.tpaEnabled !== "boolean" || typeof body.keepInventory !== "boolean") {
    throw new Error("브리지의 서버 설정 응답이 올바르지 않아요.");
  }
  return { tpaEnabled: body.tpaEnabled, keepInventory: body.keepInventory };
}

async function updateBridgeSetting(context: ApiContext, setting: "tpa" | "keep-inventory", enabled: boolean): Promise<BridgeSettings> {
  const response = await bridgeRequest(context, `/v1/settings/${setting}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  }, 4_000);
  const body = await response.json() as Partial<BridgeSettings>;
  if (typeof body.tpaEnabled !== "boolean" || typeof body.keepInventory !== "boolean") {
    throw new Error("브리지의 서버 설정 응답이 올바르지 않아요.");
  }
  return { tpaEnabled: body.tpaEnabled, keepInventory: body.keepInventory };
}

async function bridgeTitle(context: ApiContext, request: BridgeTitleRequest): Promise<{ sent: number }> {
  const response = await bridgeRequest(context, "/v1/titles", {
    method: "POST",
    body: JSON.stringify(request),
  }, 4_000);
  const body = await response.json() as { sent?: unknown };
  if (!Number.isInteger(body.sent) || (body.sent as number) < 0) throw new Error("브리지의 타이틀 응답이 올바르지 않아요.");
  return { sent: body.sent as number };
}

function requireServerPassword(request: Request, response: Response, context: ApiContext): boolean {
  if (!context.serverPassword) return true;
  const provided = typeof request.body?.serverPassword === "string" ? request.body.serverPassword : "";
  if (safeSecretEqual(provided, context.serverPassword)) return true;
  fail(response, 401, "서버 비밀번호가 올바르지 않아요.", "INVALID_SERVER_PASSWORD");
  return false;
}

export function createApiRouter(context: ApiContext): express.Router {
  const router = express.Router();
  const authLimiter = new MemoryRateLimiter(12, 10 * 60_000);
  const adminUnlockLimiter = new MemoryRateLimiter(6, 10 * 60_000);
  const passwordResetLimiter = new MemoryRateLimiter(8, PASSWORD_RESET_WINDOW_MS);
  const startLimiter = new MemoryRateLimiter(5, 10 * 60_000);
  const skinLimiter = new MemoryRateLimiter(20, 10 * 60_000);
  const accountLimiter = new MemoryRateLimiter(20, 10 * 60_000);
  const gameTicketLimiter = new MemoryRateLimiter(12, 60_000);
  const gameChatLimiter = new MemoryRateLimiter(8, 5_000);
  // Three tabs polling every two seconds use 900 requests per ten-minute window.
  const adminReadLimiter = new MemoryRateLimiter(ADMIN_OVERVIEW_RATE_LIMIT, ADMIN_OVERVIEW_RATE_WINDOW_MS);
  const adminLimiter = new MemoryRateLimiter(60, 10 * 60_000);
  let locatorCache: { expiresAt: number; snapshots: Map<string, LocatorSnapshot> } | null = null;
  let locatorRequest: Promise<Map<string, LocatorSnapshot>> | null = null;
  const loadLocatorSnapshots = async (): Promise<Map<string, LocatorSnapshot>> => {
    const now = Date.now();
    if (locatorCache && locatorCache.expiresAt > now) return locatorCache.snapshots;
    if (!locatorRequest) {
      locatorRequest = bridgeLocators(context)
        .then((snapshots) => {
          locatorCache = { expiresAt: Date.now() + LOCATOR_BRIDGE_CACHE_MS, snapshots };
          return snapshots;
        })
        .finally(() => { locatorRequest = null; });
    }
    return locatorRequest;
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 256 * 1024,
      files: 1,
      fields: 4,
      fieldNestingDepth: 0,
    } as NonNullable<multer.Options["limits"]> & { fieldNestingDepth: number },
  });

  router.use(express.json({ limit: "32kb" }));
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/bootstrap", async (request, response) => {
    const authenticated = userForRequest(request, context);
    response.json({
      user: authenticated ? publicUser(authenticated.user, context, authenticated.adminExpiresAt) : null,
      csrf: authenticated?.csrf ?? null,
      adminExpiresAt: authenticated?.adminExpiresAt ?? null,
      server: context.serverManager.getStatus(),
      canSpectate: authenticated ? await context.serverManager.getStoredPlayer(authenticated.user).then((player) => player.operator).catch(() => false) : false,
      setup: { eulaAccepted: context.eulaAccepted },
    });
  });

  router.post("/auth/admin-unlock", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!context.adminPassword) {
      fail(response, 503, "관리자 비밀번호가 설정되지 않았어요.", "ADMIN_NOT_CONFIGURED");
      return;
    }
    const limiterKey = requestIp(request);
    if (!safeSecretEqual(request.body?.password, context.adminPassword)) {
      if (!adminUnlockLimiter.take(limiterKey)) {
        fail(response, 429, "관리자 인증 시도가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
        return;
      }
      fail(response, 401, "비밀번호가 올바르지 않아요.", "INVALID_ADMIN_PASSWORD");
      return;
    }
    adminUnlockLimiter.reset(limiterKey);
    const authenticated = userForRequest(request, context);
    const user = authenticated?.user ?? STANDALONE_ADMIN;
    const admin = createAdminToken(user, context.sessionSecret, ADMIN_UNLOCK_MINUTES);
    setAdminCookie(response, admin.token, ADMIN_UNLOCK_MINUTES, context.secureCookies);
    response.json({
      user: authenticated
        ? publicUser(authenticated.user, context, admin.expiresAt)
        : standaloneAdminPublicUser(),
      csrf: authenticated?.csrf ?? admin.csrf,
      adminExpiresAt: admin.expiresAt,
      standalone: !authenticated,
    });
  });

  router.post("/auth/admin-lock", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const authenticated = userForRequest(request, context);
    if (!authenticated) {
      fail(response, 401, "먼저 로그인하세요.", "AUTH_REQUIRED");
      return;
    }
    if (!requireCsrf(request, response, authenticated.csrf)) return;
    clearAdminCookie(response, context.secureCookies);
    response.json({ user: publicUser(authenticated.user, context), csrf: authenticated.csrf, adminExpiresAt: null });
  });

  router.get("/auth/username-availability", (request, response) => {
    try {
      const username = validateUsername(request.query.username);
      const user = context.database.getUserByUsername(username);
      response.json({
        available: user === null && !isAdminUsername(username, context),
        exists: user !== null,
        resetRequired: user ? hasActivePasswordReset(user) : false,
      });
    } catch (error) {
      failFromError(response, 400, error, "플레이어 이름을 확인할 수 없어요.", "INVALID_USERNAME");
    }
  });

  router.get("/server/status", (_request, response) => {
    response.json({ server: context.serverManager.getStatus() });
  });

  router.get("/internal/game-identities", (request, response) => {
    if (!safeSecretEqual(request.get("authorization"), `Bearer ${context.sessionSecret}`)) {
      fail(response, 401, "브리지 인증이 올바르지 않아요.", "BRIDGE_AUTH_REQUIRED");
      return;
    }
    response.json({
      identities: context.database.listUsers().map((user) => ({
        displayName: user.displayName,
        gameUsername: user.gameUsername,
      })),
    });
  });

  router.post("/internal/player-history", (request, response) => {
    if (!safeSecretEqual(request.get("authorization"), `Bearer ${context.sessionSecret}`)) {
      fail(response, 401, "브리지 인증이 올바르지 않아요.", "BRIDGE_AUTH_REQUIRED");
      return;
    }
    let event: BridgeHistoryEvent;
    try {
      event = validateBridgeHistoryEvent(request.body);
    } catch (error) {
      failFromError(response, 400, error, "기록 이벤트가 올바르지 않아요.", "INVALID_HISTORY_EVENT");
      return;
    }
    try {
      const user = event.accountId
        ? context.database.getUserById(event.accountId)
        : context.database.getUserByGameUsername(event.gameUsername);
      const accountId = user?.id ?? event.accountId;
      if (event.type === "join") {
        if (accountId) context.history.markPlayerJoined(accountId, event.occurredAt);
      } else if (event.type === "quit") {
        if (accountId) context.history.markPlayerLeft(accountId, event.occurredAt);
      } else {
        const recipientUser = event.recipientGameUsername
          ? context.database.getUserByGameUsername(event.recipientGameUsername)
          : null;
        context.history.recordChat({
          eventId: event.eventId,
          occurredAt: event.occurredAt,
          accountId,
          uuid: event.uuid,
          gameUsername: user?.gameUsername ?? event.gameUsername,
          displayName: user?.displayName ?? event.displayName,
          channel: event.type === "whisper" ? "whisper" : "public",
          recipientAccountId: recipientUser?.id ?? null,
          recipientUuid: event.recipientUuid,
          recipientGameUsername: recipientUser?.gameUsername ?? event.recipientGameUsername,
          recipientDisplayName: recipientUser?.displayName ?? event.recipientDisplayName,
          message: event.message!,
        });
      }
    } catch (error) {
      failFromError(response, 500, error, "기록 이벤트를 저장하지 못했어요.", "HISTORY_WRITE_FAILED");
      return;
    }
    response.status(204).end();
  });

  router.get("/server/players", (request, response) => {
    if (!requireUser(request, response, context)) return;
    const players = context.serverManager.getStatus().players.map((gameUsername) => {
      const user = context.database.getUserByGameUsername(gameUsername);
      return { gameUsername, displayName: user?.displayName ?? gameUsername };
    });
    response.json({ players });
  });

  router.get("/game/players", (request, response) => {
    const user = requireUser(request, response, context);
    if (!user) return;
    const players = context.serverManager.getStatus().players.flatMap((gameUsername) => {
      if (gameUsername === user.gameUsername) return [];
      const playerUser = context.database.getUserByGameUsername(gameUsername);
      return [{ gameUsername, displayName: playerUser?.displayName ?? gameUsername }];
    });
    response.json({ players });
  });

  router.post("/game/chat", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context);
    if (!user) return;
    const launchId = request.body?.launchId;
    if (!isLaunchId(launchId)) {
      fail(response, 400, "클라이언트 실행 ID가 올바르지 않아요.", "BAD_LAUNCH_ID");
      return;
    }
    if (!context.gameConnections.isActive(launchId, user.id)) {
      fail(response, 409, "게임에 접속한 뒤 채팅을 보내세요.", "GAME_NOT_CONNECTED");
      return;
    }
    let message: string;
    try {
      message = validateGameChatMessage(request.body?.message);
    } catch (error) {
      failFromError(response, 400, error, "채팅 내용을 확인하세요.", "INVALID_CHAT");
      return;
    }
    if (!gameChatLimiter.take(user.id)) {
      fail(response, 429, "채팅을 너무 빠르게 보내고 있어요.", "RATE_LIMITED");
      return;
    }
    try {
      const bridgeResponse = await bridgeRequest(context, `/v1/chat/${encodeURIComponent(user.id)}`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      const result = await bridgeResponse.json() as { sent?: boolean; command?: boolean };
      if (result.sent !== true || typeof result.command !== "boolean") throw new Error("브리지의 채팅 응답이 올바르지 않아요.");
      response.json({ sent: true, command: result.command });
    } catch (error) {
      failFromError(response, 503, error, "채팅을 보내지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.get("/server/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    const send = () => response.write(`data: ${JSON.stringify(context.serverManager.getStatus())}\n\n`);
    const ping = setInterval(() => response.write(": ping\n\n"), 20_000);
    const statusListener = () => send();
    context.serverManager.on("status", statusListener);
    send();
    request.on("close", () => {
      clearInterval(ping);
      context.serverManager.off("status", statusListener);
    });
  });

  router.post("/server/start", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!startLimiter.take(user.id)) {
      fail(response, 429, "서버 시작 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const server = await context.serverManager.start();
      response.status(202).json({ server });
    } catch (error) {
      if (error instanceof ServerStartError) {
        const status = error.code === "EULA_REQUIRED" ? 412 : error.code === "COOLDOWN" ? 429 : 503;
        fail(response, status, error.message, error.code);
        return;
      }
      throw error;
    }
  });

  router.post("/auth/register", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    if (!requireServerPassword(request, response, context)) return;
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      validateNewPassword(credentials.password);
      if (isAdminUsername(credentials.username, context) && !context.database.getUserByUsername(credentials.username)) {
        fail(response, 403, "관리자용 플레이어 이름은 새로 등록할 수 없어요.", "RESERVED_USERNAME");
        return;
      }
      if (context.database.getUserByUsername(credentials.username)) {
        fail(response, 409, "이미 등록된 플레이어 이름이에요.", "USERNAME_TAKEN");
        return;
      }
      const password = await hashPassword(credentials.password);
      let user: UserRecord;
      try {
        user = context.database.createUser(credentials.username, password.hash, password.salt);
      } catch {
        fail(response, 409, "이미 등록된 플레이어 이름이에요.", "USERNAME_TAKEN");
        return;
      }
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.status(201).json({ user: publicUser(user, context), csrf: session.csrf, created: true });
    } catch (error) {
      failFromError(response, 400, error, "회원가입에 실패했어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/login", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      let user = context.database.getUserByUsername(credentials.username);
      if (user && hasActivePasswordReset(user)) {
        fail(response, 409, "새 비밀번호를 설정해 로그인하세요.", "PASSWORD_RESET_REQUIRED");
        return;
      }
      if (user && (user.passwordResetDigest !== null || user.passwordResetExpiresAt !== null)) {
        context.database.clearPasswordReset(user.id);
      }
      const valid = user ? await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash) : false;
      if (!user || !valid) {
        fail(response, 401, "플레이어 이름 또는 비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
        return;
      }
      user = context.database.recordLogin(user.id);
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: publicUser(user, context), csrf: session.csrf, created: false });
    } catch (error) {
      failFromError(response, 400, error, "로그인에 실패했어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/continue", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!authLimiter.take(requestIp(request))) {
      fail(response, 429, "시도 횟수가 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const credentials = validateCredentials(request.body?.username, request.body?.password);
      let user = context.database.getUserByUsername(credentials.username);
      let created = false;

      if (user && hasActivePasswordReset(user)) {
        validateNewPassword(credentials.password);
        const resetDigest = user.passwordResetDigest!;
        if (!passwordResetLimiter.take(resetDigest.toString("base64url"))) {
          fail(response, 429, "초기화 코드 확인 요청이 너무 많아요. 새 코드를 발급하세요.", "RATE_LIMITED");
          return;
        }
        if (!verifyPasswordResetCode(request.body?.serverPassword, context.sessionSecret, resetDigest)) {
          fail(response, 401, "플레이어 이름 또는 인증 정보가 올바르지 않아요.", "INVALID_LOGIN");
          return;
        }
        const password = await hashPassword(credentials.password);
        user = context.database.completePasswordReset(
          user.id,
          resetDigest,
          password.hash,
          password.salt,
          Date.now(),
        );
        if (!user) {
          fail(response, 401, "플레이어 이름 또는 인증 정보가 올바르지 않아요.", "INVALID_LOGIN");
          return;
        }
      } else {
        if (user && (user.passwordResetDigest !== null || user.passwordResetExpiresAt !== null)) {
          context.database.clearPasswordReset(user.id);
        }
        if (!requireServerPassword(request, response, context)) return;
        if (user) {
          const valid = await verifyPassword(credentials.password, user.passwordSalt, user.passwordHash);
          if (!valid) {
            fail(response, 401, "비밀번호가 올바르지 않아요.", "INVALID_LOGIN");
            return;
          }
        } else {
          if (isAdminUsername(credentials.username, context)) {
            fail(response, 403, "관리자용 플레이어 이름은 새로 등록할 수 없어요.", "RESERVED_USERNAME");
            return;
          }
          const password = await hashPassword(validateNewPassword(credentials.password));
          try {
            user = context.database.createUser(credentials.username, password.hash, password.salt);
            created = true;
          } catch {
            fail(response, 409, "플레이어 이름이 방금 등록됐어요. 다시 시도하세요.", "USERNAME_TAKEN");
            return;
          }
        }
      }

      if (!created) user = context.database.recordLogin(user.id);
      const session = createSessionToken(user, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({ user: publicUser(user, context), csrf: session.csrf, created });
    } catch (error) {
      failFromError(response, 400, error, "계속할 수 없어요.", "INVALID_CREDENTIALS");
    }
  });

  router.post("/auth/logout", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    if (!requireUser(request, response, context, true)) return;
    clearSessionCookie(response, context.secureCookies);
    clearAdminCookie(response, context.secureCookies);
    response.status(204).end();
  });

  router.patch("/account/profile", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const authenticated = requireAuthentication(request, response, context, true);
    if (!authenticated) return;
    const { user } = authenticated;
    if (!accountLimiter.take(`${user.id}:profile`)) {
      fail(response, 429, "계정 변경 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const username = request.body?.username === undefined ? user.username : validateUsername(request.body.username);
      if (isAdmin(user, context) && !isAdminId(user.id, context) && !isAdminUsername(username, context)) {
        fail(response, 400, "관리자 플레이어 이름은 서버 설정과 함께 변경해야 해요.", "ADMIN_USERNAME_FIXED");
        return;
      }
      if (isAdminUsername(username, context) && !isAdmin(user, context)) {
        fail(response, 403, "관리자용 플레이어 이름으로 변경할 수 없어요.", "RESERVED_USERNAME");
        return;
      }
      const owner = context.database.getUserByUsername(username);
      if (owner && owner.id !== user.id) {
        fail(response, 409, "이미 등록된 플레이어 이름이에요.", "USERNAME_TAKEN");
        return;
      }
      const updated = context.database.updateIdentity(user.id, username);
      const session = createSessionToken(updated, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      response.json({
        user: publicUser(updated, context, authenticated.adminExpiresAt),
        csrf: session.csrf,
        adminExpiresAt: authenticated.adminExpiresAt,
      });
    } catch (error) {
      failFromError(response, 400, error, "계정 정보를 변경하지 못했어요.", "INVALID_PROFILE");
    }
  });

  router.post("/account/password", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!accountLimiter.take(`${user.id}:password`)) {
      fail(response, 429, "비밀번호 변경 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const currentPassword = validatePassword(request.body?.currentPassword);
      const newPassword = validateNewPassword(request.body?.newPassword);
      if (!await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) {
        fail(response, 401, "현재 비밀번호가 올바르지 않아요.", "INVALID_CURRENT_PASSWORD");
        return;
      }
      const password = await hashPassword(newPassword);
      const updated = context.database.updatePassword(user.id, password.hash, password.salt);
      const session = createSessionToken(updated, context.sessionSecret, context.sessionDays);
      setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
      clearAdminCookie(response, context.secureCookies);
      response.json({ user: publicUser(updated, context), csrf: session.csrf, adminExpiresAt: null });
    } catch (error) {
      failFromError(response, 400, error, "비밀번호를 변경하지 못했어요.", "INVALID_PASSWORD");
    }
  });

  router.put("/account/resource-pack", (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!accountLimiter.take(`${user.id}:resource-pack`)) {
      fail(response, 429, "리소스팩 변경 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    const resourcePackPreference = request.body?.resourcePackPreference as unknown;
    if (resourcePackPreference !== "new-default" && resourcePackPreference !== "programmer-art") {
      fail(response, 400, "리소스팩 선택이 올바르지 않아요.", "INVALID_RESOURCE_PACK");
      return;
    }
    const updated = context.database.updateResourcePack(user.id, resourcePackPreference as ResourcePackPreference);
    response.json({ resourcePackPreference: updated.resourcePackPreference });
  });

  router.get("/skin/catalog", (request, response) => {
    if (!requireUser(request, response, context)) return;
    const skins = SKIN_CATALOG.flatMap((category) => category.skins);
    const skinIds = new Set(skins.map((skin) => skin.id));
    const skinIdByLabel = new Map(skins.map((skin) => [skin.label, skin.id]));
    const usersBySkinId = new Map<string, Array<{ id: string; displayName: string }>>();
    for (const user of context.database.listSkinSelections()) {
      const skinId = skinIds.has(user.skinRef)
        ? user.skinRef
        : user.skinType === "upload" && user.skinRef === user.id
          ? skinIdByLabel.get(user.skinLabel)
          : undefined;
      if (!skinId) continue;
      const users = usersBySkinId.get(skinId) ?? [];
      users.push({ id: user.id, displayName: user.displayName });
      usersBySkinId.set(skinId, users);
    }
    response.json({
      categories: SKIN_CATALOG.map((category) => ({
        ...category,
        skins: category.skins.map((skin) => ({ ...skin, usedBy: usersBySkinId.get(skin.id) ?? [] })),
      })),
    });
  });

  router.get("/skin/catalog/:skinId.png", async (request, response) => {
    const texture = context.skins.catalogTexture(request.params.skinId);
    if (!texture) {
      response.status(404).end();
      return;
    }
    try {
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      response.send(await texture);
    } catch {
      fail(response, 502, "스킨 텍스처를 불러오지 못했어요.", "SKIN_TEXTURE_UNAVAILABLE");
    }
  });

  router.post("/skin/upload", upload.single("skin"), async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:upload`)) {
      fail(response, 429, "스킨 변경 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyUpload(user, request.file);
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "스킨 업로드에 실패했어요.");
    }
  });

  router.post("/skin/fetch", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:fetch`)) {
      fail(response, 429, "스킨 검색 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyMinecraftUsername(user, request.body?.username);
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "스킨을 찾지 못했어요.");
    }
  });

  router.post("/skin/catalog", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    if (!skinLimiter.take(`${user.id}:catalog`)) {
      fail(response, 429, "스킨 변경 요청이 너무 많아요. 몇 분 뒤 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const updated = await context.skins.applyCatalogSkin(user, request.body?.skinId);
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "스킨을 적용하지 못했어요.");
    }
  });

  router.get("/skins/:id.png", (request, response) => {
    const skinFile = context.skins.skinFile(request.params.id);
    if (!skinFile || !fs.existsSync(skinFile)) {
      response.status(404).end();
      return;
    }
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    response.sendFile(skinFile);
  });

  router.get("/game/locator", async (request, response) => {
    const user = requireUser(request, response, context);
    if (!user) return;
    if (context.serverManager.getStatus().phase !== "online") {
      response.json({ active: false, targets: [] });
      return;
    }
    try {
      const locator = (await loadLocatorSnapshots()).get(user.id) ?? { active: false, targets: [] };
      const targets = locator.targets.flatMap((target) => {
        if (!target.accountId || !target.skinUrl) return [];
        return [{
          id: target.uuid,
          displayName: target.displayName,
          angle: target.angle,
          distance: target.distance,
          skinUrl: target.skinUrl,
        }];
      });
      response.json({ active: locator.active, targets, ...(locator.clientState ? { clientState: locator.clientState } : {}) });
    } catch (error) {
      failFromError(response, 503, error, "위치 표시 정보를 불러오지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.get("/admin/overview", async (request, response) => {
    const admin = requireAdmin(request, response, context);
    if (!admin) return;
    if (!adminReadLimiter.take(`${admin.id}:overview`)) {
      fail(response, 429, "관리자 새로고침 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const server = context.serverManager.getStatus();
      const users = context.database.listUsers().map((user) => ({
        ...user,
        skin: (() => {
          const record = context.database.getUserById(user.id);
          return record ? publicUser(record, context).skin : undefined;
        })(),
        resetRequired: user.passwordResetPending
          && user.passwordResetExpiresAt !== null
          && user.passwordResetExpiresAt > Date.now(),
        isAdmin: isAdminId(user.id, context) || isAdminUsername(user.username, context),
      }));
      const [storedSettings, storedPlayers] = await Promise.all([
        context.serverManager.getServerSettings(),
        context.serverManager.getStoredPlayers(users),
      ]);
      const [playersResult, bridgeSettingsResult] = server.phase === "online"
        ? await Promise.allSettled([bridgePlayers(context), bridgeSettings(context)])
        : [
            { status: "fulfilled", value: [] } as const,
            { status: "rejected", reason: new Error("server offline") } as const,
          ];
      const livePlayers = playersResult.status === "fulfilled" ? playersResult.value : [];
      const liveByAccount = new Map(livePlayers.flatMap((player) => player.accountId ? [[player.accountId, player] as const] : []));
      const liveByUsername = new Map(livePlayers.map((player) => [player.username.toLowerCase(), player] as const));
      const matchedLivePlayers = new Set<PlayerDetails>();
      const players = storedPlayers.map((stored) => {
        const live = (stored.accountId ? liveByAccount.get(stored.accountId) : null)
          ?? liveByUsername.get(stored.username.toLowerCase());
        if (!live) return stored;
        matchedLivePlayers.add(live);
        return { ...stored, ...live, online: true, dataAvailable: true };
      });
      for (const live of livePlayers) {
        if (!matchedLivePlayers.has(live)) players.push(live);
      }
      const settings = bridgeSettingsResult.status === "fulfilled"
        ? {
            ...storedSettings,
            tpaEnabled: bridgeSettingsResult.value.tpaEnabled,
            keepInventory: bridgeSettingsResult.value.keepInventory,
          }
        : storedSettings;
      response.json({
        users,
        players,
        bridgeAvailable: server.phase === "online" && playersResult.status === "fulfilled",
        tpaEnabled: settings.tpaEnabled,
        settings,
        server,
      });
    } catch (error) {
      failFromError(response, 500, error, "관리자 정보를 불러오지 못했어요.", "ADMIN_OVERVIEW_FAILED");
    }
  });

  router.get("/admin/logs", async (request, response) => {
    const admin = requireAdmin(request, response, context);
    if (!admin) return;
    if (!adminReadLimiter.take(`${admin.id}:logs`)) {
      fail(response, 429, "로그 새로고침 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    let query: string;
    let offset: number;
    try {
      query = validateLogSearch(request.query.q);
      offset = validateLogOffset(request.query.offset);
    } catch (error) {
      failFromError(response, 400, error, "로그를 불러오지 못했어요.", "INVALID_LOG_QUERY");
      return;
    }
    try {
      response.json(await context.serverManager.getLogHistory({ query, offset, limit: 500 }));
    } catch (error) {
      failFromError(response, 500, error, "저장된 로그를 읽지 못했어요.", "LOG_READ_FAILED");
    }
  });

  router.get("/admin/history/access", (request, response) => {
    const admin = requireAdmin(request, response, context);
    if (!admin) return;
    if (!adminReadLimiter.take(`${admin.id}:history-access`)) {
      fail(response, 429, "접속 기록 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    let query: HistoryQuery;
    try {
      query = validateHistoryQuery(request.query);
    } catch (error) {
      failFromError(response, 400, error, "접속 기록 조건을 확인하세요.", "INVALID_HISTORY_QUERY");
      return;
    }
    try {
      const page = context.history.listAccessHistory(query);
      response.json({
        ...page,
        entries: page.entries.map((entry) => {
          const user = context.database.getUserById(entry.accountId);
          return {
            ...entry,
            skinUrl: user ? publicUser(user, context).skin.previewUrl : "/assets/skins/steve.png?v=texture-v2",
          };
        }),
      });
    } catch (error) {
      failFromError(response, 500, error, "접속 기록을 불러오지 못했어요.", "HISTORY_READ_FAILED");
    }
  });

  router.get("/admin/history/chats", (request, response) => {
    const admin = requireAdmin(request, response, context);
    if (!admin) return;
    if (!adminReadLimiter.take(`${admin.id}:history-chats`)) {
      fail(response, 429, "채팅 기록 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    let query: HistoryQuery;
    try {
      query = validateHistoryQuery(request.query);
    } catch (error) {
      failFromError(response, 400, error, "채팅 기록 조건을 확인하세요.", "INVALID_HISTORY_QUERY");
      return;
    }
    try {
      const page = context.history.listChatHistory(query);
      response.json({
        ...page,
        entries: page.entries.map((entry) => {
          const user = entry.accountId ? context.database.getUserById(entry.accountId) : null;
          const recipient = entry.recipientAccountId ? context.database.getUserById(entry.recipientAccountId) : null;
          return {
            ...entry,
            skinUrl: user ? publicUser(user, context).skin.previewUrl : "/assets/skins/steve.png?v=texture-v2",
            recipientSkinUrl: recipient ? publicUser(recipient, context).skin.previewUrl : null,
          };
        }),
      });
    } catch (error) {
      failFromError(response, 500, error, "채팅 기록을 불러오지 못했어요.", "HISTORY_READ_FAILED");
    }
  });

  router.get("/admin/history/logs", (request, response) => {
    const admin = requireAdmin(request, response, context);
    if (!admin) return;
    if (!adminReadLimiter.take(`${admin.id}:history-logs`)) {
      fail(response, 429, "서버 로그 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    let query: HistoryQuery;
    try {
      query = validateHistoryQuery(request.query);
    } catch (error) {
      failFromError(response, 400, error, "서버 로그 조건을 확인하세요.", "INVALID_HISTORY_QUERY");
      return;
    }
    try {
      response.json(context.history.listServerLogs(query));
    } catch (error) {
      failFromError(response, 500, error, "서버 로그를 불러오지 못했어요.", "HISTORY_READ_FAILED");
    }
  });

  router.put("/admin/settings/server", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    let requested: ServerSettings;
    try {
      requested = validateServerSettings(request.body);
    } catch (error) {
      failFromError(response, 400, error, "서버 설정을 확인하세요.", "INVALID_SERVER_SETTINGS");
      return;
    }
    try {
      const previous = await context.serverManager.getServerSettings();
      const settings = await context.serverManager.updateServerSettings(requested);
      const serverOnline = context.serverManager.getStatus().phase === "online";
      let liveApplied = true;
      if (serverOnline) {
        const liveUpdates: Promise<BridgeSettings>[] = [];
        if (previous.tpaEnabled !== settings.tpaEnabled) {
          liveUpdates.push(updateBridgeSetting(context, "tpa", settings.tpaEnabled));
        }
        if (previous.keepInventory !== settings.keepInventory) {
          liveUpdates.push(updateBridgeSetting(context, "keep-inventory", settings.keepInventory));
        }
        if (liveUpdates.length) {
          const results = await Promise.allSettled(liveUpdates);
          liveApplied = results.every((result) => result.status === "fulfilled");
        }
      }
      response.json({
        settings,
        restartRequired: serverOnline && (serverSettingsRequireRestart(previous, settings) || !liveApplied),
        liveApplied,
      });
    } catch (error) {
      failFromError(response, 500, error, "서버 설정을 저장하지 못했어요.", "SETTING_UPDATE_FAILED");
    }
  });

  router.post("/admin/console", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    let command: string;
    try {
      command = validateConsoleCommand(request.body?.command);
    } catch (error) {
      failFromError(response, 400, error, "콘솔 명령을 확인하세요.", "INVALID_CONSOLE_COMMAND");
      return;
    }
    try {
      await context.serverManager.sendCommand(command);
      response.status(204).end();
    } catch (error) {
      failFromError(response, 409, error, "콘솔 명령을 실행하지 못했어요.", "CONSOLE_UNAVAILABLE");
    }
  });

  router.post("/admin/title", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    if (context.serverManager.getStatus().phase !== "online") {
      fail(response, 409, "서버가 온라인일 때만 타이틀을 띄울 수 있어요.", "SERVER_OFFLINE");
      return;
    }
    let titleRequest: BridgeTitleRequest;
    try {
      titleRequest = validateTitleRequest(request.body);
    } catch (error) {
      failFromError(response, 400, error, "타이틀 설정을 확인하세요.", "INVALID_TITLE");
      return;
    }
    try {
      const result = await bridgeTitle(context, titleRequest);
      if (result.sent === 0) {
        fail(response, 409, "타이틀을 받을 온라인 사용자가 없어요.", "NO_TITLE_RECIPIENTS");
        return;
      }
      response.json(result);
    } catch (error) {
      failFromError(response, 503, error, "타이틀을 띄우지 못했어요.", "BRIDGE_UNAVAILABLE");
    }
  });

  router.patch("/admin/users/:id/profile", (request, response) => {
    const authorization = requireAdminMutation(request, response, context, adminLimiter);
    if (!authorization) return;
    const { admin, authenticated } = authorization;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    try {
      const username = request.body?.username === undefined ? target.username : validateUsername(request.body.username);
      if (target.id === admin.id && isAdmin(admin, context) && !isAdminId(admin.id, context) && !isAdminUsername(username, context)) {
        fail(response, 400, "관리자 플레이어 이름은 서버 설정과 함께 변경해야 해요.", "ADMIN_USERNAME_FIXED");
        return;
      }
      if (isAdminUsername(username, context) && !isAdmin(target, context)) {
        fail(response, 403, "관리자용 플레이어 이름으로 변경할 수 없어요.", "RESERVED_USERNAME");
        return;
      }
      const owner = context.database.getUserByUsername(username);
      if (owner && owner.id !== target.id) {
        fail(response, 409, "이미 등록된 플레이어 이름이에요.", "USERNAME_TAKEN");
        return;
      }
      const updated = context.database.updateIdentity(target.id, username);
      if (updated.id === admin.id) {
        if (authenticated) {
          const session = createSessionToken(updated, context.sessionSecret, context.sessionDays);
          setSessionCookie(response, session.token, context.sessionDays, context.secureCookies);
          response.json({
            user: publicUser(updated, context, authenticated.adminExpiresAt),
            csrf: session.csrf,
            adminExpiresAt: authenticated.adminExpiresAt,
          });
        } else {
          const standaloneAdmin = createAdminToken(updated, context.sessionSecret, ADMIN_UNLOCK_MINUTES);
          setAdminCookie(response, standaloneAdmin.token, ADMIN_UNLOCK_MINUTES, context.secureCookies);
          response.json({
            user: publicUser(updated, context, standaloneAdmin.expiresAt),
            csrf: standaloneAdmin.csrf,
            adminExpiresAt: standaloneAdmin.expiresAt,
          });
        }
        return;
      }
      response.json({ user: publicUser(updated, context) });
    } catch (error) {
      failFromError(response, 400, error, "사용자 정보를 변경하지 못했어요.", "INVALID_PROFILE");
    }
  });

  router.put("/admin/users/:id/archive", (request, response) => {
    const authorization = requireAdminMutation(request, response, context, adminLimiter);
    if (!authorization) return;
    const { admin } = authorization;
    const archived = request.body?.archived;
    if (typeof archived !== "boolean") {
      fail(response, 400, "보관 설정을 확인하세요.", "INVALID_ARCHIVE_STATE");
      return;
    }
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    if (archived && target.id === admin.id) {
      fail(response, 400, "내 계정은 보관할 수 없어요.", "SELF_ARCHIVE_NOT_ALLOWED");
      return;
    }
    if (archived && context.serverManager.isPlayerOnline(target.gameUsername)) {
      fail(response, 409, "게임에 접속 중인 사용자는 보관할 수 없어요.", "PLAYER_ONLINE");
      return;
    }
    const updated = context.database.setUserArchived(target.id, archived);
    response.json({ archived: updated.archivedAt !== null });
  });

  router.post("/admin/users/:id/password-reset", async (request, response) => {
    const authorization = requireAdminMutation(request, response, context, adminLimiter);
    if (!authorization) return;
    const { admin } = authorization;
    if (admin.id === request.params.id) {
      fail(response, 400, "내 비밀번호는 계정 설정에서 변경하세요.", "SELF_RESET_NOT_ALLOWED");
      return;
    }
    if (!context.database.getUserById(request.params.id)) {
      fail(response, 404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    const reset = createPasswordResetCode(context.sessionSecret);
    const updated = context.database.requestPasswordReset(
      request.params.id,
      reset.digest,
      Date.now() + PASSWORD_RESET_WINDOW_MS,
    );
    context.gameConnections.disconnectUser(updated.id);
    try {
      await bridgeRequest(context, `/v1/players/${encodeURIComponent(updated.id)}/disconnect`, { method: "POST" });
    } catch {
      // Reset issuance and web-session revocation must succeed while Minecraft is asleep or unavailable.
    }
    response.json({
      resetCode: reset.code,
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        passwordResetExpiresAt: updated.passwordResetExpiresAt,
        resetRequired: true,
      },
    });
  });

  router.post("/admin/users/:id/temporary-password", async (request, response) => {
    const authorization = requireAdminMutation(request, response, context, adminLimiter);
    if (!authorization) return;
    if (authorization.admin.id === request.params.id) {
      fail(response, 400, "내 비밀번호는 계정 설정에서 변경하세요.", "SELF_RESET_NOT_ALLOWED");
      return;
    }
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    try {
      const temporaryPassword = createTemporaryPassword();
      const password = await hashPassword(temporaryPassword);
      const updated = context.database.updatePassword(target.id, password.hash, password.salt);
      context.gameConnections.disconnectUser(updated.id);
      try {
        await bridgeRequest(context, `/v1/players/${encodeURIComponent(updated.id)}/disconnect`, { method: "POST" });
      } catch {
        // Password replacement must also work while Minecraft is asleep or unavailable.
      }
      response.json({
        temporaryPassword,
        user: {
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
          passwordUpdatedAt: updated.passwordUpdatedAt,
        },
      });
    } catch (error) {
      failFromError(response, 500, error, "임시 비밀번호를 만들지 못했어요.", "PASSWORD_UPDATE_FAILED");
    }
  });

  router.patch("/admin/players/:id/state", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "플레이어를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    let patch: PlayerStatePatch;
    try {
      patch = validatePlayerStatePatch(request.body);
    } catch (error) {
      failFromError(response, 400, error, "플레이어 상태를 확인하세요.", "INVALID_PLAYER_STATE");
      return;
    }
    try {
      if (context.serverManager.isPlayerOnline(target.gameUsername)) {
        const bridgeResponse = await bridgeRequest(context, `/v1/players/${encodeURIComponent(target.gameUsername)}/state`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }, 4_000);
        response.json({ player: await bridgeResponse.json() });
      } else {
        response.json({ player: await context.serverManager.updateStoredPlayerState(target, patch) });
      }
    } catch (error) {
      failFromError(response, 409, error, "플레이어 상태를 변경하지 못했어요.", "PLAYER_UPDATE_FAILED");
    }
  });

  router.put("/admin/players/:id/inventory", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "플레이어를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    let patch: PlayerInventoryPatch;
    try {
      patch = validateInventoryPatch(request.body);
    } catch (error) {
      failFromError(response, 400, error, "아이템 변경 값을 확인하세요.", "INVALID_INVENTORY_UPDATE");
      return;
    }
    try {
      if (context.serverManager.isPlayerOnline(target.gameUsername)) {
        const bridgeResponse = await bridgeRequest(context, `/v1/players/${encodeURIComponent(target.gameUsername)}/inventory`, {
          method: "PUT",
          body: JSON.stringify(patch),
        }, 4_000);
        response.json({ player: await bridgeResponse.json() });
      } else {
        response.json({ player: await context.serverManager.updateStoredPlayerInventory(target, patch) });
      }
    } catch (error) {
      failFromError(response, 409, error, "아이템을 변경하지 못했어요.", "INVENTORY_UPDATE_FAILED");
    }
  });

  router.post("/admin/players/:id/kick", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "플레이어를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    if (!context.serverManager.isPlayerOnline(target.gameUsername)) {
      fail(response, 409, "온라인 플레이어만 내보낼 수 있어요.", "PLAYER_OFFLINE");
      return;
    }
    let reason: string;
    try {
      reason = validateAdminReason(request.body?.reason, "관리자가 서버에서 내보냈습니다.");
    } catch (error) {
      failFromError(response, 400, error, "사유가 올바르지 않아요.", "INVALID_KICK_REASON");
      return;
    }
    try {
      const bridgeResponse = await bridgeRequest(context, `/v1/players/${encodeURIComponent(target.gameUsername)}/kick`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }, 4_000);
      response.json(await bridgeResponse.json());
    } catch (error) {
      failFromError(response, 409, error, "플레이어를 내보내지 못했어요.", "KICK_FAILED");
    }
  });

  router.put("/admin/players/:id/ban", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "플레이어를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    if (typeof request.body?.banned !== "boolean") {
      fail(response, 400, "차단 상태가 올바르지 않아요.", "INVALID_BAN_STATE");
      return;
    }
    let reason: string;
    try {
      reason = validateAdminReason(request.body?.reason, "관리자가 차단했습니다.");
    } catch (error) {
      failFromError(response, 400, error, "사유가 올바르지 않아요.", "INVALID_BAN_REASON");
      return;
    }
    try {
      if (context.serverManager.isPlayerOnline(target.gameUsername)) {
        const bridgeResponse = await bridgeRequest(context, `/v1/players/${encodeURIComponent(target.gameUsername)}/ban`, {
          method: "PUT",
          body: JSON.stringify({ banned: request.body.banned, reason }),
        }, 4_000);
        response.json({ player: await bridgeResponse.json() });
      } else {
        response.json({ player: await context.serverManager.setStoredPlayerBanned(target, request.body.banned, reason) });
      }
    } catch (error) {
      failFromError(response, 409, error, "차단 상태를 변경하지 못했어요.", "BAN_UPDATE_FAILED");
    }
  });

  router.put("/admin/players/:id/operator", async (request, response) => {
    if (!requireAdminMutation(request, response, context, adminLimiter)) return;
    const target = context.database.getUserById(request.params.id);
    if (!target) {
      fail(response, 404, "플레이어를 찾을 수 없어요.", "USER_NOT_FOUND");
      return;
    }
    if (typeof request.body?.operator !== "boolean") {
      fail(response, 400, "OP 상태를 선택하세요.", "INVALID_OPERATOR_REQUEST");
      return;
    }
    try {
      if (context.serverManager.isPlayerOnline(target.gameUsername)) {
        const bridgeResponse = await bridgeRequest(context, `/v1/players/${encodeURIComponent(target.gameUsername)}/operator`, {
          method: "PUT",
          body: JSON.stringify({ operator: request.body.operator }),
        });
        response.json({ player: await bridgeResponse.json() });
      } else {
        response.json({ player: await context.serverManager.setStoredPlayerOperator(target, request.body.operator) });
      }
    } catch (error) {
      failFromError(response, 409, error, "OP 상태를 변경하지 못했어요.", "OP_UPDATE_FAILED");
    }
  });

  router.post("/game-ticket", async (request, response) => {
    if (!requireSameOrigin(request, response)) return;
    const user = requireUser(request, response, context, true);
    if (!user) return;
    const status = context.serverManager.getStatus();
    const modernStarting = status.version === "Paper 26.2" && ["preparing", "starting"].includes(status.phase);
    if (status.phase !== "online" && !modernStarting) {
      fail(response, 409, "클라이언트를 실행하기 전에 서버를 시작하세요.", "SERVER_OFFLINE");
      return;
    }
    const launchId = request.body?.launchId;
    if (!isLaunchId(launchId)) {
      fail(response, 400, "클라이언트 실행 ID가 올바르지 않아요.", "BAD_LAUNCH_ID");
      return;
    }
    // Eagler's shared-IP login cap is disabled because a whole school can use
    // one NAT address. Limit authenticated launch creation per account instead;
    // each launch ID also has a bounded number of gateway retries.
    if (!gameTicketLimiter.take(user.id)) {
      fail(response, 429, "게임 실행 요청이 너무 많아요. 잠시 후 다시 시도하세요.", "RATE_LIMITED");
      return;
    }
    try {
      const spectator = request.body?.spectator === true;
      if (spectator && !(await context.serverManager.getStoredPlayer(user)).operator) {
        fail(response, 403, "관전 접속은 OP 계정만 사용할 수 있어요.", "OP_REQUIRED");
        return;
      }
      const username = spectator ? spectatorUsername(user.id) : user.gameUsername;
      if (spectator && context.database.getUserByGameUsername(username)) {
        fail(response, 409, "관전 프로필 이름이 기존 계정과 겹쳐 접속할 수 없어요.", "SPECTATOR_PROFILE_CONFLICT");
        return;
      }
      const profile = await context.skins.createClientProfile({ ...user, gameUsername: username }, context.serverManager.getStatus().version === "Paper 26.2");
      context.gameConnections.create(launchId, user.id, spectator);
      response.json({
        username,
        displayName: user.displayName,
        profile,
        resourcePackPreference: user.resourcePackPreference,
      });
    } catch (error) {
      failFromError(response, 500, error, "저장된 프로필을 불러오지 못했어요.", "PROFILE_LOAD_FAILED");
    }
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      fail(response, 400, error.code === "LIMIT_FILE_SIZE" ? "스킨 PNG는 256KB보다 작아야 해요." : error.message);
      return;
    }
    console.error(error);
    fail(response, 500, "서버에서 문제가 발생했어요.", "INTERNAL_ERROR");
  });

  return router;
}
