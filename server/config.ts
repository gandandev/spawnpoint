import fs from "node:fs";
import path from "node:path";

const localEnvPath = path.join(process.cwd(), ".env");
if (fs.existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const config = {
  port: integerEnv("PORT", 3000, 1, 65_535),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data")),
  clientDir: path.resolve(process.cwd(), "dist/client"),
  seedDir: path.resolve(process.cwd(), "server-runtime/seed"),
  sessionSecret: process.env.SESSION_SECRET?.trim() ?? "",
  secureCookies: process.env.NODE_ENV === "production",
  javaBin: process.env.MC_JAVA_BIN?.trim() || "java",
  eulaAccepted: process.env.MC_EULA === "true",
  memoryMb: integerEnv("MC_MEMORY_MB", 768, 512, 2_048),
  idleMinutes: integerEnv("MC_IDLE_MINUTES", 15, 5, 120),
  startCooldownSeconds: integerEnv("MC_START_COOLDOWN_SECONDS", 45, 15, 600),
  maxPlayers: integerEnv("MC_MAX_PLAYERS", 12, 2, 40),
  mockServer: process.env.MC_MOCK === "true",
  sessionDays: 30,
  gameTicketMinutes: 10,
} as const;
