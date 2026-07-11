import { describe, expect, it } from "vitest";
import {
  hashPassword, signToken, validateCredentials, verifyPassword, verifyToken,
} from "../server/security.js";

const secret = "test-secret-that-is-longer-than-thirty-two-characters";

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", stored.salt, stored.hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong horse battery staple", stored.salt, stored.hash)).resolves.toBe(false);
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

describe("credentials", () => {
  it("enforces minecraft-safe names and useful passwords", () => {
    expect(validateCredentials("player_01", "password123").username).toBe("player_01");
    expect(() => validateCredentials("two words", "password123")).toThrow();
    expect(() => validateCredentials("player", "short")).toThrow();
  });
});

