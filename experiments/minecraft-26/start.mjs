import { buildClient } from './build-client.mjs';
import { build262 } from './build-26.2.mjs';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import httpProxy from 'http-proxy';
import { source, work, java, flags } from './common.mjs';

const cloud = process.env.PREVIEW_CLOUD === 'true';
const data = cloud ? process.env.PREVIEW_DATA : null;
if (cloud && (!data || !path.isAbsolute(data))) throw Error('PREVIEW_DATA must be an absolute isolated data directory');
if (cloud) {
  await fs.access(path.join(data, '.migration-ready.json'));
  for (const directory of ['runtime', 'proxy']) await fs.cp(path.join(work, directory), path.join(data, directory), { recursive: true });
  await fs.copyFile(path.join(work, 'PreviewIdentity.jar'), path.join(data, 'proxy/plugins/PreviewIdentity.jar'));
}
const auth = cloud ? await (await import('./preview-auth.mjs')).previewAuth(data) : null;
const runtime = path.join(data || work, 'runtime');
const proxyDirectory = path.join(data || work, 'proxy');
const port = cloud ? Number(process.env.PORT || 8080) : 4262;
const lan = process.argv.includes('--lan');
const token = lan ? randomBytes(24).toString('hex') : null;
const addresses = ['127.0.0.1', 'localhost', ...Object.values(networkInterfaces()).flat().filter(n => n?.family === 'IPv4').map(n => n.address)];
function allowed(request) {
  const hostname = (request.headers.host || '').split(':')[0];
  if (cloud) return hostname === (process.env.PREVIEW_HOST || process.env.RAILWAY_PUBLIC_DOMAIN);
  if (!(lan ? addresses : ['127.0.0.1', 'localhost']).includes(hostname)) return false;
  return !lan || (request.headers.cookie || '').split(';').some(part => part.trim() === `mc26=${token}`);
}
const accepted = process.env.MC_EULA === 'true'
  || /^eula=true\s*$/m.test(await fs.readFile(path.join(runtime, 'eula.txt'), 'utf8').catch(() => ''));
if (!accepted) throw new Error('Set MC_EULA=true after accepting the Minecraft EULA. Preparation does not accept it.');
for (const port of [cloud ? Number(process.env.PORT || 8080) : 4262, 25575, 25576]) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
await fs.mkdir(path.join(proxyDirectory, 'plugins/eaglerxserver'), { recursive: true });
await fs.writeFile(path.join(runtime, 'eula.txt'), 'eula=true\n');
await fs.writeFile(path.join(runtime, 'server.properties'), `server-ip=127.0.0.1
server-port=25575
online-mode=false
enforce-secure-profile=false
level-name=world
view-distance=6
simulation-distance=4
max-players=${cloud ? 16 : 4}
max-tick-time=120000
spawn-protection=${cloud ? 16 : 0}
difficulty=${cloud ? 'normal' : 'peaceful'}
motd=Spawnpoint 26.2 local prototype
`);
await fs.writeFile(path.join(proxyDirectory, 'velocity.toml'), `config-version = "2.8"
bind = "127.0.0.1:25576"
motd = "Spawnpoint 26.2 local prototype"
show-max-players = 4
online-mode = false
force-key-authentication = false
player-info-forwarding-mode = "none"
[servers]
prototype = "127.0.0.1:25575"
try = ["prototype"]
[forced-hosts]
"lobby.example.com" = ["prototype"]
"factions.example.com" = ["prototype"]
"minigames.example.com" = ["prototype"]
[advanced]
compression-threshold = -1
[query]
enabled = false
`);
await fs.writeFile(path.join(proxyDirectory, 'plugins/eaglerxserver/settings.toml'), `server_name = "Spawnpoint 26 prototype"
eagler_login_timeout = 30000
[protocols]
min_minecraft_protocol = 775
max_minecraft_protocol = 776
max_minecraft_protocol_v5 = 776
`);
await fs.writeFile(path.join(proxyDirectory, 'plugins/eaglerxserver/listeners.toml'), `[[listener_list]]
listener_name = "prototype"
inject_address = "127.0.0.1:25576"
server_motd = ["Spawnpoint 26.2 prototype"]
`);

const children = [];
let closing = false;
let input;
async function stop() {
  if (closing) return;
  closing = true;
  input?.close();
  web.close();
  web.closeAllConnections();
  proxy.close();
  for (const socket of websockets) socket.destroy();
  for (const { child, command } of children) if (child.exitCode === null) child.stdin.end(`${command}\n`);
  const timeout = setTimeout(() => {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGTERM');
  }, 30000);
  await Promise.all(children.map(({ exited }) => exited));
  clearTimeout(timeout);
}
function launch(name, jar, memory, cwd, command) {
  const log = createWriteStream(path.join(work, `${name}.log`), { flags: 'w' });
  const child = spawn(java, [...flags, '-Xms256M', `-Xmx${memory}`, '-jar', jar, ...(name === 'paper' ? ['--nogui'] : [])],
    { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(auth ? { SPAWNPOINT_PREVIEW_SECRET: auth.secret } : {}) } });
  const exited = new Promise(resolve => {
    child.once('error', error => { console.error(error.message); process.exitCode = 1; void stop(); resolve(); });
    child.once('exit', code => { log.end(); if (!closing) { process.exitCode = code || 1; void stop(); } resolve(); });
  });
  child.stdin.on('error', () => {});
  const state = { name, child, command, exited, ready: false, identityReady: false };
  let tail = '';
  child.stdout.on('data', chunk => { tail = (tail + chunk).slice(-2048); if (/Done \(/.test(tail)) state.ready = true; if (tail.includes('SPAWNPOINT_PREVIEW_IDENTITY_READY')) state.identityReady = true; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.pipe(log, { end: false });
    if (cloud) stream.pipe(process.stdout, { end: false });
  }
  children.push(state);
}
if (!cloud) await buildClient();
const artifacts262 = await build262();
// Retire the previous server-packet lighting implementation on existing sandboxes.
await fs.rename(path.join(runtime, 'plugins/SpawnpointTorchLight.jar'), path.join(runtime, 'plugins/SpawnpointTorchLight.jar.disabled')).catch(error => { if (error.code !== 'ENOENT') throw error; });
const proxy = httpProxy.createProxyServer({ target: 'http://127.0.0.1:25576', ws: true });
proxy.on('error', (_error, _request, response) => response?.destroy());
const assets = new Map([
  ['/', [path.join(source, 'index.html'), 'text/html; charset=utf-8']],
  ['/game', [path.join(source, 'game.html'), 'text/html; charset=utf-8']],
  ['/profile.js', [path.join(source, 'profile.js'), 'text/javascript; charset=utf-8']],
  ['/client-renderer.js', [path.join(source, 'client-renderer.js'), 'text/javascript; charset=utf-8']],
  ['/controls.js', [path.join(source, 'controls.js'), 'text/javascript; charset=utf-8']],
  ['/classes.js', [path.join(work, 'client/classes-patched.js'), 'text/javascript; charset=utf-8']],
  ['/assets.epk', [path.join(work, 'client/assets.epk'), 'application/octet-stream']],
  ['/262/', [path.join(work, 'client-26.2/launch.html'), 'text/html; charset=utf-8']],
  ['/profile-26.2.js', [path.join(source, 'profile-26.2.js'), 'text/javascript; charset=utf-8']],
  ['/262/classes.wasm', [path.join(work, 'client-26.2/classes.wasm'), 'application/wasm']],
  ['/262/classes-spawnpoint.wasm.br', [path.join(work, 'client-26.2/classes-spawnpoint.wasm.br'), 'application/octet-stream']],
  ['/262/mesh-worker-spawnpoint.wasm.br', [path.join(work, 'client-26.2/mesh-worker-spawnpoint.wasm.br'), 'application/octet-stream']],
  ['/preview-login.js', [path.join(source, 'preview-login.js'), 'text/javascript; charset=utf-8']],
]);
for (const [name, artifact] of Object.entries(artifacts262)) {
  if (name === 'index.html') continue;
  assets.set(`/262/${name}`, [path.join(work, artifact.file), name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream']);
}
const web = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (cloud && url.pathname === '/healthz') {
      const ready = children.length === 2 && children.every(child => child.ready && child.child.exitCode === null && (child.name !== 'proxy' || child.identityReady));
      response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: ready, preview: true, minecraft: '26.2', server: ready ? 'online' : 'starting' })); return;
    }
    if (lan && url.pathname === '/' && url.searchParams.get('token') === token && addresses.includes((request.headers.host || '').split(':')[0])) {
      response.writeHead(303, { Location: '/', 'Set-Cookie': `mc26=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' }).end(); return;
    }
    if (!allowed(request)) { response.writeHead(403).end('Open the launch link printed in the terminal.'); return; }
    if (auth && await auth.handle(request, response, url)) return;
    if (auth && !auth.user(request) && url.pathname !== '/preview-login.js') {
      if (url.pathname !== '/') { response.writeHead(401).end('Login required'); return; }
      const html = await fs.readFile(path.join(source, 'preview-login.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html); return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const pathname = url.pathname;
    const asset = cloud && pathname === '/' ? [path.join(source, 'preview-index.html'), 'text/html; charset=utf-8'] : assets.get(pathname);
    if (cloud && ['/game', '/classes.js', '/assets.epk', '/profile.js', '/client-renderer.js'].includes(pathname)) { response.writeHead(404).end(); return; }
    if (!asset) { response.writeHead(404).end(); return; }
    const stat = await fs.stat(asset[0]);
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
    if (pathname === '/classes.js' && request.headers['if-none-match'] === etag) { response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }).end(); return; }
    response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': stat.size, ETag: etag,
      'Cache-Control': pathname === '/assets.epk' ? 'public, max-age=86400' : pathname === '/classes.js' ? 'no-cache' : 'no-store' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(asset[0]).on('error', () => response.destroy()).pipe(response);
  } catch { response.writeHead(503).end('Run npm run prototype:26:prepare first.'); }
});
const websockets = new Set();
web.on('upgrade', (request, socket, head) => {
  const expectedOrigin = `${cloud ? 'https' : 'http'}://${request.headers.host}`;
  if (!allowed(request) || request.url !== '/gateway' || request.headers.origin !== expectedOrigin) { socket.destroy(); return; }
  if (auth) {
    if (!children.some(child => child.name === 'proxy' && child.ready && child.identityReady && child.child.exitCode === null)) { socket.destroy(); return; }
    const user = auth.user(request);
    if (!user) { socket.destroy(); return; }
    request.url = `/gateway?ticket=${auth.ticket(user)}`;
    delete request.headers.cookie;
  }
  websockets.add(socket); socket.on('close', () => websockets.delete(socket));
  proxy.ws(request, socket, head);
});
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
web.listen(port, cloud || lan ? '0.0.0.0' : '127.0.0.1');
await once(web, 'listening');
launch('paper', 'paper-26.2-121.jar', '2G', runtime, 'stop');
launch('proxy', 'velocity.jar', '512M', proxyDirectory, 'shutdown');
console.log(cloud ? 'Isolated Java 26.2 preview is starting. Readiness requires the identity plugin.' : 'Prototype: http://127.0.0.1:4262. Wait for Done in work/minecraft-26/paper.log and proxy.log before joining.');
console.log(cloud ? 'Copied accounts and migrated inventories only. Production is not connected.' : 'Paper Java 26.2, browser client 26.2 0.5-dev at /262/. No production accounts or admin editing. Ctrl+C saves and stops.');
if (lan) for (const address of new Set(addresses.filter(a => a !== 'localhost'))) console.log(`Trusted LAN launch link: http://${address}:4262/?token=${token}`);
input = createInterface({ input: process.stdin });
input.on('line', line => {
  if (line === 'stop') { input.close(); void stop(); return; }
  const match = /^(paper|proxy) (.+)$/.exec(line);
  if (match && !closing) children.find(child => child.name === match[1]).child.stdin.write(`${match[2]}\n`);
});
