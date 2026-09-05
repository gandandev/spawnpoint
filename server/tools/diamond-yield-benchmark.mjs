#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { gunzipSync, inflateSync } from "node:zlib";

const root = process.cwd();
const paperJar = path.join(root, "server-runtime/seed/paper-1.12.2.jar");
const paperApiJar = path.join(root, "server-plugin/lib/paper-api-1.12.2-shaded.jar");
const outputDir = path.join(root, "output/diamond-frequent-benchmark");
const resultPath = path.join(outputDir, "result.json");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spawnpoint-diamond-yield-"));
const chunkLength = 128;
const chunkWidth = 4;
const routeLengthMeters = chunkLength * 16;
const hourlyMeters = 1000;
const seeds = [8894872356127244011n, 648921357401236789n, -39027614498127531n];
const samples = [];

const helperSource = `
package dev.spawnpoint.benchmark;

import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

public final class PregenPlugin extends JavaPlugin {
    private int chunkX = 0;
    private int chunkZ = 0;
    private int generated = 0;
    private BukkitTask task;

    @Override
    public void onEnable() {
        task = Bukkit.getScheduler().runTaskTimer(this, () -> {
            World world = Bukkit.getWorlds().get(0);
            for (int index = 0; index < 4; index++) {
                if (chunkX >= ${chunkLength}) {
                    task.cancel();
                    Bukkit.getScheduler().runTaskLater(this, () -> {
                        world.save();
                        getLogger().info("PREGEN_DONE chunks=" + generated);
                    }, 100L);
                    return;
                }
                Chunk chunk = world.getChunkAt(chunkX, chunkZ);
                chunk.load(true);
                generated++;
                chunkZ++;
                if (chunkZ >= ${chunkWidth}) {
                    chunkZ = 0;
                    chunkX++;
                }
            }
        }, 1L, 1L);
    }
}
`;

const pluginYml = `name: DiamondYieldPregen
main: dev.spawnpoint.benchmark.PregenPlugin
version: 1.0.0
load: POSTWORLD
`;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function buildHelperPlugin() {
  const sourceDir = path.join(temporaryRoot, "helper-src/dev/spawnpoint/benchmark");
  const classesDir = path.join(temporaryRoot, "helper-classes");
  const resourceDir = path.join(temporaryRoot, "helper-resources");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(classesDir, { recursive: true });
  await fs.mkdir(resourceDir, { recursive: true });
  const sourcePath = path.join(sourceDir, "PregenPlugin.java");
  await fs.writeFile(sourcePath, helperSource, "utf8");
  await fs.writeFile(path.join(resourceDir, "plugin.yml"), pluginYml, "utf8");
  await run("javac", ["--release", "8", "-cp", paperApiJar, "-d", classesDir, sourcePath]);
  const helperJar = path.join(temporaryRoot, "DiamondYieldPregen.jar");
  await run("jar", ["cf", helperJar, "-C", classesDir, ".", "-C", resourceDir, "."]);
  return helperJar;
}

async function generateWorld(seed, helperJar, index) {
  const minecraftDir = path.join(temporaryRoot, `world-${index}`);
  await fs.mkdir(path.join(minecraftDir, "plugins"), { recursive: true });
  await fs.copyFile(paperJar, path.join(minecraftDir, "paper-1.12.2.jar"));
  await fs.copyFile(helperJar, path.join(minecraftDir, "plugins/DiamondYieldPregen.jar"));
  await fs.writeFile(path.join(minecraftDir, "eula.txt"), "eula=true\n", "utf8");
  await fs.writeFile(path.join(minecraftDir, "bukkit.yml"), "settings:\n  connection-throttle: -1\nspawn-limits:\n  monsters: 0\n  animals: 0\n  water-animals: 0\n  ambient: 0\n", "utf8");
  await fs.writeFile(path.join(minecraftDir, "server.properties"), [
    "allow-nether=false",
    "difficulty=0",
    "enable-query=false",
    "enable-rcon=false",
    "generate-structures=true",
    `level-seed=${seed}`,
    "level-type=DEFAULT",
    "max-players=1",
    "online-mode=false",
    "server-ip=127.0.0.1",
    "server-port=0",
    "spawn-animals=false",
    "spawn-monsters=false",
    "spawn-npcs=false",
    "view-distance=2",
  ].join("\n") + "\n", "utf8");

  const logs = [];
  const child = spawn("java", ["-Xms256M", "-Xmx1024M", "-XX:+UseG1GC", "-jar", "paper-1.12.2.jar", "nogui"], {
    cwd: minecraftDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    logs.push(chunk);
    if (chunk.includes("PREGEN_DONE")) child.stdin.write("save-all\nstop\n");
  });
  child.stderr.on("data", (chunk) => logs.push(chunk));
  const startedAt = Date.now();
  while (child.exitCode === null && Date.now() - startedAt < 180_000) await delay(250);
  if (child.exitCode === null) {
    child.stdin.write("stop\n");
    throw new Error(`World generation timed out for seed ${seed}`);
  }
  const combined = logs.join("");
  if (child.exitCode !== 0 || !combined.includes("PREGEN_DONE")) {
    throw new Error(`World generation failed for seed ${seed}: ${combined.slice(-4000)}`);
  }
  return { minecraftDir, generationMs: Date.now() - startedAt };
}

function parseNbt(buffer) {
  const cursor = { offset: 0 };
  const need = (length) => {
    if (length < 0 || cursor.offset + length > buffer.length) throw new Error("Invalid NBT length");
  };
  const readString = () => {
    need(2);
    const length = buffer.readUInt16BE(cursor.offset);
    cursor.offset += 2;
    need(length);
    const value = buffer.toString("utf8", cursor.offset, cursor.offset + length);
    cursor.offset += length;
    return value;
  };
  const readPayload = (type) => {
    switch (type) {
      case 0: return null;
      case 1: need(1); return buffer.readInt8(cursor.offset++);
      case 2: need(2); { const value = buffer.readInt16BE(cursor.offset); cursor.offset += 2; return value; }
      case 3: need(4); { const value = buffer.readInt32BE(cursor.offset); cursor.offset += 4; return value; }
      case 4: need(8); { const value = buffer.readBigInt64BE(cursor.offset); cursor.offset += 8; return value; }
      case 5: need(4); { const value = buffer.readFloatBE(cursor.offset); cursor.offset += 4; return value; }
      case 6: need(8); { const value = buffer.readDoubleBE(cursor.offset); cursor.offset += 8; return value; }
      case 7: {
        need(4);
        const length = buffer.readInt32BE(cursor.offset);
        cursor.offset += 4;
        need(length);
        const value = buffer.subarray(cursor.offset, cursor.offset + length);
        cursor.offset += length;
        return value;
      }
      case 8: return readString();
      case 9: {
        need(5);
        const childType = buffer[cursor.offset++];
        const length = buffer.readInt32BE(cursor.offset);
        cursor.offset += 4;
        if (length < 0) throw new Error("Invalid NBT list length");
        const value = [];
        for (let index = 0; index < length; index++) value.push(readPayload(childType));
        return value;
      }
      case 10: {
        const value = {};
        while (true) {
          need(1);
          const childType = buffer[cursor.offset++];
          if (childType === 0) return value;
          const childName = readString();
          value[childName] = readPayload(childType);
        }
      }
      case 11: {
        need(4);
        const length = buffer.readInt32BE(cursor.offset);
        cursor.offset += 4;
        need(length * 4);
        const value = new Int32Array(length);
        for (let index = 0; index < length; index++) { value[index] = buffer.readInt32BE(cursor.offset); cursor.offset += 4; }
        return value;
      }
      case 12: {
        need(4);
        const length = buffer.readInt32BE(cursor.offset);
        cursor.offset += 4;
        need(length * 8);
        const value = new BigInt64Array(length);
        for (let index = 0; index < length; index++) { value[index] = buffer.readBigInt64BE(cursor.offset); cursor.offset += 8; }
        return value;
      }
      default: throw new Error(`Unknown NBT tag ${type}`);
    }
  };
  const rootType = buffer[cursor.offset++];
  if (rootType !== 10) throw new Error(`Expected NBT compound root, got ${rootType}`);
  readString();
  return readPayload(rootType);
}

async function readChunks(regionDir) {
  const chunks = new Map();
  const entries = await fs.readdir(regionDir);
  for (const entry of entries) {
    if (!/^r\.-?\d+\.-?\d+\.mca$/.test(entry)) continue;
    const region = await fs.readFile(path.join(regionDir, entry));
    for (let index = 0; index < 1024; index++) {
      const sectorOffset = region.readUIntBE(index * 4, 3);
      if (!sectorOffset) continue;
      const chunkOffset = sectorOffset * 4096;
      const storedLength = region.readUInt32BE(chunkOffset);
      const compression = region[chunkOffset + 4];
      const compressed = region.subarray(chunkOffset + 5, chunkOffset + 4 + storedLength);
      const raw = compression === 1 ? gunzipSync(compressed) : compression === 2 ? inflateSync(compressed) : compressed;
      const level = parseNbt(raw).Level;
      if (level.xPos < 0 || level.xPos >= chunkLength || level.zPos < 0 || level.zPos >= chunkWidth) continue;
      const sections = new Map();
      for (const section of level.Sections ?? []) sections.set(section.Y, section.Blocks);
      chunks.set(`${level.xPos},${level.zPos}`, { x: level.xPos, z: level.zPos, sections });
    }
  }
  return chunks;
}

function blockAt(chunks, x, y, z) {
  if (y < 0 || y > 255) return 0;
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);
  const chunk = chunks.get(`${chunkX},${chunkZ}`);
  if (!chunk) return 0;
  const blocks = chunk.sections.get(Math.floor(y / 16));
  if (!blocks) return 0;
  const localX = ((x % 16) + 16) % 16;
  const localZ = ((z % 16) + 16) % 16;
  return blocks[((y & 15) * 256) + (localZ * 16) + localX];
}

function key(x, y, z) {
  return `${x},${y},${z}`;
}

function vanillaDiamonds(chunks) {
  const diamonds = new Set();
  for (const chunk of chunks.values()) {
    for (const [sectionY, blocks] of chunk.sections) {
      for (let index = 0; index < blocks.length; index++) {
        if (blocks[index] !== 56) continue;
        const localY = Math.floor(index / 256);
        const remainder = index % 256;
        const localZ = Math.floor(remainder / 16);
        const localX = remainder % 16;
        diamonds.add(key(chunk.x * 16 + localX, sectionY * 16 + localY, chunk.z * 16 + localZ));
      }
    }
  }
  return diamonds;
}

const U64 = (value) => BigInt.asUintN(64, value);
const MIX_X = 0x9E3779B97F4A7C15n;
const MIX_Z = 0xC2B2AE3D27D4EB4Fn;
const MIX_SALT = 0x165667B19E3779F9n;
function mix64(input) {
  let value = U64(input);
  value = U64(value ^ (value >> 33n));
  value = U64(value * 0xff51afd7ed558ccdn);
  value = U64(value ^ (value >> 33n));
  value = U64(value * 0xc4ceb9fe1a85ec53n);
  return U64(value ^ (value >> 33n));
}
function mixSeed(seed, chunkX, chunkZ, salt) {
  return mix64(U64(seed) ^ U64(BigInt(chunkX) * MIX_X) ^ U64(BigInt(chunkZ) * MIX_Z) ^ U64(BigInt(salt) * MIX_SALT));
}
function bounded(value, bound) {
  return Number(U64(value) % BigInt(bound));
}
function bonusVein(seed, chunkX, chunkZ, candidate) {
  let state = mixSeed(seed, chunkX, chunkZ, candidate + 1);
  const localX = 2 + bounded(state, 12);
  state = mix64(state);
  const localY = 5 + bounded(state, 8);
  state = mix64(state);
  const localZ = 2 + bounded(state, 12);
  const result = [[chunkX * 16 + localX, localY, chunkZ * 16 + localZ]];
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (result.length < 5) {
    const previous = result[result.length - 1];
    let next = null;
    for (let attempt = 0; attempt < directions.length; attempt++) {
      state = mix64(state);
      const direction = directions[bounded(state, directions.length)];
      const candidatePosition = [previous[0] + direction[0], previous[1] + direction[1], previous[2] + direction[2]];
      const candidateLocalX = ((candidatePosition[0] % 16) + 16) % 16;
      const candidateLocalZ = ((candidatePosition[2] % 16) + 16) % 16;
      if (candidateLocalX >= 1 && candidateLocalX <= 14 && candidateLocalZ >= 1 && candidateLocalZ <= 14
        && candidatePosition[1] >= 5 && candidatePosition[1] <= 12
        && !result.some((position) => position[0] === candidatePosition[0] && position[1] === candidatePosition[1] && position[2] === candidatePosition[2])) {
        next = candidatePosition;
        break;
      }
    }
    if (!next) return [];
    result.push(next);
  }
  return result;
}

function frequentVein(seed, chunkX, chunkZ, candidate) {
  const size = 2 + bounded(mixSeed(seed, chunkX, chunkZ, 100), 4);
  let state = mixSeed(seed, chunkX, chunkZ, candidate + 101);
  const localX = 2 + bounded(state, 12);
  state = mix64(state);
  const localY = 10 + bounded(state, 3);
  state = mix64(state);
  const localZ = 2 + bounded(state, 12);
  const result = [[chunkX * 16 + localX, localY, chunkZ * 16 + localZ]];
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (result.length < size) {
    const previous = result[result.length - 1];
    let next = null;
    for (let attempt = 0; attempt < directions.length; attempt++) {
      state = mix64(state);
      const direction = directions[bounded(state, directions.length)];
      const candidatePosition = [previous[0] + direction[0], previous[1] + direction[1], previous[2] + direction[2]];
      const candidateLocalX = ((candidatePosition[0] % 16) + 16) % 16;
      const candidateLocalZ = ((candidatePosition[2] % 16) + 16) % 16;
      if (candidateLocalX >= 1 && candidateLocalX <= 14 && candidateLocalZ >= 1 && candidateLocalZ <= 14
        && candidatePosition[1] >= 10 && candidatePosition[1] <= 12
        && !result.some((position) => position[0] === candidatePosition[0] && position[1] === candidatePosition[1] && position[2] === candidatePosition[2])) {
        next = candidatePosition;
        break;
      }
    }
    if (!next) return [];
    result.push(next);
  }
  return result;
}

function isEnclosedStone(chunks, position) {
  const [x, y, z] = position;
  return blockAt(chunks, x, y, z) === 1
    && blockAt(chunks, x + 1, y, z) === 1 && blockAt(chunks, x - 1, y, z) === 1
    && blockAt(chunks, x, y + 1, z) === 1 && blockAt(chunks, x, y - 1, z) === 1
    && blockAt(chunks, x, y, z + 1) === 1 && blockAt(chunks, x, y, z - 1) === 1;
}

function legacyBonusSelected(seed, chunkX, chunkZ, rate) {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const sample = mixSeed(seed, chunkX, chunkZ, 0);
  return Number(sample >> 11n) / 9007199254740992 < rate;
}

function hasEmptyLane(counts) {
  return counts.some((count) => count === 0);
}

function balancedBonusSelected(seed, chunkX, chunkZ, rate) {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  if (rate <= 0.25) return legacyBonusSelected(seed, chunkX, chunkZ, rate);
  const tileX = Math.floor(chunkX / 4);
  const tileZ = Math.floor(chunkZ / 4);
  const localX = ((chunkX % 4) + 4) % 4;
  const localZ = ((chunkZ % 4) + 4) % 4;
  const selected = Array(16).fill(false);
  const rows = [0, 0, 0, 0];
  const columns = [0, 0, 0, 0];
  let selectedCount = 0;
  for (let index = 0; index < 16; index++) {
    const candidateLocalX = index % 4;
    const candidateLocalZ = Math.floor(index / 4);
    if (!legacyBonusSelected(seed, tileX * 4 + candidateLocalX, tileZ * 4 + candidateLocalZ, 0.25)) continue;
    selected[index] = true;
    rows[candidateLocalZ]++;
    columns[candidateLocalX]++;
    selectedCount++;
  }
  const desired = rate * 16;
  let target = Math.floor(desired);
  const quotaSample = mixSeed(seed, tileX, tileZ, 64);
  if (Number(quotaSample >> 11n) / 9007199254740992 < desired - target) target++;
  while (selectedCount < target || hasEmptyLane(rows) || hasEmptyLane(columns)) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTie = 0n;
    for (let index = 0; index < 16; index++) {
      if (selected[index]) continue;
      const candidateLocalX = index % 4;
      const candidateLocalZ = Math.floor(index / 4);
      const score = (rows[candidateLocalZ] === 0 ? 100 : 0) + (columns[candidateLocalX] === 0 ? 100 : 0)
        - rows[candidateLocalZ] - columns[candidateLocalX];
      const tie = mixSeed(seed, tileX * 4 + candidateLocalX, tileZ * 4 + candidateLocalZ, 65);
      if (score > bestScore || (score === bestScore && (bestIndex < 0 || tie < bestTie))) {
        bestIndex = index;
        bestScore = score;
        bestTie = tie;
      }
    }
    if (bestIndex < 0) break;
    selected[bestIndex] = true;
    rows[Math.floor(bestIndex / 4)]++;
    columns[bestIndex % 4]++;
    selectedCount++;
  }
  return selected[localZ * 4 + localX];
}

function addBonus(chunks, seed, diamonds, rate) {
  let veins = 0;
  for (let chunkX = 0; chunkX < chunkLength; chunkX++) {
    for (let chunkZ = 0; chunkZ < chunkWidth; chunkZ++) {
      if (!balancedBonusSelected(seed, chunkX, chunkZ, rate)) continue;
      for (let candidate = 0; candidate < 6; candidate++) {
        const vein = bonusVein(seed, chunkX, chunkZ, candidate);
        if (vein.length !== 5 || !vein.every((position) => isEnclosedStone(chunks, position))) continue;
        for (const [x, y, z] of vein) diamonds.add(key(x, y, z));
        veins++;
        break;
      }
    }
  }
  return veins;
}

function addFrequentBonus(chunks, seed, diamonds, rate) {
  let veins = 0;
  for (let chunkX = 0; chunkX < chunkLength; chunkX++) {
    for (let chunkZ = 0; chunkZ < chunkWidth; chunkZ++) {
      if (!balancedBonusSelected(seed, chunkX, chunkZ, rate)) continue;
      for (let candidate = 0; candidate < 6; candidate++) {
        const vein = frequentVein(seed, chunkX, chunkZ, candidate);
        if (vein.length < 2 || !vein.every((position) => isEnclosedStone(chunks, position) && [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].every(([dx,dy,dz]) => !diamonds.has(key(position[0]+dx, position[1]+dy, position[2]+dz))))) continue;
        for (const [x, y, z] of vein) diamonds.add(key(x, y, z));
        veins++;
        break;
      }
    }
  }
  return veins;
}

function miningRoutes(diamonds) {
  const remaining = new Set(diamonds);
  const routeTotals = new Float64Array(chunkWidth * 16 - 4);
  const routeVeins = new Float64Array(chunkWidth * 16 - 4);
  const routeHits = Array.from({ length: chunkWidth * 16 - 4 }, () => []);
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let components = 0;
  while (remaining.size) {
    const start = remaining.values().next().value;
    remaining.delete(start);
    const queue = [start];
    const component = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      component.push(current);
      const [x, y, z] = current.split(",").map(Number);
      for (const [dx, dy, dz] of directions) {
        const adjacent = key(x + dx, y + dy, z + dz);
        if (remaining.delete(adjacent)) queue.push(adjacent);
      }
    }
    components++;
    const exposedRoutes = new Set();
    let componentXTotal = 0;
    for (const coordinate of component) {
      const [x, y, z] = coordinate.split(",").map(Number);
      componentXTotal += x;
      if (x < 2 || x >= routeLengthMeters - 2) continue;
      if (y === 11 || y === 12) {
        exposedRoutes.add(z);
        exposedRoutes.add(z - 1);
        exposedRoutes.add(z + 1);
      } else if (y === 10 || y === 13) {
        exposedRoutes.add(z);
      }
    }
    for (const routeZ of exposedRoutes) {
      if (routeZ >= 2 && routeZ < chunkWidth * 16 - 2) {
        routeTotals[routeZ - 2] += component.length;
        routeVeins[routeZ - 2] += 1;
        routeHits[routeZ - 2].push(componentXTotal / component.length);
      }
    }
  }
  const routeGaps = routeHits.flatMap((hits) => {
    hits.sort((a, b) => a - b);
    return hits.slice(1).map((value, index) => value - hits[index]);
  });
  return { components, routeTotals: [...routeTotals], routeVeins: [...routeVeins], routeGaps };
}

// Verify the simulated ore coordinates against the compiled production plugin.
async function verifyFrequentLayout() {
  const source = path.join(temporaryRoot, "DiamondLayoutDump.java");
  await fs.writeFile(source, `package dev.spawnpoint;
public class DiamondLayoutDump {
  public static void main(String[] args) {
    long[] seeds = {8894872356127244011L,648921357401236789L,-39027614498127531L};
    for(long seed:seeds) for(int x=0;x<128;x++) for(int z=0;z<4;z++) for(int c=0;c<6;c++) {
      StringBuilder line = new StringBuilder();
      for(var p:SpawnpointBridgePlugin.frequentDiamondBonusVein(seed,x,z,c)) {
        if(line.length()>0) line.append(";");
        line.append(p.x()).append(",").append(p.y()).append(",").append(p.z());
      }
      System.out.println(line);
    }
  }
}`);
  const classpath = [path.join(root, "build/plugin-classes"), paperApiJar,
    path.join(root, "server-runtime/seed/plugins/EaglerXServer.jar")].join(path.delimiter);
  await run("javac", ["--release", "17", "-cp", classpath, "-d", temporaryRoot, source]);
  const { stdout } = await run("java", ["-cp", `${temporaryRoot}${path.delimiter}${classpath}`, "dev.spawnpoint.DiamondLayoutDump"]);
  const actual = stdout.replace(/\n$/, "").split("\n");
  const expected = [];
  for (const seed of seeds) for(let x=0;x<chunkLength;x++) for(let z=0;z<chunkWidth;z++) for(let c=0;c<6;c++) {
    expected.push(frequentVein(seed,x,z,c).map((p) => p.join(",")).join(";"));
  }
  if(actual.length !== expected.length || actual.some((line, i) => line !== expected[i])) {
    throw new Error("Simulated frequent vein coordinates differ from the compiled plugin");
  }
}

try {
  await verifyFrequentLayout();
  const helperJar = await buildHelperPlugin();
  for (let index = 0; index < seeds.length; index++) {
    const seed = seeds[index];
    process.stdout.write(`Generating sample ${index + 1}/${seeds.length} for seed ${seed}...\n`);
    const generated = await generateWorld(seed, helperJar, index);
    const chunks = await readChunks(path.join(generated.minecraftDir, "world/region"));
    if (chunks.size !== chunkLength * chunkWidth) throw new Error(`Expected ${chunkLength * chunkWidth} chunks, read ${chunks.size}`);
    const vanilla = vanillaDiamonds(chunks);
    const vanillaOre = vanilla.size;
    const rateVariants = {};
    for (const rate of [0, 0.35, 0.65, 0.7, 0.75, 1, "migrated"]) {
      const diamonds = new Set(vanilla);
      let bonusVeins = (rate === 0.35 || rate === "migrated") ? addBonus(chunks, seed, diamonds, 0.35) : 0;
      if (rate !== 0.35) bonusVeins += addFrequentBonus(chunks, seed, diamonds, rate === "migrated" ? 0.5 : rate);
      const mining = miningRoutes(diamonds);
      rateVariants[String(rate)] = {
        bonusVeins,
        ore: diamonds.size,
        components: mining.components,
        routeTotals: mining.routeTotals,
        routeVeins: mining.routeVeins,
        routeGaps: mining.routeGaps,
      };
    }
    const current = rateVariants["0.7"];
    samples.push({
      seed: seed.toString(),
      generationMs: generated.generationMs,
      chunks: chunks.size,
      vanillaOre,
      bonusVeins: current.bonusVeins,
      currentOre: current.ore,
      components: current.components,
      rateVariants,
    });
    await fs.rm(generated.minecraftDir, { recursive: true, force: true });
  }

  const routes = samples.flatMap((sample) => sample.rateVariants["0.7"].routeTotals);
  const veinRoutes = samples.flatMap((sample) => sample.rateVariants["0.7"].routeVeins);
  const veinGaps = samples.flatMap((sample) => sample.rateVariants["0.7"].routeGaps);
  const currentPer1000mRoutes = routes.map((value) => value * 1000 / routeLengthMeters);
  const currentPerHourRoutes = routes.map((value) => value * hourlyMeters / routeLengthMeters);
  const currentMeanPer1000m = currentPer1000mRoutes.reduce((sum, value) => sum + value, 0) / currentPer1000mRoutes.length;
  const currentMeanPerHour = currentPerHourRoutes.reduce((sum, value) => sum + value, 0) / currentPerHourRoutes.length;
  const currentMeanVeinsPer1000m = veinRoutes.reduce((sum, value) => sum + value * 1000 / routeLengthMeters, 0) / veinRoutes.length;
  const currentMeanVeinsPerHour = currentMeanVeinsPer1000m * hourlyMeters / 1000;
  const configRateVariants = {};
  for (const rate of [0, 0.35, 0.65, 0.7, 0.75, 1, "migrated"]) {
    const variantRoutes = samples.flatMap((sample) => sample.rateVariants[String(rate)].routeTotals);
    const variantVeinRoutes = samples.flatMap((sample) => sample.rateVariants[String(rate)].routeVeins);
    const averagePerHour = variantRoutes.reduce((sum, value) => sum + value * hourlyMeters / routeLengthMeters, 0) / variantRoutes.length;
    const averageVeinsPerHour = variantVeinRoutes.reduce((sum, value) => sum + value * hourlyMeters / routeLengthMeters, 0) / variantVeinRoutes.length;
    configRateVariants[String(rate)] = {
      averageOrePerHour: Number(averagePerHour.toFixed(2)),
      averageVeinsPerHour: Number(averageVeinsPerHour.toFixed(2)),
      relativeToCurrent: Number((averagePerHour / currentMeanPerHour).toFixed(3)),
      expectedFortune3DiamondsPerHour: Number((averagePerHour * 2.2).toFixed(2)),
    };
  }
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      minecraft: "Paper 1.12.2 actual terrain generation",
      seeds: seeds.map(String),
      chunksPerSeed: chunkLength * chunkWidth,
      totalChunks: seeds.length * chunkLength * chunkWidth,
      routeCount: routes.length,
      sampledRouteMeters: routes.length * routeLengthMeters,
      tunnel: "straight 1-wide x 2-high tunnel at Y=11 and Y=12; collect every face-exposed connected diamond vein",
      assumedMetersPerHour: hourlyMeters,
      currentBonus: "one enclosed 2-5 ore vein at Y=10-12 in 70% of new chunks; 50% additional pass on profile-2 chunks",

      fortune3ExpectedDropsPerOre: 2.2,
    },
    samples: samples.map(({ rateVariants, ...sample }) => ({
      ...sample,
      routes: rateVariants["0.7"].routeTotals.length,
      rateVariants: Object.fromEntries(Object.entries(rateVariants).map(([rate, variant]) => [rate, {
        bonusVeins: variant.bonusVeins,
        ore: variant.ore,
        components: variant.components,
      }])),
    })),
    currentDistribution: {
      averageOrePer1000m: Number(currentMeanPer1000m.toFixed(2)),
      averageOrePerHour: Number(currentMeanPerHour.toFixed(2)),
      p10OrePerHour: Number(percentile(currentPerHourRoutes, 0.1).toFixed(2)),
      medianOrePerHour: Number(percentile(currentPerHourRoutes, 0.5).toFixed(2)),
      p90OrePerHour: Number(percentile(currentPerHourRoutes, 0.9).toFixed(2)),
      averageVeinsPer1000m: Number(currentMeanVeinsPer1000m.toFixed(2)),
      averageVeinsPerHour: Number(currentMeanVeinsPerHour.toFixed(2)),
      averageMetersPerVein: Number((1000 / currentMeanVeinsPer1000m).toFixed(2)),
      averageMinutesPerVeinAtAssumedSpeed: Number((60 / currentMeanVeinsPerHour).toFixed(2)),
      gapMeters: {
        median: Number(percentile(veinGaps, 0.5).toFixed(2)),
        p90: Number(percentile(veinGaps, 0.9).toFixed(2)),
        p95: Number(percentile(veinGaps, 0.95).toFixed(2)),
        maximumInSample: Number(Math.max(...veinGaps).toFixed(2)),
      },
    },
    configRateVariants,
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
