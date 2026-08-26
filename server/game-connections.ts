export type GameConnectionState = "waiting" | "connecting" | "connected" | "failed";

interface GameConnection {
  userId: string;
  state: GameConnectionState;
  expiresAt: number;
  readyTimer: NodeJS.Timeout | null;
  disconnect: (() => void) | null;
}

const LAUNCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLaunchId(value: unknown): value is string {
  return typeof value === "string" && LAUNCH_ID_PATTERN.test(value);
}

export class GameConnectionTracker {
  private readonly connections = new Map<string, GameConnection>();

  constructor(
    private readonly loginGraceMs = 20_000,
    private readonly lifetimeMs = 10 * 60_000,
  ) {}

  create(launchId: string, userId: string): void {
    this.delete(launchId);
    this.connections.set(launchId, {
      userId,
      state: "waiting",
      expiresAt: Date.now() + this.lifetimeMs,
      readyTimer: null,
      disconnect: null,
    });
    this.cleanup();
  }

  begin(launchId: string, userId: string, disconnect: () => void = () => {}): boolean {
    this.cleanup();
    const connection = this.connections.get(launchId);
    if (!connection || connection.userId !== userId || connection.state !== "waiting" || connection.expiresAt <= Date.now()) return false;
    connection.state = "connecting";
    connection.expiresAt = Date.now() + this.lifetimeMs;
    connection.disconnect = disconnect;
    connection.readyTimer = setTimeout(() => {
      if (connection.state === "connecting") connection.state = "connected";
      connection.readyTimer = null;
    }, this.loginGraceMs);
    connection.readyTimer.unref();
    return true;
  }

  closed(launchId: string, userId: string): void {
    const connection = this.connections.get(launchId);
    if (!connection || connection.userId !== userId || (connection.state !== "connecting" && connection.state !== "connected")) return;
    if (connection.readyTimer) clearTimeout(connection.readyTimer);
    connection.readyTimer = null;
    connection.disconnect = null;
    connection.state = "waiting";
    connection.expiresAt = Date.now() + this.lifetimeMs;
  }

  status(launchId: string, userId: string): GameConnectionState | null {
    this.cleanup();
    const connection = this.connections.get(launchId);
    if (!connection || connection.userId !== userId) return null;
    return connection.state;
  }

  disconnectUser(userId: string): number {
    let disconnected = 0;
    for (const [launchId, connection] of this.connections) {
      if (connection.userId !== userId) continue;
      const close = connection.disconnect;
      this.delete(launchId);
      close?.();
      disconnected += 1;
    }
    return disconnected;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [launchId, connection] of this.connections) {
      if ((connection.state === "waiting" || connection.state === "failed") && connection.expiresAt <= now) this.delete(launchId);
    }
  }

  private delete(launchId: string): void {
    const connection = this.connections.get(launchId);
    if (connection?.readyTimer) clearTimeout(connection.readyTimer);
    if (connection) connection.disconnect = null;
    this.connections.delete(launchId);
  }
}
