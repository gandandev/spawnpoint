import { describe, expect, it, vi } from "vitest";
import { GameConnectionTracker, isLaunchId } from "../server/game-connections.js";

const launchId = "24f432da-1f3b-4f10-8d13-53e93a90872d";

describe("game connection tracker", () => {
  it("binds spectator mode to the account and clears it for a normal relaunch", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "operator", true);
    expect(tracker.isSpectator(launchId, "operator")).toBe(true);
    expect(tracker.isSpectator(launchId, "other")).toBe(false);
    tracker.create(launchId, "operator");
    expect(tracker.isSpectator(launchId, "operator")).toBe(false);
  });

  it("allows retrying after a connection closes during login", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");
    const close = tracker.begin(launchId, "user-1");
    expect(close).not.toBeNull();
    expect(tracker.begin(launchId, "user-1")).toBeNull();

    close?.();

    expect(tracker.isActive(launchId, "user-1")).toBe(false);
    expect(tracker.begin(launchId, "user-1")).not.toBeNull();
  });

  it("allows re-entering after an established connection closes", () => {
    vi.useFakeTimers();
    try {
      const tracker = new GameConnectionTracker();
      tracker.create(launchId, "user-1");
      const close = tracker.begin(launchId, "user-1");
      expect(tracker.isActive(launchId, "user-1")).toBe(true);
      vi.advanceTimersByTime(11 * 60_000);
      // An active socket must outlive the unused-launch expiry window.
      expect(tracker.begin(launchId, "user-1")).toBeNull();
      expect(tracker.isActive(launchId, "user-1")).toBe(true);

      close?.();

      expect(tracker.isActive(launchId, "user-1")).toBe(false);
      expect(tracker.begin(launchId, "user-1")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires an unused launch before accepting a socket", () => {
    vi.useFakeTimers();
    try {
      const tracker = new GameConnectionTracker(1_000);
      tracker.create(launchId, "user-1");
      vi.advanceTimersByTime(1_000);
      expect(tracker.begin(launchId, "user-1")).toBeNull();
      expect(tracker.isActive(launchId, "user-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("limits one launch id within a sliding window without reset by ticket replay", () => {
    vi.useFakeTimers();
    const tracker = new GameConnectionTracker(10 * 60_000, 3, 60_000);
    tracker.create(launchId, "user-1");

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const close = tracker.begin(launchId, "user-1");
        expect(close).not.toBeNull();
        tracker.create(launchId, "user-1");
        close?.();
      }

      expect(tracker.isActive(launchId, "user-1")).toBe(false);
      tracker.create(launchId, "user-1");
      expect(tracker.begin(launchId, "user-1")).toBeNull();

      vi.advanceTimersByTime(60_001);
      expect(tracker.isActive(launchId, "user-1")).toBe(false);
      expect(tracker.begin(launchId, "user-1")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts UUID case variants as the same bounded launch", () => {
    const tracker = new GameConnectionTracker(10 * 60_000, 3, 60_000);
    const variants = [launchId, launchId.toUpperCase(), launchId.replace("f", "F")];
    tracker.create(variants[0], "user-1");

    for (const variant of variants) {
      const close = tracker.begin(variant, "user-1");
      expect(close).not.toBeNull();
      tracker.create(variant, "user-1");
      close?.();
    }

    expect(tracker.isActive(launchId, "user-1")).toBe(false);
    expect(tracker.begin(launchId.toUpperCase(), "user-1")).toBeNull();
  });

  it("allows a status ping, a join, and several retries before the default limit", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const close = tracker.begin(launchId, "user-1");
      expect(close).not.toBeNull();
      close?.();
    }

    expect(tracker.isActive(launchId, "user-1")).toBe(false);
    expect(tracker.begin(launchId, "user-1")).toBeNull();
  });

  it("rejects unknown users and malformed launch ids", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");

    expect(tracker.begin(launchId, "user-2")).toBeNull();
    expect(tracker.isActive(launchId, "user-2")).toBe(false);
    expect(isLaunchId(launchId)).toBe(true);
    expect(isLaunchId("launch-123")).toBe(false);
  });

  it("invalidates waiting launches and closes active sockets for a reset user", () => {
    const secondLaunchId = "34f432da-1f3b-4f10-8d13-53e93a90872d";
    const tracker = new GameConnectionTracker();
    const disconnect = vi.fn();
    tracker.create(launchId, "user-1");
    tracker.create(secondLaunchId, "user-1");
    expect(tracker.begin(launchId, "user-1", disconnect)).not.toBeNull();

    expect(tracker.disconnectUser("user-1")).toBe(2);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(tracker.isActive(launchId, "user-1")).toBe(false);
    expect(tracker.isActive(secondLaunchId, "user-1")).toBe(false);
    expect(tracker.begin(secondLaunchId, "user-1")).toBeNull();
  });

  it("disconnects a replaced socket without letting its stale close reset the new launch", () => {
    vi.useFakeTimers();
    try {
      const tracker = new GameConnectionTracker();
      const disconnectOld = vi.fn();
      tracker.create(launchId, "user-1");
      const closeOld = tracker.begin(launchId, "user-1", disconnectOld);

      tracker.create(launchId, "user-1");
      const closeCurrent = tracker.begin(launchId, "user-1");
      vi.advanceTimersByTime(1_000);
      closeOld?.();

      expect(disconnectOld).toHaveBeenCalledOnce();
      expect(tracker.isActive(launchId, "user-1")).toBe(true);
      closeCurrent?.();
      expect(tracker.isActive(launchId, "user-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
