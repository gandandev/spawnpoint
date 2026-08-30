import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const classes = path.join(root, "build/plugin-classes");
const testClasses = path.join(root, "build/plugin-test-classes");
const source = path.join(root, "server-plugin/src/dev/spawnpoint/SpawnpointBridgePlugin.java");
const testSource = path.join(root, "server-plugin/test/dev/spawnpoint/CommandRewriteTest.java");
const paper = path.join(root, "server-plugin/lib/paper-api-1.12.2-shaded.jar");
const eagler = path.join(root, "server-runtime/seed/plugins/EaglerXServer.jar");
const output = path.join(root, "server-runtime/seed/plugins/SpawnpointBridge.jar");
const archiveDate = "2020-01-01T00:00:00Z";

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await fs.rm(classes, { recursive: true, force: true });
await fs.rm(testClasses, { recursive: true, force: true });
await fs.mkdir(classes, { recursive: true });
await fs.mkdir(testClasses, { recursive: true });
await run("javac", ["--release", "17", "-encoding", "UTF-8", "-cp", `${paper}${path.delimiter}${eagler}`, "-d", classes, source]);
await run("javac", [
  "--release", "17", "-encoding", "UTF-8",
  "-cp", `${classes}${path.delimiter}${paper}${path.delimiter}${eagler}`,
  "-d", testClasses,
  testSource,
]);
await run("java", [
  "-cp", `${testClasses}${path.delimiter}${classes}${path.delimiter}${paper}${path.delimiter}${eagler}`,
  "dev.spawnpoint.CommandRewriteTest",
]);
await fs.copyFile(path.join(root, "server-plugin/plugin.yml"), path.join(classes, "plugin.yml"));
await fs.rm(output, { force: true });
await run("jar", ["--create", "--file", output, `--date=${archiveDate}`, "-C", classes, "."]);
console.log(`built ${path.relative(root, output)}`);
