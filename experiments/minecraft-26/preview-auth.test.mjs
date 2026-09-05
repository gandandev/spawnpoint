import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { hashPassword, verifyToken } from '../../dist/server/security.js';
import { previewAuth } from './preview-auth.mjs';

test('preview login uses copied credentials, rejects cross-origin and archived accounts, binds game tickets to saved identity', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'preview262-auth-'));
  const db = new Database(path.join(directory, 'spawnpoint.sqlite'));
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, game_username TEXT, display_name TEXT, password_hash BLOB, password_salt BLOB, session_version INTEGER, archived_at INTEGER)');
  const password = await hashPassword('test-password-262');
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('d3b39989-65f5-497c-9a19-c6a4b6837fe0', '테스트', 'sp_identity262', '테스트', password.hash, password.salt, 3, null);
  const auth = await previewAuth(directory);
  const server = http.createServer(async (request, response) => {
    try { if (!await auth.handle(request, response, new URL(request.url, 'http://localhost'))) response.writeHead(404).end(); }
    catch (error) { response.writeHead(500).end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const origin = `https://127.0.0.1:${server.address().port}`;
  const login = (origin, value = 'test-password-262') => fetch(url + '/preview-login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '테스트', password: value }) });
  try {
    assert.equal((await login('https://elsewhere.test')).status, 403);
    assert.equal((await login(origin, 'wrong')).status, 401);
    const response = await login(origin); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    const request = { headers: { cookie: cookie.split(';')[0] } };
    const row = auth.user(request); assert.equal(row.game_username, 'sp_identity262');
    const ticket = verifyToken(auth.ticket(row), auth.secret, 'game');
    assert.equal(ticket.username, 'sp_identity262'); assert.equal(ticket.sub, row.id);
    assert.equal(auth.user({ headers: { cookie: request.headers.cookie + 'corrupt' } }), null);
    db.prepare('UPDATE users SET session_version = 4').run(); assert.equal(auth.user(request), null);
    db.prepare('UPDATE users SET archived_at = 1').run(); assert.equal((await login(origin)).status, 401);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    auth.close(); db.close(); await fs.rm(directory, { recursive: true });
  }
});
