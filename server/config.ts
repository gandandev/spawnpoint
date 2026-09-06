import fs from "node:fs";
import path from "node:path";

const localEnvPath = path.join(process.cwd(), ".env");
if (fs.existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const config = {
  minecraftVersion: (process.env.PREVIEW_CLOUD === "true" || process.env.MC_VERSION === "26.2") ? "26.2" as const : undefined,
  port: integerEnv("PORT", 3000, 1, 65_535),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data")),
  clientDir: path.resolve(process.cwd(), "dist/client"),
  assetRootDir: path.resolve(process.cwd(), "public"),
  serveClient: process.env.SERVE_CLIENT !== "false",
  seedDir: path.resolve(process.cwd(), "server-runtime/seed"),
  sessionSecret: process.env.SESSION_SECRET?.trim() ?? "",
  serverPassword: process.env.SERVER_PASSWORD?.trim() ?? "",
  adminUsernames: listEnv("SPAWNPOINT_ADMIN_USERNAMES"),
  adminUserIds: listEnv("SPAWNPOINT_ADMIN_USER_IDS"),
  adminPassword: process.env.SPAWNPOINT_ADMIN_PASSWORD?.trim()
    ?? (process.env.NODE_ENV === "production" ? "" : "G4ndan"),
  bridgePort: integerEnv("SPAWNPOINT_BRIDGE_PORT", 25_566, 1_024, 65_535),
  secureCookies: process.env.NODE_ENV === "production",
  javaBin: process.env.MC_JAVA_BIN?.trim() || "java",
  eulaAccepted: process.env.MC_EULA === "true",
  memoryMb: integerEnv("MC_MEMORY_MB", 512, 512, 2_048),
  idleMinutes: integerEnv("MC_IDLE_MINUTES", 3, 1, 120),
  startCooldownSeconds: integerEnv("MC_START_COOLDOWN_SECONDS", 45, 15, 600),
  maxPlayers: integerEnv("MC_MAX_PLAYERS", 16, 2, 40),
  mockServer: process.env.MC_MOCK === "true",
  frontendVersionUrl: process.env.SPAWNPOINT_FRONTEND_VERSION_URL?.trim() ?? "",
  sessionDays: 30,
  gameTicketMinutes: 10,
} as const;
