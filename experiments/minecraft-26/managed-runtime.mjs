import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { work, flags } from './common.mjs';

const data = process.env.DATA_DIR;
if (process.env.PREVIEW_CLOUD !== 'true' || !data || !path.isAbsolute(data)) throw Error('Isolated preview configuration required');
const receipt = JSON.parse(await fs.readFile(path.join(data, '.migration-ready.json'), 'utf8'));
if (receipt.minecraft !== '26.2') throw Error('Verified 26.2 migration required');
const runtime = path.join(data, 'runtime');
const paperPort = Number(process.env.MC26_PAPER_PORT || 25575);
const proxyPort = Number(process.env.MC26_PROXY_PORT || 25576);
const proxy = path.join(data, 'proxy');
await fs.mkdir(path.join(proxy, 'plugins/eaglerxserver'), { recursive: true });
for (const relative of ['velocity.jar', 'plugins/EaglerXServer.jar', 'plugins/ViaVersion.jar', 'plugins/ViaBackwards.jar']) {
  await fs.copyFile(path.join(work, 'proxy', relative), path.join(proxy, relative));
}
await fs.copyFile(path.join(work, 'PreviewIdentity.jar'), path.join(proxy, 'plugins/PreviewIdentity.jar'));
await fs.writeFile(path.join(proxy, 'velocity.toml'), `config-version = "2.8"
bind = "127.0.0.1:${proxyPort}"
motd = "Spawnpoint"
show-max-players = 16
online-mode = false
force-key-authentication = false
player-info-forwarding-mode = "none"
[servers]
spawnpoint = "127.0.0.1:${paperPort}"
try = ["spawnpoint"]
[forced-hosts]
"lobby.example.com" = ["spawnpoint"]
"factions.example.com" = ["spawnpoint"]
"minigames.example.com" = ["spawnpoint"]
[advanced]
compression-threshold = -1
[query]
enabled = false
`);
await fs.writeFile(path.join(proxy, 'plugins/eaglerxserver/listeners.toml'), `[[listener_list]]
listener_name = "spawnpoint"
inject_address = "127.0.0.1:${proxyPort}"
server_motd = ["Spawnpoint Java 26.2"]
`);
await fs.writeFile(path.join(proxy, 'plugins/eaglerxserver/settings.toml'), `server_name = "Spawnpoint"
eagler_login_timeout = 30000
[protocols]
min_minecraft_protocol = 776
max_minecraft_protocol = 776
max_minecraft_protocol_v5 = 776
`);
const states = [];
let closing = false;
let announced = false;
let identityReady = false;
let bridgeReady = false;
const input = createInterface({ input: process.stdin });
function stop() {
  if (closing) return;
  closing = true;
  input.close();
  for (const state of states) if (state.child.exitCode === null) state.child.stdin.end(state.stop + '\n');
  const timeout = setTimeout(() => { for (const state of states) if (state.child.exitCode === null) state.child.kill('SIGTERM'); }, 15000);
  timeout.unref();
}
function launch(name, cwd, jar, heap, stopCommand) {
  const child = spawn(process.env.MC_JAVA_BIN || 'java', [...flags, '-Xms256M', `-Xmx${heap}`, '-jar', jar, ...(name === 'paper' ? ['--nogui'] : [])], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SPAWNPOINT_PREVIEW_SECRET: process.env.SESSION_SECRET, SPAWNPOINT_PORTAL_MANAGED: 'true' },
  });
  const state = { name, child, ready: false, stop: stopCommand };
  states.push(state);
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on('line', line => {
      console.log(line);
      if (/Done \(/.test(line)) state.ready = true;
      if (line.includes('SPAWNPOINT_PREVIEW_IDENTITY_READY')) identityReady = true;
      if (name === 'paper' && line.includes('Site-ticket authentication and the loopback server bridge are active.')) bridgeReady = true;
      if (!announced && states.length === 2 && states.every(s => s.ready) && identityReady && bridgeReady) {
        announced = true;
        console.log('SPAWNPOINT_RUNTIME_READY');
      }
    });
  }
  child.stdin.on('error', () => {});
  child.on('error', error => { console.error(error); process.exitCode = 1; stop(); });
  child.on('exit', code => { if (!closing) { process.exitCode = code || 1; stop(); } });
}
launch('paper', runtime, 'paper-26.2-121.jar', `${process.env.MC_MEMORY_MB || 2048}M`, 'stop');
launch('proxy', proxy, 'velocity.jar', '512M', 'shutdown');
input.on('line', line => {
  if (line.trim() === 'stop') stop();
  else if (!closing) states[0].child.stdin.write(line + '\n');
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
