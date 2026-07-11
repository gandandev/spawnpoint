import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { Request, Response } from "express";
import type { SkinModel, UserRecord } from "./types.js";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const SESSION_COOKIE = "spawnpoint_session";

interface TokenEnvelope {
  aud: "session" | "game";
  sub: string;
  username: string;
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

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  const validUsername = validateUsername(username);
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("비밀번호는 8~128자로 입력하세요.");
  }
  return { username: validUsername, password };
}

export function validateUsername(username: unknown): string {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    throw new Error("플레이어 ID는 영문, 숫자, 밑줄을 사용해 3~16자로 입력하세요.");
  }
  return username;
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
      csrf,
      iat: now,
      exp: now + days * 86_400,
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
    username: user.username,
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

export function setSessionCookie(response: Response, token: string, days: number, secure: boolean): void {
  response.append("Set-Cookie", serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: days * 86_400,
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
