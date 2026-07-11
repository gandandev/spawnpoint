import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ServerStatus } from "./types.js";

interface ServerManagerOptions {
  dataDir: string;
  seedDir: string;
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
  "server.properties",
  "bukkit.yml",
  "plugins/EaglerXServer.jar",
  "plugins/SpawnpointBridge.jar",
  "plugins/EaglercraftXServer/settings.yml",
  "plugins/EaglercraftXServer/listener.yml",
];

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

  private publish(patch: Partial<ServerStatus>): void {
    this.state = { ...this.state, ...patch };
    this.emit("status", this.getStatus());
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
          PORTAL_INTERNAL_ORIGIN: `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
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
    lines.on("line", (line) => this.handleLogLine(line));
  }

  private handleLogLine(line: string): void {
    console.log(`[minecraft] ${line}`);
    this.recentOutput.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
    if (this.recentOutput.length > 30) this.recentOutput.shift();
    if (/Done \([\d.]+s\)!/.test(line) || /For help, type "help"/.test(line)) {
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
      const players = new Set(this.state.players);
      players.add(join[1]);
      this.publish({ players: [...players].sort(), idleShutdownAt: null });
      return;
    }
    const leave = line.match(/: ([A-Za-z0-9_]{3,16}) left the game/);
    if (leave) {
      const players = new Set(this.state.players);
      players.delete(leave[1]);
      this.publish({
        players: [...players].sort(),
        idleShutdownAt: players.size === 0 ? Date.now() + this.options.idleMinutes * 60_000 : null,
      });
    }
  }

  private handleFailure(error: Error): void {
    this.publish({ phase: "error", lastError: error.message, idleShutdownAt: null });
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.expectedExit) {
      this.publish({ phase: "off", players: [], startedAt: null, readyAt: null, idleShutdownAt: null });
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
      console.error(`[minecraft] final output before exit:\n${this.recentOutput.slice(-12).join("\n")}`);
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
      this.publish({ phase: "off", players: [], startedAt: null, readyAt: null, idleShutdownAt: null });
      return;
    }
    const child = this.child;
    if (!child) {
      this.publish({ phase: "off", players: [], startedAt: null, readyAt: null, idleShutdownAt: null });
      return;
    }
    this.expectedExit = true;
    this.publish({ phase: "stopping", idleShutdownAt: null });
    child.stdin.write("save-all\nstop\n");
    const hardStop = setTimeout(() => {
      if (this.child === child) child.kill("SIGKILL");
    }, 20_000);
    hardStop.unref();
  }

  async shutdown(): Promise<void> {
    clearInterval(this.idleTimer);
    await this.stop();
  }
}
