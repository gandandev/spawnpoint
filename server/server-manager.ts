import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";
import type { ServerStatus } from "./types.js";

interface ServerManagerOptions {
  dataDir: string;
  seedDir: string;
  portalPort: number;
  bridgePort: number;
  javaBin: string;
  memoryMb: number;
  idleMinutes: number;
  startCooldownSeconds: number;
  maxPlayers: number;
  eulaAccepted: boolean;
  mockServer: boolean;
}

const MANAGED_FILES = [
  "paper-1.12.2.jar",
  "server-icon.png",
  "server.properties",
  "bukkit.yml",
  "plugins/EaglerXServer.jar",
  "plugins/SpawnpointBridge.jar",
  "plugins/EaglercraftXServer/settings.yml",
  "plugins/EaglercraftXServer/listener.yml",
  "plugins/EaglercraftXServer/ice_servers.yml",
];
const MAX_LOG_LINES = 500;
const FINAL_LOG_LINES = 12;
const HARD_STOP_DELAY_MS = 20_000;
const SHUTDOWN_EXIT_GRACE_MS = HARD_STOP_DELAY_MS + 5_000;
const READY_LOG_PATTERNS = [/Done \([\d.]+s\)!/, /For help, type "help"/];
const PAPER_LOG_ARCHIVE = /^\d{4}-\d{2}-\d{2}-\d+\.log(?:\.gz)?$/;
const gunzip = promisify(gunzipCallback);

export interface ConsoleLogEntry {
  source: string;
  line: string;
}

export interface ConsoleLogPage {
  entries: ConsoleLogEntry[];
  nextOffset: number | null;
}

export class ServerStartError extends Error {
  constructor(public readonly code: "EULA_REQUIRED" | "COOLDOWN" | "MISSING_RUNTIME" | "START_FAILED", message: string) {
    super(message);
  }
}

export class MinecraftServerManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly minecraftDir: string;
  private idleTimer: NodeJS.Timeout;
  private expectedExit = false;
  private mockStartTimer: NodeJS.Timeout | null = null;
  private hardStopTimer: NodeJS.Timeout | null = null;
  private readonly outputReaders = new Set<readline.Interface>();
  private recentOutput: string[] = [];
  private state: ServerStatus;

  constructor(private readonly options: ServerManagerOptions) {
    super();
    this.minecraftDir = path.join(options.dataDir, "minecraft");
    this.state = {
      phase: "off",
      players: [],
      startedAt: null,
      readyAt: null,
      idleShutdownAt: null,
      lastError: null,
      startAllowedAt: 0,
      maxPlayers: options.maxPlayers,
      version: "Paper 1.12.2",
    };
    this.idleTimer = setInterval(() => void this.checkIdleShutdown(), 15_000);
    this.idleTimer.unref();
  }

  getStatus(): ServerStatus {
    return { ...this.state, players: [...this.state.players] };
  }

  getRecentLogs(limit = 200): string[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    return this.recentOutput.slice(-safeLimit);
  }

  async getLogHistory(options: { query?: string; offset?: number; limit?: number } = {}): Promise<ConsoleLogPage> {
    const query = (options.query ?? "").trim().toLocaleLowerCase("ko-KR");
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 500), 500));
    const logsDir = path.join(this.minecraftDir, "logs");
    let fileNames: string[] = [];
    try {
      fileNames = (await fs.readdir(logsDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && (entry.name === "latest.log" || PAPER_LOG_ARCHIVE.test(entry.name)))
        .map((entry) => entry.name)
        .sort((left, right) => {
          if (left === "latest.log") return -1;
          if (right === "latest.log") return 1;
          return right.localeCompare(left, "en", { numeric: true });
        });
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    const newestFirst: ConsoleLogEntry[] = [];
    let skipped = 0;
    let hasMore = false;
    const visit = (source: string, lines: string[]) => {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || (query && !line.toLocaleLowerCase("ko-KR").includes(query))) continue;
        if (skipped < offset) {
          skipped += 1;
          continue;
        }
        if (newestFirst.length < limit) {
          newestFirst.push({ source, line });
          continue;
        }
        hasMore = true;
        return false;
      }
      return true;
    };

    for (const fileName of fileNames) {
      let contents: Buffer;
      try {
        const stored = await fs.readFile(path.join(logsDir, fileName));
        contents = fileName.endsWith(".gz") ? await gunzip(stored) : stored;
      } catch (error) {
        // Paper can rotate latest.log while this request is reading it. Skip only that vanished file.
        if (isMissingFileError(error)) continue;
        throw error;
      }
      if (!visit(fileName, contents.toString("utf8").split(/\r?\n/))) break;
    }

    if (fileNames.length === 0) visit("현재 실행", this.recentOutput);
    return {
      entries: newestFirst.reverse(),
      nextOffset: hasMore ? offset + newestFirst.length : null,
    };
  }

  async sendCommand(command: string): Promise<void> {
    if (this.state.phase !== "online") throw new Error("게임 서버가 온라인일 때만 명령을 실행할 수 있어요.");
    this.appendLog(`> ${command}`);
    if (this.options.mockServer) return;
    if (command.toLowerCase() === "stop") {
      await this.stop();
      return;
    }
    const child = this.child;
    if (!child || child.stdin.destroyed || !child.stdin.writable) throw new Error("게임 서버 콘솔에 연결할 수 없어요.");
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(`${command}\n`, (error) => error ? reject(error) : resolve());
    });
  }

  private publish(patch: Partial<ServerStatus>): void {
    this.state = { ...this.state, ...patch };
    this.emit("status", this.getStatus());
  }

  private appendLog(line: string): void {
    this.recentOutput.push(line);
    if (this.recentOutput.length > MAX_LOG_LINES) this.recentOutput.shift();
  }

  private setOffline(): void {
    this.publish({ phase: "off", players: [], startedAt: null, readyAt: null, idleShutdownAt: null });
  }

  private async prepareRuntime(): Promise<void> {
    const seedJar = path.join(this.options.seedDir, "paper-1.12.2.jar");
    if (!fsSync.existsSync(seedJar)) {
      throw new ServerStartError("MISSING_RUNTIME", "The bundled Minecraft runtime is missing.");
    }
    await fs.mkdir(this.minecraftDir, { recursive: true });
    const firstBoot = !fsSync.existsSync(path.join(this.minecraftDir, "server.properties"));
    if (firstBoot) {
      await fs.cp(this.options.seedDir, this.minecraftDir, { recursive: true, force: false });
    } else {
      for (const relative of MANAGED_FILES) {
        const source = path.join(this.options.seedDir, relative);
        const destination = path.join(this.minecraftDir, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
      }
    }
    if (!this.options.eulaAccepted) {
      throw new ServerStartError(
        "EULA_REQUIRED",
        "Set MC_EULA=true after reading the Minecraft EULA before starting the real server.",
      );
    }
    const propertiesPath = path.join(this.minecraftDir, "server.properties");
    const properties = await fs.readFile(propertiesPath, "utf8");
    await fs.writeFile(
      propertiesPath,
      properties.replace(/^max-players=.*$/m, `max-players=${this.options.maxPlayers}`),
      "utf8",
    );
    await fs.writeFile(path.join(this.minecraftDir, "eula.txt"), "eula=true\n", "utf8");
  }

  async start(): Promise<ServerStatus> {
    if (this.state.phase === "preparing" || this.state.phase === "starting" || this.state.phase === "online") {
      return this.getStatus();
    }
    const now = Date.now();
    if (now < this.state.startAllowedAt) {
      throw new ServerStartError("COOLDOWN", "The start button is cooling down for a moment.");
    }
    const startAllowedAt = now + this.options.startCooldownSeconds * 1_000;
    this.recentOutput = [];
    this.publish({
      phase: "preparing",
      players: [],
      startedAt: now,
      readyAt: null,
      idleShutdownAt: null,
      lastError: null,
      startAllowedAt,
    });

    if (this.options.mockServer) {
      this.mockStartTimer = setTimeout(() => {
        const readyAt = Date.now();
        this.publish({
          phase: "online",
          readyAt,
          idleShutdownAt: readyAt + this.options.idleMinutes * 60_000,
        });
      }, 1_200);
      return this.getStatus();
    }

    try {
      await this.prepareRuntime();
      this.publish({ phase: "starting" });
      this.expectedExit = false;
      this.child = spawn(this.options.javaBin, [
        "-Xms256M",
        `-Xmx${this.options.memoryMb}M`,
        "-XX:+UseG1GC",
        "-XX:MaxGCPauseMillis=100",
        "-Dfile.encoding=UTF-8",
        "-Dpaper.disableChannelLimit=true",
        "-jar",
        "paper-1.12.2.jar",
      ], {
        cwd: this.minecraftDir,
        env: {
          ...process.env,
          DATA_DIR: this.options.dataDir,
          PORTAL_INTERNAL_ORIGIN: `http://127.0.0.1:${this.options.portalPort}`,
          SPAWNPOINT_BRIDGE_PORT: String(this.options.bridgePort),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.attachOutput(this.child.stdout);
      this.attachOutput(this.child.stderr);
      this.child.once("error", (error) => this.handleFailure(error));
      this.child.once("exit", (code, signal) => this.handleExit(code, signal));
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server failed to start.";
      this.publish({ phase: "off", lastError: message, startedAt: null });
      if (error instanceof ServerStartError) throw error;
      throw new ServerStartError("START_FAILED", message);
    }
  }

  private attachOutput(stream: NodeJS.ReadableStream): void {
    const lines = readline.createInterface({ input: stream });
    this.outputReaders.add(lines);
    lines.once("close", () => this.outputReaders.delete(lines));
    lines.on("line", (line) => this.handleLogLine(line));
  }

  private closeOutputReaders(): void {
    for (const reader of this.outputReaders) reader.close();
    this.outputReaders.clear();
  }

  private clearHardStopTimer(): void {
    if (this.hardStopTimer) clearTimeout(this.hardStopTimer);
    this.hardStopTimer = null;
  }

  private handleLogLine(line: string): void {
    console.log(`[minecraft] ${line}`);
    this.appendLog(line.replace(/\x1b\[[0-9;]*m/g, ""));
    if (READY_LOG_PATTERNS.some((pattern) => pattern.test(line))) {
      const readyAt = Date.now();
      this.publish({
        phase: "online",
        readyAt,
        idleShutdownAt: readyAt + this.options.idleMinutes * 60_000,
        lastError: null,
      });
      return;
    }
    const join = line.match(/: ([A-Za-z0-9_]{3,16})(?: joined the game|\[[^\]]+\] logged in with entity id)/);
    if (join) {
      this.updatePlayerPresence(join[1], true);
      return;
    }
    const leave = line.match(/: ([A-Za-z0-9_]{3,16})(?: left the game| lost connection(?::|$))/);
    if (leave) {
      this.updatePlayerPresence(leave[1], false);
    }
  }

  private updatePlayerPresence(player: string, connected: boolean): void {
    const players = new Set(this.state.players);
    if (connected) players.add(player);
    else players.delete(player);
    this.publish({
      players: [...players].sort(),
      idleShutdownAt: players.size === 0
        ? (connected ? null : Date.now() + this.options.idleMinutes * 60_000)
        : null,
    });
  }

  private handleFailure(error: Error): void {
    this.publish({ phase: "error", lastError: error.message, idleShutdownAt: null });
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearHardStopTimer();
    this.closeOutputReaders();
    this.child = null;
    if (this.expectedExit) {
      this.setOffline();
      return;
    }
    this.publish({
      phase: "error",
      players: [],
      readyAt: null,
      idleShutdownAt: null,
      lastError: `Minecraft exited unexpectedly (${signal ?? code ?? "unknown"}).`,
    });
    if (this.recentOutput.length > 0) {
      console.error(`[minecraft] final output before exit:\n${this.recentOutput.slice(-FINAL_LOG_LINES).join("\n")}`);
    }
  }

  private async checkIdleShutdown(): Promise<void> {
    if (this.state.phase !== "online" || this.state.players.length > 0 || !this.state.idleShutdownAt) return;
    if (Date.now() >= this.state.idleShutdownAt) await this.stop();
  }

  async stop(): Promise<void> {
    if (this.mockStartTimer) {
      clearTimeout(this.mockStartTimer);
      this.mockStartTimer = null;
    }
    if (this.options.mockServer) {
      this.setOffline();
      return;
    }
    const child = this.child;
    if (!child) {
      this.clearHardStopTimer();
      this.closeOutputReaders();
      this.setOffline();
      return;
    }
    this.expectedExit = true;
    this.publish({ phase: "stopping", idleShutdownAt: null });
    this.clearHardStopTimer();
    this.hardStopTimer = setTimeout(() => {
      if (this.child === child) child.kill("SIGKILL");
    }, HARD_STOP_DELAY_MS);
    this.hardStopTimer.unref();
    if (child.stdin.destroyed || !child.stdin.writable) {
      child.kill("SIGKILL");
      return;
    }
    try {
      child.stdin.write("save-all\nstop\n", (error) => {
        if (error && this.child === child) child.kill("SIGKILL");
      });
    } catch {
      if (this.child === child) child.kill("SIGKILL");
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.idleTimer);
    const child = this.child;
    const waitForExit = child ? new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("exit", finish);
        resolve();
      };
      child.once("exit", finish);
      timer = setTimeout(finish, SHUTDOWN_EXIT_GRACE_MS);
      if (child.exitCode !== null || child.signalCode !== null) finish();
    }) : null;
    await this.stop();
    await waitForExit;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
