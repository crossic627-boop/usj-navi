// history/*.jsonl にためた待ち時間を集計して stats.json を作る。
// アトラクションごとに「平日／休日 × 30分ごと」の待ち時間（日ごとの平均の中央値）と、何日分かを出す。
// 使い方: node scripts/build-stats.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = path.join(ROOT, 'history');
const OUT = path.join(ROOT, 'stats.json');
const SLOT = 30;
// 土日以外の休日（祝日）
const HOLIDAYS = new Set(['2026-10-12', '2026-11-03', '2026-11-23']);

const jst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3);
const dayType = (date) => {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6 || HOLIDAYS.has(date) ? 'holiday' : 'weekday';
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function buildStats() {
  let files = [];
  try { files = (await readdir(HISTORY)).filter((f) => f.endsWith('.jsonl')).sort(); } catch {}
  // perDay[date][id][slot] = [待ち…]
  const perDay = {};
  for (const f of files) {
    const last = {}; // アトラクションごとの直前の待ち（急に10分以下になったら「止まった」とみなすため）
    const stopped = {};
    for (const line of (await readFile(path.join(HISTORY, f), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const rows = JSON.parse(line);
      // 閉園後は全体の待ちが10分以下の仮の数字になるので、その回はまるごと使わない
      const open = rows.filter((r) => r[2]).map((r) => r[1]).sort((a, b) => a - b);
      if (rows.length >= 10 && jst(rows[0][3]).getUTCHours() >= 19 && (open.length === 0 || open[open.length >> 1] <= 10)) continue;
      for (const [id, wait, isOpen, lu] of rows) {
        if (!isOpen) { stopped[id] = false; continue; }
        // 60分以上から急に10分以下 → 受付終了・停止の可能性が高いので、待ちが戻るまで使わない
        if (wait <= 10 && (stopped[id] || (last[id] ?? 0) >= 60)) { stopped[id] = true; continue; }
        stopped[id] = false; last[id] = wait;
        const d = jst(lu);
        const date = d.toISOString().slice(0, 10);
        const m = d.getUTCHours() * 60 + d.getUTCMinutes();
        const slot = Math.floor(m / SLOT) * SLOT;
        ((((perDay[date] ??= {})[id] ??= {})[slot] ??= [])).push(wait);
      }
    }
  }
  const days = { weekday: [], holiday: [] };
  const acc = {}; // acc[id][type][slot] = [日ごとの平均…]
  for (const date of Object.keys(perDay).sort()) {
    const type = dayType(date);
    days[type].push(date);
    for (const [id, slots] of Object.entries(perDay[date])) {
      for (const [slot, ws] of Object.entries(slots)) {
        (((acc[id] ??= {})[type] ??= {})[slot] ??= []).push(ws.reduce((a, b) => a + b, 0) / ws.length);
      }
    }
  }
  const rides = {};
  for (const [id, types] of Object.entries(acc)) {
    for (const [type, slots] of Object.entries(types)) {
      for (const [slot, means] of Object.entries(slots)) ((rides[id] ??= {})[type] ??= {})[slot] = [Math.round(median(means)), means.length];
    }
  }
  const stats = { source: 'Powered by Queue-Times.com', slotMinutes: SLOT, days, rides };
  const text = JSON.stringify(stats) + '\n';
  let old = '';
  try { old = await readFile(OUT, 'utf8'); } catch {}
  if (old !== text) await writeFile(OUT, text);
  return { changed: old !== text, days };
}

const { changed, days } = await buildStats();
console.log(`${changed ? '集計を更新' : '集計に変化なし'}: 平日 ${days.weekday.length}日（${days.weekday.join(', ')}）／休日 ${days.holiday.length}日（${days.holiday.join(', ')}）`);
