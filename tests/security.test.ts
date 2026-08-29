import { describe, expect, it } from "vitest";
import {
  createPasswordResetCode, createSessionToken, hashPassword, isSameOriginHeaders, sessionFromCookieHeader,
  signToken, validateCredentials, validateDisplayName, validateNewPassword, verifyPassword, verifyPasswordResetCode, verifyToken,
} from "../server/security.js";

const secret = "test-secret-that-is-longer-than-thirty-two-characters";

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", stored.salt, stored.hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong horse battery staple", stored.salt, stored.hash)).resolves.toBe(false);
  });

  it("creates uniform six-digit reset codes and verifies only their HMAC digest", () => {
    const reset = createPasswordResetCode(secret);

    expect(reset.code).toMatch(/^\d{6}$/);
    expect(reset.digest).toHaveLength(32);
    expect(reset.digest.toString("utf8")).not.toContain(reset.code);
    expect(verifyPasswordResetCode(reset.code, secret, reset.digest)).toBe(true);
    const wrongCode = reset.code === "000000" ? "000001" : "000000";
    expect(verifyPasswordResetCode(wrongCode, secret, reset.digest)).toBe(false);
    expect(verifyPasswordResetCode(undefined, secret, reset.digest)).toBe(false);
  });
});

describe("signed tickets", () => {
  it("accepts a valid game ticket", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({ aud: "game", sub: "user-1", username: "mossrunner", iat: now, exp: now + 60 }, secret);
    expect(verifyToken(token, secret, "game")?.username).toBe("mossrunner");
  });

  it("rejects tampering, expiry, and the wrong audience", () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = signToken({ aud: "game", sub: "user-1", username: "mossrunner", iat: now - 120, exp: now - 60 }, secret);
    const valid = signToken({ aud: "game", sub: "user-1", username: "mossrunner", iat: now, exp: now + 60 }, secret);
    expect(verifyToken(`${valid.slice(0, -1)}x`, secret, "game")).toBeNull();
    expect(verifyToken(expired, secret, "game")).toBeNull();
    expect(verifyToken(valid, secret, "session")).toBeNull();
  });
});

describe("gateway sessions", () => {
  it("reads the signed session from a websocket cookie header", () => {
    const now = Date.now();
    const session = createSessionToken({
      id: "user-1", username: "mossrunner", gameUsername: "mossrunner", displayName: "이끼 러너",
      passwordHash: Buffer.alloc(0), passwordSalt: Buffer.alloc(0), passwordResetDigest: null,
      passwordResetExpiresAt: null, sessionVersion: 0,
      createdAt: now, skinType: "preset", skinRef: "moss", skinModel: "steve", skinLabel: "moss", skinUpdatedAt: now,
    }, secret, 1);
    expect(sessionFromCookieHeader(`other=value; spawnpoint_session=${session.token}`, secret)?.sub).toBe("user-1");
  });

  it("rejects cross-origin websocket handshakes", () => {
    expect(isSameOriginHeaders("https://spawnpoint.test", "spawnpoint.test")).toBe(true);
    expect(isSameOriginHeaders("https://evil.test", "spawnpoint.test")).toBe(false);
  });
});

describe("credentials", () => {
  it("accepts Korean account names and non-empty passwords while enforcing safe name characters", () => {
    expect(validateCredentials("player_01", "password123").username).toBe("player_01");
    expect(validateCredentials(" 텔레그램 ", "password123").username).toBe("텔레그램");
    expect(validateCredentials("민수", "password123").username).toBe("민수");
    expect(() => validateCredentials("two words", "password123")).toThrow();
    expect(validateCredentials("player", "짧음").password).toBe("짧음");
    expect(() => validateCredentials("player", "")).toThrow();
  });

  it("keeps legacy passwords valid for login but requires eight characters for new passwords", () => {
    expect(validateCredentials("player", "한").password).toBe("한");
    expect(() => validateNewPassword("짧은비번")).toThrow("8~128자");
    expect(validateNewPassword("충분히긴비밀번호")).toBe("충분히긴비밀번호");
  });

  it("accepts Korean display names without Minecraft formatting characters", () => {
    expect(validateDisplayName(" 이끼 러너 ")).toBe("이끼 러너");
    expect(Array.from(validateDisplayName("가나다라마바사아자차카타파하가나"))).toHaveLength(16);
    expect(() => validateDisplayName("§c관리자")).toThrow();
    expect(() => validateDisplayName("가나다라마바사아자차카타파하가나다")).toThrow();
  });
});
