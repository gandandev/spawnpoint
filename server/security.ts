import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { Request, Response } from "express";
import type { SkinModel, UserRecord } from "./types.js";

const USERNAME_PATTERN = /^[\p{L}\p{N}_]{1,16}$/u;
const SESSION_COOKIE = "spawnpoint_session";
const ADMIN_COOKIE = "spawnpoint_admin";

interface TokenEnvelope {
  aud: "session" | "game" | "admin";
  sub: string;
  username: string;
  displayName?: string;
  sessionVersion?: number;
  iat: number;
  exp: number;
  csrf?: string;
  skinPath?: string;
  skinModel?: SkinModel;
  jti?: string;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function loadOrCreateSecret(dataDir: string, configured: string): string {
  if (configured.length >= 32) return configured;
  fs.mkdirSync(dataDir, { recursive: true });
  const secretPath = path.join(dataDir, "session.secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // First boot.
  }
  const generated = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

function derivePassword(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, length, { N: 16_384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string, salt = crypto.randomBytes(16)): Promise<{ hash: Buffer; salt: Buffer }> {
  const hash = await derivePassword(password, salt, 32);
  return { hash, salt };
}

export async function verifyPassword(password: string, salt: Buffer, expected: Buffer): Promise<boolean> {
  const actual = await derivePassword(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createPasswordResetCode(secret: string): { code: string; digest: Buffer } {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  return { code, digest: passwordResetDigest(code, secret) };
}

export function passwordResetDigest(code: string, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(code, "utf8").digest();
}

export function verifyPasswordResetCode(code: unknown, secret: string, expected: Buffer): boolean {
  if (typeof code !== "string") return false;
  const actual = passwordResetDigest(code, secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  const validUsername = validateUsername(username);
  const validPassword = validatePassword(password);
  return { username: validUsername, password: validPassword };
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("비밀번호는 8~128자로 입력하세요.");
  }
  return password;
}

export function validateDisplayName(input: unknown): string {
  if (typeof input !== "string") throw new Error("표시 이름을 입력하세요.");
  const displayName = input.normalize("NFC").trim();
  const length = Array.from(displayName).length;
  if (length < 1 || length > 16 || !/^[\p{L}\p{N}_ ]+$/u.test(displayName) || /  /.test(displayName)) {
    throw new Error("표시 이름은 한글, 영문, 숫자, 공백, 밑줄을 사용해 1~16자로 입력하세요.");
  }
  return displayName;
}

export function validateUsername(username: unknown): string {
  if (typeof username !== "string") throw new Error("플레이어 이름을 입력하세요.");
  const normalized = username.normalize("NFC").trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 16 || !USERNAME_PATTERN.test(normalized)) {
    throw new Error("플레이어 이름은 한글, 영문, 숫자, 밑줄을 사용해 1~16자로 입력하세요.");
  }
  return normalized;
}

export function signToken(payload: TokenEnvelope, secret: string): string {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = base64Url(crypto.createHmac("sha256", secret).update(encoded).digest());
  return `${encoded}.${signature}`;
}

export function verifyToken(token: string | undefined, secret: string, audience: TokenEnvelope["aud"]): TokenEnvelope | null {
  if (!token) return null;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) return null;
  const expected = base64Url(crypto.createHmac("sha256", secret).update(payloadPart).digest());
  if (!safeEqual(signaturePart, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as TokenEnvelope;
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== audience || payload.exp <= now || payload.iat > now + 30) return null;
    if (!payload.sub || !USERNAME_PATTERN.test(payload.username)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(user: UserRecord, secret: string, days: number): { token: string; csrf: string } {
  const now = Math.floor(Date.now() / 1000);
  const csrf = crypto.randomBytes(24).toString("base64url");
  return {
    csrf,
    token: signToken({
      aud: "session",
      sub: user.id,
      username: user.username,
      sessionVersion: user.sessionVersion,
      csrf,
      iat: now,
      exp: now + days * 86_400,
    }, secret),
  };
}

export function createAdminToken(user: UserRecord, secret: string, minutes: number): { token: string; csrf: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + minutes * 60;
  const csrf = crypto.randomBytes(24).toString("base64url");
  return {
    csrf,
    expiresAt: expiresAt * 1_000,
    token: signToken({
      aud: "admin",
      sub: user.id,
      username: user.username,
      sessionVersion: user.sessionVersion,
      csrf,
      iat: now,
      exp: expiresAt,
    }, secret),
  };
}

export function createGameTicket(
  user: UserRecord,
  skinPath: string,
  secret: string,
  minutes: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    aud: "game",
    sub: user.id,
    username: user.gameUsername,
    displayName: user.displayName,
    skinPath,
    skinModel: user.skinModel,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + minutes * 60,
  }, secret);
}

export function sessionFromRequest(request: Request, secret: string): TokenEnvelope | null {
  return sessionFromCookieHeader(request.headers.cookie, secret);
}

export function sessionFromCookieHeader(cookieHeader: string | undefined, secret: string): TokenEnvelope | null {
  const cookies = parseCookie(cookieHeader ?? "");
  return verifyToken(cookies[SESSION_COOKIE], secret, "session");
}

export function adminFromRequest(request: Request, secret: string): TokenEnvelope | null {
  const cookies = parseCookie(request.headers.cookie ?? "");
  return verifyToken(cookies[ADMIN_COOKIE], secret, "admin");
}

export function setSessionCookie(response: Response, token: string, days: number, secure: boolean): void {
  response.append("Set-Cookie", serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: days * 86_400,
  }));
}

export function setAdminCookie(response: Response, token: string, minutes: number, secure: boolean): void {
  response.append("Set-Cookie", serializeCookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: minutes * 60,
  }));
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.append("Set-Cookie", serializeCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  }));
}

export function clearAdminCookie(response: Response, secure: boolean): void {
  response.append("Set-Cookie", serializeCookie(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  }));
}

export function isSameOriginHeaders(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function isSameOrigin(request: Request): boolean {
  return isSameOriginHeaders(request.headers.origin, request.headers.host);
}
