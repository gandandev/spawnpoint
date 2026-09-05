#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { gunzipSync, inflateSync } from "node:zlib";

// Export the profile-2 JAR from the pre-change commit, then pass its path below.
const previousPluginPath = process.env.DIAMOND_PREVIOUS_PLUGIN;
if (!previousPluginPath) throw new Error("Set DIAMOND_PREVIOUS_PLUGIN to the deployed profile-2 plugin JAR");
const root = process.cwd();
const seedDir = path.join(root, "server-runtime/seed");
const testId = crypto.randomUUID();
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spawnpoint-diamond-retrogen-"));
const minecraftDir = path.join(temporaryRoot, "minecraft");
const configPath = path.join(minecraftDir, "plugins/SpawnpointBridge/config.yml");
const markerPath = path.join(minecraftDir, "plugins/SpawnpointBridge/diamond-bonus-processed.bin");
const outputDir = path.join(root, "output/diamond-retrogen-e2e", testId);
const resultPath = path.join(outputDir, "result.json");
const sessionSecret = `diamond-retrogen-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const bridgePort = await unusedPort();
const result = {
  schemaVersion: 1,
  testId,
  startedAt: new Date().toISOString(),
  profile: {
    paper: "1.12.2",
    memoryMb: 512,
    existingTerrainFirstBoot: true,
    bonusRate: 0.70,
    expectedOneTimeApplication: true,
  },
  phases: [],
  assertions: {},
  cleanup: {},
  success: false,
};
let paper = null;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close((error) => resolve(!error)));
  });
}

async function waitFor(operation, description, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError}` : ""}`);
}

function captureLines(stream, source, logs) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      logs.push({ source, line });
      if (/Done \(|Diamond bonus|ERROR|SEVERE/i.test(line)) process.stdout.write(`[${source}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) logs.push({ source, line: pending });
  });
}

async function startPaper(label) {
  const logs = [];
  const startedAt = Date.now();
  paper = spawn("java", [
    "-Xms256M",
    "-Xmx512M",
    "-XX:+UseG1GC",
    "-XX:MaxGCPauseMillis=100",
    "-Dfile.encoding=UTF-8",
    "-Dpaper.disableChannelLimit=true",
    "-jar",
    "paper-1.12.2.jar",
  ], {
    cwd: minecraftDir,
    env: {
      ...process.env,
      DATA_DIR: temporaryRoot,
      PORTAL_INTERNAL_ORIGIN: "http://127.0.0.1:9",
      SESSION_SECRET: sessionSecret,
      SPAWNPOINT_BRIDGE_PORT: String(bridgePort),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  captureLines(paper.stdout, "stdout", logs);
  captureLines(paper.stderr, "stderr", logs);
  const readiness = await waitFor(() => {
    if (logs.some(({ line }) => /Done \([\d.]+s\)!/.test(line))) return { ready: true };
    if (paper.exitCode !== null) return { ready: false, exitCode: paper.exitCode };
    return null;
  }, `${label} Paper readiness`, 120_000, 100);
  if (!readiness.ready) {
    throw new Error(`Paper exited with ${readiness.exitCode}: ${logs.slice(-12).map(({ line }) => line).join(" | ")}`);
  }
  return { label, logs, startupMs: Date.now() - startedAt };
}

async function stopPaper(phase) {
  if (!paper || paper.exitCode !== null) return;
  paper.stdin.write("save-all\nstop\n");
  await waitFor(() => paper.exitCode !== null, `${phase.label} Paper shutdown`, 30_000, 100);
  phase.exitCode = paper.exitCode;
  paper = null;
}

function setDiamondBonus(config, enabled, rate) {
  const replacement = `diamond-bonus:\n  enabled: ${enabled ? "true" : "false"}`;
  if (!/diamond-bonus:\s*\n\s*enabled:\s*(?:true|false)/.test(config)) {
    throw new Error("SpawnpointBridge config does not contain diamond-bonus.enabled");
  }
  const updated = config.replace(/diamond-bonus:\s*\n\s*enabled:\s*(?:true|false)/, replacement);
  if (!/\n\s*rate:\s*[\d.]+/.test(updated)) {
    throw new Error("SpawnpointBridge config does not contain diamond-bonus.rate");
  }
  return updated.replace(/(\n\s*rate:)\s*[\d.]+/, `$1 ${rate}`);
}

function skipNbtPayload(buffer, cursor, type, name, counter) {
  const requireBytes = (length) => {
    if (length < 0 || cursor.offset + length > buffer.length) throw new Error("Invalid NBT length");
  };
  switch (type) {
    case 0:
      return;
    case 1:
      requireBytes(1);
      cursor.offset += 1;
      return;
    case 2:
      requireBytes(2);
      cursor.offset += 2;
      return;
    case 3:
    case 5:
      requireBytes(4);
      cursor.offset += 4;
      return;
    case 4:
    case 6:
      requireBytes(8);
      cursor.offset += 8;
      return;
    case 7: {
      requireBytes(4);
      const length = buffer.readInt32BE(cursor.offset);
      cursor.offset += 4;
      requireBytes(length);
      if (name === "Blocks") {
        for (let index = cursor.offset; index < cursor.offset + length; index += 1) {
          if (buffer[index] === 56) counter.diamondOre += 1;
        }
      }
      cursor.offset += length;
      return;
    }
    case 8: {
      requireBytes(2);
      const length = buffer.readUInt16BE(cursor.offset);
      cursor.offset += 2;
      requireBytes(length);
      cursor.offset += length;
      return;
    }
    case 9: {
      requireBytes(5);
      const childType = buffer[cursor.offset];
      const length = buffer.readInt32BE(cursor.offset + 1);
      cursor.offset += 5;
      if (length < 0) throw new Error("Invalid NBT list length");
      for (let index = 0; index < length; index += 1) skipNbtPayload(buffer, cursor, childType, null, counter);
      return;
    }
    case 10:
      while (true) {
        requireBytes(1);
        const childType = buffer[cursor.offset++];
        if (childType === 0) return;
        requireBytes(2);
        const nameLength = buffer.readUInt16BE(cursor.offset);
        cursor.offset += 2;
        requireBytes(nameLength);
        const childName = buffer.toString("utf8", cursor.offset, cursor.offset + nameLength);
        cursor.offset += nameLength;
        skipNbtPayload(buffer, cursor, childType, childName, counter);
      }
    case 11:
    case 12: {
      requireBytes(4);
      const length = buffer.readInt32BE(cursor.offset);
      cursor.offset += 4;
      const bytesPerEntry = type === 11 ? 4 : 8;
      requireBytes(length * bytesPerEntry);
      cursor.offset += length * bytesPerEntry;
      return;
    }
    default:
      throw new Error(`Unknown NBT tag type ${type}`);
  }
}

function countChunkDiamonds(buffer) {
  const cursor = { offset: 0 };
  const counter = { diamondOre: 0 };
  const rootType = buffer[cursor.offset++];
  if (rootType !== 10) throw new Error(`Expected compound NBT root, got ${rootType}`);
  const rootNameLength = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2 + rootNameLength;
  skipNbtPayload(buffer, cursor, rootType, null, counter);
  return counter.diamondOre;
}

async function countRegionDiamonds(file) {
  const region = await fs.readFile(file);
  if (region.length < 8192) throw new Error(`Invalid region file ${file}`);
  let diamonds = 0;
  let chunks = 0;
  for (let index = 0; index < 1024; index += 1) {
    const headerOffset = index * 4;
    const sectorOffset = region.readUIntBE(headerOffset, 3);
    if (sectorOffset === 0) continue;
    const chunkOffset = sectorOffset * 4096;
    if (chunkOffset + 5 > region.length) throw new Error(`Invalid chunk offset in ${file}`);
    const storedLength = region.readUInt32BE(chunkOffset);
    const compression = region[chunkOffset + 4];
    if (storedLength < 2 || chunkOffset + 4 + storedLength > region.length) throw new Error(`Invalid chunk length in ${file}`);
    const compressed = region.subarray(chunkOffset + 5, chunkOffset + 4 + storedLength);
    const nbt = compression === 1
      ? gunzipSync(compressed)
      : compression === 2 ? inflateSync(compressed) : compression === 3 ? compressed : null;
    if (!nbt) throw new Error(`Unsupported region compression ${compression}`);
    diamonds += countChunkDiamonds(nbt);
    chunks += 1;
  }
  return { diamonds, chunks };
}

async function countWorldDiamonds() {
  const regionDir = path.join(minecraftDir, "world/region");
  const entries = await fs.readdir(regionDir, { withFileTypes: true });
  let diamonds = 0;
  let chunks = 0;
  let files = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^r\.-?\d+\.-?\d+\.mca$/.test(entry.name)) continue;
    const count = await countRegionDiamonds(path.join(regionDir, entry.name));
    diamonds += count.diamonds;
    chunks += count.chunks;
    files += 1;
  }
  return { diamonds, chunks, regionFiles: files };
}

async function readMarkerState() {
  const marker = await fs.readFile(markerPath);
  if (marker.length < 12 || marker.readUInt32BE(0) !== 0x5350444D) {
    throw new Error("Invalid diamond marker header");
  }
  const version = marker.readUInt32BE(4);
  if (version === 1) {
    const legacyCount = marker.readUInt32BE(8);
    const legacyEntries = marker.subarray(12, 12 + legacyCount * 24);
    if (legacyEntries.length !== legacyCount * 24 || 12 + legacyEntries.length !== marker.length) {
      throw new Error("Invalid legacy diamond marker length");
    }
    return { version, legacyCount, balancedCount: 0, legacyEntries, balancedEntries: Buffer.alloc(0) };
  }
  if (version !== 2 && version !== 3) throw new Error(`Unsupported diamond marker version ${version}`);
  const legacyCount = marker.readUInt32BE(8);
  const legacyStart = 12;
  const legacyEnd = legacyStart + legacyCount * 24;
  if (legacyEnd + 4 > marker.length) throw new Error("Invalid diamond marker length");
  const balancedCount = marker.readUInt32BE(legacyEnd);
  const balancedStart = legacyEnd + 4;
  const balancedEnd = balancedStart + balancedCount * 24;
  const frequentCount = version === 3 ? marker.readUInt32BE(balancedEnd) : 0;
  if (balancedEnd + (version === 3 ? 4 + frequentCount * 24 : 0) !== marker.length) throw new Error("Invalid diamond marker length");
  return {
    version,
    legacyCount,
    balancedCount,
    frequentCount,
    legacyEntries: marker.subarray(legacyStart, legacyEnd),
    balancedEntries: marker.subarray(balancedStart, balancedEnd),
  };
}

async function convertBalancedMarkerToLegacyV1() {
  const state = await readMarkerState();
  if (state.version !== 2 || state.balancedCount <= 0) throw new Error("Expected populated version 2 marker before migration fixture");
  const header = Buffer.alloc(12);
  header.writeUInt32BE(0x5350444D, 0);
  header.writeUInt32BE(1, 4);
  header.writeUInt32BE(state.balancedCount, 8);
  await fs.writeFile(markerPath, Buffer.concat([header, state.balancedEntries]));
  return state.balancedCount;
}

async function readDiamondProfile() {
  const config = await fs.readFile(configPath, "utf8");
  const existingRate = /\n\s*existing-chunk-rate:\s*([\d.]+)/.exec(config)?.[1];
  const rate = /\n\s*rate:\s*([\d.]+)/.exec(config)?.[1];
  const version = /\n\s*profile-version:\s*(\d+)/.exec(config)?.[1];
  return {
    existingRate: existingRate === undefined ? null : Number(existingRate),
    rate: rate === undefined ? null : Number(rate),
    version: version === undefined ? null : Number(version),
  };
}

try {
  if (!(await isPortFree(25565))) throw new Error("Port 25565 is already in use");
  await fs.cp(seedDir, minecraftDir, { recursive: true, force: false });
  await fs.copyFile(previousPluginPath, path.join(minecraftDir, "plugins/SpawnpointBridge.jar"));
  await fs.writeFile(path.join(minecraftDir, "eula.txt"), "eula=true\n", "utf8");
  const propertiesPath = path.join(minecraftDir, "server.properties");
  const properties = await fs.readFile(propertiesPath, "utf8");
  const fixedSeedProperties = /^level-seed=.*$/m.test(properties)
    ? properties.replace(/^level-seed=.*$/m, "level-seed=8894872356127244011")
    : `${properties.trimEnd()}\nlevel-seed=8894872356127244011\n`;
  await fs.writeFile(propertiesPath, fixedSeedProperties, "utf8");
  let config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, setDiamondBonus(config, false, 0.35).replace(/profile-version:\s*3/, "profile-version: 2"), "utf8");

  const baselinePhase = await startPaper("baseline-existing-terrain");
  result.phases.push(baselinePhase);
  await delay(2_000);
  await stopPaper(baselinePhase);
  const baseline = await countWorldDiamonds();
  result.baseline = baseline;

  config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, setDiamondBonus(config, true, 0.25), "utf8");
  const legacyPhase = await startPaper("legacy-quarter-first-load");
  result.phases.push(legacyPhase);
  await delay(20_000);
  await stopPaper(legacyPhase);
  const afterLegacy = await countWorldDiamonds();
  const legacyV1MarkerCount = await convertBalancedMarkerToLegacyV1();
  result.afterLegacy = { ...afterLegacy, markerCount: legacyV1MarkerCount };

  config = await fs.readFile(configPath, "utf8");
  config = setDiamondBonus(config, true, 0.25).replace(/^\s*profile-version:\s*\d+\s*$/m, "");
  await fs.writeFile(configPath, config, "utf8");
  const migrationPhase = await startPaper("balanced-v1-migration");
  result.phases.push(migrationPhase);
  await delay(20_000);
  await stopPaper(migrationPhase);
  const afterBonus = await countWorldDiamonds();
  const migratedMarker = await readMarkerState();
  const migratedProfile = await readDiamondProfile();
  result.afterBonus = {
    ...afterBonus,
    markerVersion: migratedMarker.version,
    legacyMarkerCount: migratedMarker.legacyCount,
    markerCount: migratedMarker.balancedCount,
    profile: migratedProfile,
  };

  await fs.copyFile(path.join(seedDir, "plugins/SpawnpointBridge.jar"), path.join(minecraftDir, "plugins/SpawnpointBridge.jar"));
  const frequentPhase = await startPaper("frequent-v2-migration");
  result.phases.push(frequentPhase);
  await delay(20_000);
  await stopPaper(frequentPhase);
  const afterFrequent = await countWorldDiamonds();
  const frequentMarker = await readMarkerState();
  const frequentProfile = await readDiamondProfile();
  result.afterFrequent = { ...afterFrequent, markerCount: frequentMarker.frequentCount, profile: frequentProfile };

  const repeatPhase = await startPaper("bonus-repeat-load");
  result.phases.push(repeatPhase);
  await delay(5_000);
  await stopPaper(repeatPhase);
  const afterRepeat = await countWorldDiamonds();
  const repeatMarker = await readMarkerState();
  result.afterRepeat = { ...afterRepeat, markerCount: repeatMarker.frequentCount };

  result.assertions = {
    baselineChunksWereAlreadyGenerated: baseline.chunks > 0,
    legacyBonusAddedDiamondOre: afterLegacy.diamonds > baseline.diamonds,
    migrationAddedOnlyMissingDiamondOre: afterBonus.diamonds > afterLegacy.diamonds,
    bonusAddedExactWholeVeins: (afterBonus.diamonds - baseline.diamonds) % 5 === 0
      && (afterBonus.diamonds - afterLegacy.diamonds) % 5 === 0,
    bonusIsNearExpectedIncrease: (afterBonus.diamonds - baseline.diamonds) / baseline.diamonds >= 0.35
      && (afterBonus.diamonds - baseline.diamonds) / baseline.diamonds <= 0.65,
    legacyMarkersMigrated: migratedMarker.version === 2
      && migratedMarker.legacyCount === legacyV1MarkerCount
      // Additional chunks can load between boots, increasing the processed count.
      && migratedMarker.balancedCount >= legacyV1MarkerCount,
    legacyConfigMigrated: migratedProfile.rate === 0.35 && migratedProfile.version === 2,
    frequentPassAddedOreToExistingChunks: afterFrequent.diamonds > afterBonus.diamonds,
    frequentMarkersMigrated: frequentMarker.version === 3
      && frequentMarker.legacyCount === migratedMarker.legacyCount
      && frequentMarker.balancedCount === migratedMarker.balancedCount
      && frequentMarker.frequentCount > 0
      && frequentMarker.legacyEntries.equals(migratedMarker.legacyEntries)
      && frequentMarker.balancedEntries.equals(migratedMarker.balancedEntries),
    frequentConfigMigrated: frequentProfile.rate === 0.70 && frequentProfile.existingRate === 0.50 && frequentProfile.version === 3,
    repeatLoadAddedNoDiamondOre: afterRepeat.diamonds === afterFrequent.diamonds,
    repeatLoadAddedNoMarkers: repeatMarker.frequentCount === frequentMarker.frequentCount,
  };
  result.success = Object.values(result.assertions).every(Boolean);
  if (!result.success) throw new Error(`Diamond retrogen assertions failed: ${JSON.stringify(result.assertions)}`);
} catch (error) {
  result.failure = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  if (paper && paper.exitCode === null) {
    paper.stdin.write("save-all\nstop\n");
    await waitFor(() => paper.exitCode !== null, "cleanup Paper shutdown", 30_000, 100).catch(() => paper.kill("SIGTERM"));
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  result.cleanup = {
    checkedAt: new Date().toISOString(),
    temporaryRootRemoved: !(await fs.stat(temporaryRoot).then(() => true).catch(() => false)),
    port25565Free: await isPortFree(25565),
    bridgePortFree: await isPortFree(bridgePort),
  };
  result.finishedAt = new Date().toISOString();
  if (!Object.values(result.cleanup).filter((value) => typeof value === "boolean").every(Boolean)) result.success = false;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    resultPath,
    success: result.success,
    baseline: result.baseline,
    afterLegacy: result.afterLegacy,
    afterBonus: result.afterBonus,
    afterRepeat: result.afterRepeat,
    assertions: result.assertions,
    cleanup: result.cleanup,
    failure: result.failure,
  }, null, 2)}\n`);
  process.exitCode = result.success ? 0 : 1;
}
