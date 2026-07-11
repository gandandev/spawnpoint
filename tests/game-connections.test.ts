import { describe, expect, it, vi } from "vitest";
import { GameConnectionTracker, isLaunchId } from "../server/game-connections.js";

const launchId = "24f432da-1f3b-4f10-8d13-53e93a90872d";

describe("game connection tracker", () => {
  it("allows retrying after a connection closes during login", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");
    expect(tracker.begin(launchId, "user-1")).toBe(true);
    expect(tracker.begin(launchId, "user-1")).toBe(false);

    tracker.closed(launchId, "user-1");

    expect(tracker.status(launchId, "user-1")).toBe("waiting");
    expect(tracker.begin(launchId, "user-1")).toBe(true);
  });

  it("allows re-entering after an established connection closes", () => {
    vi.useFakeTimers();
    try {
      const tracker = new GameConnectionTracker(1_000);
      tracker.create(launchId, "user-1");
      tracker.begin(launchId, "user-1");
      vi.advanceTimersByTime(1_000);

      tracker.closed(launchId, "user-1");

      expect(tracker.status(launchId, "user-1")).toBe("waiting");
      expect(tracker.begin(launchId, "user-1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unknown users and malformed launch ids", () => {
    const tracker = new GameConnectionTracker();
    tracker.create(launchId, "user-1");

    expect(tracker.begin(launchId, "user-2")).toBe(false);
    expect(tracker.status(launchId, "user-2")).toBeNull();
    expect(isLaunchId(launchId)).toBe(true);
    expect(isLaunchId("launch-123")).toBe(false);
  });
});
