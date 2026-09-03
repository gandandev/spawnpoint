import type { ServerStatus } from "./types.js";

export const FRONTEND_UPDATE_MESSAGE = "새 업데이트가 있어요.  새로고침해서 적용하세요";

const SERVER_UPDATE_COUNTDOWN = [
  { waitMs: 0, message: "30초 후 서버 업데이트가 있어요" },
  { waitMs: 20_000, message: "10초 후 서버 업데이트가 있어요" },
  { waitMs: 7_000, message: "3" },
  { waitMs: 1_000, message: "2" },
  { waitMs: 1_000, message: "1" },
] as const;

interface DeploymentNoticeTarget {
  getStatus(): ServerStatus;
  sendCommand(command: string): Promise<void>;
}

type Wait = (milliseconds: number) => Promise<void>;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function broadcast(target: DeploymentNoticeTarget, message: string): Promise<void> {
  await target.sendCommand(`tellraw @a ${JSON.stringify({ text: message })}`);
}

export async function announceServerUpdateCountdown(
  target: DeploymentNoticeTarget,
  pause: Wait = wait,
): Promise<boolean> {
  const status = target.getStatus();
  if (status.phase !== "online" || status.players.length === 0) return false;

  for (const step of SERVER_UPDATE_COUNTDOWN) {
    if (step.waitMs > 0) await pause(step.waitMs);
    if (target.getStatus().phase !== "online") return true;
    await broadcast(target, step.message);
  }
  await pause(1_000);
  return true;
}

export class FrontendReleaseMonitor {
  private lastVersion: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private warned = false;

  constructor(
    private readonly target: DeploymentNoticeTarget,
    private readonly versionUrl: string,
    private readonly intervalMs = 10_000,
    private readonly fetchVersion: typeof fetch = fetch,
  ) {}

  start(): void {
    if (!this.versionUrl || this.timer) return;
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkNow(): Promise<void> {
    if (!this.versionUrl || this.checking) return;
    this.checking = true;
    try {
      const response = await this.fetchVersion(this.versionUrl, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`frontend version returned ${response.status}`);
      const body: unknown = await response.json();
      const version = body && typeof body === "object" && "version" in body
        ? String(body.version).trim()
        : "";
      if (!version || version.length > 128 || /[\r\n]/.test(version)) {
        throw new Error("frontend version is invalid");
      }

      const previousVersion = this.lastVersion;
      this.warned = false;
      if (previousVersion === null || previousVersion === version) {
        this.lastVersion = version;
        return;
      }

      const status = this.target.getStatus();
      if (status.phase !== "online" || status.players.length === 0) {
        this.lastVersion = version;
        return;
      }
      await broadcast(this.target, FRONTEND_UPDATE_MESSAGE);
      this.lastVersion = version;
    } catch (error) {
      if (!this.warned) {
        console.warn("Could not check the frontend deployment version:", error);
        this.warned = true;
      }
    } finally {
      this.checking = false;
    }
  }
}
