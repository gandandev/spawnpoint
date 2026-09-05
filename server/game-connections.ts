interface GameConnection {
  userId: string;
  attemptTimestamps: number[];
  expiresAt: number;
  disconnect: (() => void) | null;
}

const LAUNCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLaunchId(value: unknown): value is string {
  return typeof value === "string" && LAUNCH_ID_PATTERN.test(value);
}

export class GameConnectionTracker {
  private readonly connections = new Map<string, GameConnection>();

  constructor(
    private readonly lifetimeMs = 10 * 60_000,
    private readonly maxAttempts = 8,
    private readonly attemptWindowMs = 60_000,
  ) {}

  create(launchId: string, userId: string): void {
    this.cleanup();
    const key = launchId.toLowerCase();
    const existing = this.connections.get(key);
    const attemptTimestamps = existing?.userId === userId
      ? this.recentAttempts(existing)
      : [];
    this.remove(key)?.();
    this.connections.set(key, {
      userId,
      attemptTimestamps,
      expiresAt: Date.now() + this.lifetimeMs,
      disconnect: null,
    });
  }

  begin(launchId: string, userId: string, disconnect: () => void = () => {}): (() => void) | null {
    this.cleanup();
    const key = launchId.toLowerCase();
    const connection = this.connections.get(key);
    if (
      !connection
      || connection.userId !== userId
      || connection.disconnect !== null
      || connection.expiresAt <= Date.now()
    ) return null;
    const attemptTimestamps = this.recentAttempts(connection);
    if (attemptTimestamps.length >= this.maxAttempts) return null;
    attemptTimestamps.push(Date.now());
    connection.expiresAt = Date.now() + this.lifetimeMs;
    connection.disconnect = disconnect;
    return () => {
      if (this.connections.get(key) !== connection) return;
      connection.disconnect = null;
      connection.expiresAt = Date.now() + this.lifetimeMs;
    };
  }

  isActive(launchId: string, userId: string): boolean {
    const connection = this.connections.get(launchId.toLowerCase());
    return connection?.userId === userId && connection.disconnect !== null;
  }

  private recentAttempts(connection: GameConnection): number[] {
    const cutoff = Date.now() - this.attemptWindowMs;
    connection.attemptTimestamps = connection.attemptTimestamps.filter((attemptedAt) => attemptedAt > cutoff);
    return connection.attemptTimestamps;
  }

  disconnectUser(userId: string): number {
    let disconnected = 0;
    for (const [launchId, connection] of this.connections) {
      if (connection.userId !== userId) continue;
      const close = this.remove(launchId);
      close?.();
      disconnected += 1;
    }
    return disconnected;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [launchId, connection] of this.connections) {
      if (connection.disconnect === null && connection.expiresAt <= now) this.remove(launchId);
    }
  }

  private remove(launchId: string): (() => void) | null {
    const key = launchId.toLowerCase();
    const connection = this.connections.get(key);
    if (!connection) return null;
    this.connections.delete(key);
    const disconnect = connection.disconnect;
    connection.disconnect = null;
    return disconnect;
  }
}
