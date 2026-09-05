import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { parse, serialize } from 'cookie';
import { verifyPassword, signToken, verifyToken } from '../../dist/server/security.js';

export async function previewAuth(directory) {
  const secretFile = path.join(directory, '.preview-secret');
  let secret;
  try { secret = await fs.readFile(secretFile, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    secret = randomBytes(32).toString('hex');
    await fs.writeFile(secretFile, secret, { flag: 'wx', mode: 0o600 });
  }
  if (secret.length < 32) throw Error('Preview session secret is invalid');
  const db = new Database(path.join(directory, 'spawnpoint.sqlite'), { readonly: true });
  const byName = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND archived_at IS NULL');
  const byId = db.prepare('SELECT * FROM users WHERE id = ? AND archived_at IS NULL');
  const attempts = new Map();
  const cookie = 'spawnpoint_preview26';
  function user(request) {
    const session = verifyToken(parse(request.headers.cookie || '')[cookie], secret, 'session');
    const row = session ? byId.get(session.sub) : null;
    return row && row.session_version === session.sessionVersion ? row : null;
  }
  const json = (response, code, value) => response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
  async function handle(request, response, url) {
    if (url.pathname === '/preview-session' && request.method === 'GET') {
      const row = user(request);
      json(response, row ? 200 : 401, row ? { username: row.game_username, displayName: row.display_name } : { error: '로그인이 필요해요.' });
      return true;
    }
    if (url.pathname !== '/preview-login') return false;
    if (request.method !== 'POST' || request.headers.origin !== `https://${request.headers.host}`) {
      json(response, 403, { error: '이 페이지에서 다시 로그인하세요.' }); return true;
    }
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    const ip = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress).split(',')[0].trim();
    const entry = attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
    if (entry.count >= 10 || attempts.size > 5000) { json(response, 429, { error: '잠시 후 다시 시도하세요.' }); return true; }
    entry.count++; attempts.set(ip, entry);
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 8192) { json(response, 413, { error: '입력이 너무 길어요.' }); return true; }
    }
    let credentials;
    try { credentials = JSON.parse(body); } catch { json(response, 400, { error: '입력을 확인하세요.' }); return true; }
    const name = typeof credentials.username === 'string' ? credentials.username.normalize('NFC').trim() : '';
    const password = credentials.password;
    if (name.length > 64 || typeof password !== 'string' || password.length < 1 || password.length > 128) {
      json(response, 400, { error: '이름과 비밀번호를 확인하세요.' }); return true;
    }
    const row = byName.get(name);
    const valid = await verifyPassword(password, row?.password_salt ?? Buffer.alloc(16), row?.password_hash ?? Buffer.alloc(32));
    if (!row || !valid) { json(response, 401, { error: '이름 또는 비밀번호가 맞지 않아요.' }); return true; }
    attempts.delete(ip);
    const seconds = Math.floor(now / 1000);
    const token = signToken({ aud: 'session', sub: row.id, username: row.username, sessionVersion: row.session_version, iat: seconds, exp: seconds + 86400 }, secret);
    response.setHeader('Set-Cookie', serialize(cookie, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 86400 }));
    json(response, 200, { ok: true });
    return true;
  }
  function ticket(row) {
    const now = Math.floor(Date.now() / 1000);
    return signToken({ aud: 'game', sub: row.id, username: row.game_username, iat: now, exp: now + 120 }, secret);
  }
  return { user, handle, ticket, secret, close: () => db.close() };
}
