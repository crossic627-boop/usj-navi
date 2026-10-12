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
  const stats = { source: 'Powered by Queue-Times.com', slotMinutes: SLOT, days, rides, opening: await buildOpening(files) };
  const text = JSON.stringify(stats) + '\n';
  let old = '';
  try { old = await readFile(OUT, 'utf8'); } catch {}
  if (old !== text) await writeFile(OUT, text);
  return { changed: old !== text, days };
}

// 開園の記録：日ごとに「アトラクションが動き出した時刻」と、開園直後に待ちが伸びる速さ
// （入口ゲートの行列のデータはないので、何分前に並ぶかはアプリ側で公開情報の目安と合わせて出す）
const RUSH = [12070, 12066, 12065, 7092]; // バックドロップ・ミニオン・ハリポタ・フライング
async function buildOpening(files) {
  const out = [];
  for (const f of files) {
    const date = f.replace('.jsonl', '');
    let lastClosed = null, firstOpen = null;
    const rec = {};
    for (const line of (await readFile(path.join(HISTORY, f), 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      const rows = JSON.parse(line);
      const m = Math.max(...rows.map((r) => { const d = jst(r[3]); return d.getUTCHours() * 60 + d.getUTCMinutes(); }));
      if (m < 5 * 60 || m > 14 * 60) continue; // 朝の分だけ見る
      const open = rows.filter((r) => r[2]).length;
      // 開園前の確認（[0,0,0,時刻]）か、ほぼ全部止まっている回 → 「この時刻はまだ開園前」
      if (firstOpen == null && (rows[0][0] === 0 || (open < 3 && rows.length >= 10))) lastClosed = m;
      if (firstOpen == null && open >= 5) firstOpen = m;
      if (firstOpen != null) for (const [id, w, o] of rows) if (o && RUSH.includes(id)) (rec[id] ??= []).push([m, w]);
    }
    if (firstOpen == null) continue;
    const near = (arr, m) => { let b = null; for (const x of arr || []) if (Math.abs(x[0] - m) <= 12 && (!b || Math.abs(x[0] - m) < Math.abs(b[0] - m))) b = x; return b ? b[1] : null; };
    const rush = {};
    for (const id of RUSH) {
      const arr = rec[id];
      if (!arr) continue;
      const cross = arr.find(([m, w]) => w >= 60);
      rush[id] = { w0: near(arr, firstOpen), w20: near(arr, firstOpen + 20), w40: near(arr, firstOpen + 40), w60: near(arr, firstOpen + 60), over60: cross ? cross[0] - firstOpen : null };
    }
    out.push({ date, type: dayType(date), firstOpen, lastClosed, rush });
  }
  return out;
}

const { changed, days } = await buildStats();
console.log(`${changed ? '集計を更新' : '集計に変化なし'}: 平日 ${days.weekday.length}日（${days.weekday.join(', ')}）／休日 ${days.holiday.length}日（${days.holiday.join(', ')}）`);
