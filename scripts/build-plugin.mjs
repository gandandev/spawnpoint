import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const classes = path.join(root, "build/plugin-classes");
const source = path.join(root, "server-plugin/src/dev/spawnpoint/SpawnpointBridgePlugin.java");
const paper = path.join(root, "server-plugin/lib/paper-api-1.12.2-shaded.jar");
const eagler = path.join(root, "server-runtime/seed/plugins/EaglerXServer.jar");
const output = path.join(root, "server-runtime/seed/plugins/SpawnpointBridge.jar");

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await fs.rm(classes, { recursive: true, force: true });
await fs.mkdir(classes, { recursive: true });
await run("javac", ["--release", "17", "-encoding", "UTF-8", "-cp", `${paper}${path.delimiter}${eagler}`, "-d", classes, source]);
await fs.copyFile(path.join(root, "server-plugin/plugin.yml"), path.join(classes, "plugin.yml"));
await fs.rm(output, { force: true });
await run("jar", ["cf", output, "-C", classes, "."]);
console.log(`built ${path.relative(root, output)}`);
