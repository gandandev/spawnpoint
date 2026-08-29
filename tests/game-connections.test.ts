import { describe, expect, it, vi } from "vitest";
import { GameConnectionTracker, isLaunchId } from "../server/game-connections.js";

const launchId = "24f432da-1f3b-4f10-8d13-53e93a90872d";

describe("game connection tracker", () => {
  it("allows retrying after a connection closes during login", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");
    expect(tracker.begin(launchId, "user-1")).not.toBeNull();
    expect(tracker.begin(launchId, "user-1")).toBeNull();

    tracker.closed(launchId, "user-1");

    expect(tracker.status(launchId, "user-1")).toBe("waiting");
    expect(tracker.begin(launchId, "user-1")).not.toBeNull();
  });

  it("allows re-entering after an established connection closes", () => {
    vi.useFakeTimers();
    try {
      const tracker = new GameConnectionTracker(1_000);
      tracker.create(launchId, "user-1");
      const close = tracker.begin(launchId, "user-1");
      vi.advanceTimersByTime(1_000);

      close?.();

      expect(tracker.status(launchId, "user-1")).toBe("waiting");
      expect(tracker.begin(launchId, "user-1")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unknown users and malformed launch ids", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");

    expect(tracker.begin(launchId, "user-2")).toBeNull();
    expect(tracker.status(launchId, "user-2")).toBeNull();
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
    expect(tracker.status(launchId, "user-1")).toBeNull();
    expect(tracker.status(secondLaunchId, "user-1")).toBeNull();
    expect(tracker.begin(secondLaunchId, "user-1")).toBeNull();
  });

  it("disconnects a replaced socket without letting its stale close reset the new launch", () => {
    vi.useFakeTimers();
    try {
      const tracker = new GameConnectionTracker(1_000);
      const disconnectOld = vi.fn();
      tracker.create(launchId, "user-1");
      const closeOld = tracker.begin(launchId, "user-1", disconnectOld);

      tracker.create(launchId, "user-1");
      const closeCurrent = tracker.begin(launchId, "user-1");
      vi.advanceTimersByTime(1_000);
      closeOld?.();

      expect(disconnectOld).toHaveBeenCalledOnce();
      expect(tracker.status(launchId, "user-1")).toBe("connected");
      closeCurrent?.();
      expect(tracker.status(launchId, "user-1")).toBe("waiting");
    } finally {
      vi.useRealTimers();
    }
  });
});
