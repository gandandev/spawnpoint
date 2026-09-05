import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(directory, '../../src/components/pixel-icon-data.json');
const revision = text => createHash('sha256').update(text).digest('hex');

export function createIconEditor(dataPath = source) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    // This development tool writes source files and accepts only its own loopback origin.
    const expectedHost = `127.0.0.1:${res.socket.localPort}`;
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) {
      reply(403, { error: '편집 화면에서 다시 시도해 주세요.' });
      return;
    }
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'" });
        res.end(readFileSync(path.join(directory, 'index.html')));
      } else if (req.method === 'GET' && req.url === '/icons') {
        const text = readFileSync(dataPath, 'utf8');
        reply(200, { icons: JSON.parse(text), revision: revision(text) });
      } else if (req.method === 'PUT' && req.url === '/icons') {
        if (req.headers['content-type'] !== 'application/json') {
          reply(415, { error: 'JSON 형식이 필요해요.' });
          return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 100_000) {
            reply(413, { error: '저장할 데이터가 너무 커요.' });
            return;
          }
        }
        let payload;
        try { payload = JSON.parse(body); } catch { reply(400, { error: '데이터를 읽을 수 없어요.' }); return; }
        const text = readFileSync(dataPath, 'utf8');
        const icons = JSON.parse(text);
        const changes = payload?.changes;
        if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.entries(changes).some(([name, rows]) =>
          !Object.hasOwn(icons, name) || !Array.isArray(rows) || rows.length < 5 || rows.length > 21 || rows.length % 2 !== 1 ||
          typeof rows[0] !== 'string' || rows[0].length < 5 || rows[0].length > 21 || rows[0].length % 2 !== 1 ||
          rows.some(row => typeof row !== 'string' || row.length !== rows[0].length || !/^[.#]+$/.test(row)))) {
          reply(400, { error: '가로·세로는 5~21 사이의 홀수여야 해요.' });
          return;
        }
        if (payload.revision !== revision(text)) {
          reply(409, { error: '다른 곳에서 원본이 바뀌었어요. JSON으로 수정본을 내보낸 뒤 새로고침해 주세요.' });
          return;
        }
        const next = `${JSON.stringify({ ...icons, ...changes }, null, 2)}\n`;
        writeFileSync(`${dataPath}.tmp`, next);
        renameSync(`${dataPath}.tmp`, dataPath);
        reply(200, { revision: revision(next) });
      } else {
        reply(404, { error: '페이지를 찾을 수 없어요.' });
      }
    } catch (error) {
      console.error(error.message);
      if (!res.headersSent) reply(500, { error: '저장하지 못했어요. 터미널을 확인해 주세요.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ICON_EDITOR_PORT || 4178);
  createIconEditor().listen(port, '127.0.0.1', () => console.log(`Icon editor: http://127.0.0.1:${port}`));
}
