// PCで試す用のサーバー。index.html などを配信し、5分おきに waits.json を更新する。
// 使い方: node scripts/dev-server.mjs  → ブラウザで http://localhost:8000/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchWaits } from './fetch-waits.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function update() {
  try {
    const { changed, data } = await fetchWaits();
    console.log(`[${new Date().toLocaleTimeString('ja-JP')}] waits.json ${changed ? '更新' : '変化なし'}（データ時刻 ${data.updated_at}）`);
  } catch (e) {
    console.log(`[${new Date().toLocaleTimeString('ja-JP')}] 取得失敗: ${e.message}`);
  }
}

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || p.includes('/.')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('見つかりません');
  }
}).listen(PORT, () => {
  console.log(`USJナビ 試験サーバー: http://localhost:${PORT}/  （止めるときは Ctrl + C）`);
});

await update();
setInterval(update, 5 * 60 * 1000);
