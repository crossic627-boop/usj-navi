// ルートに入っている乗り物（index.html の ITEMS で qt があるもの）が、ちゃんと動いているかを history/ から調べる。
// Queue-Times は休止中の乗り物を「休止」と出さず、待ち時間を更新しなくなるだけなので、更新の途切れで判断する。
//   運休     … その日一度も更新がない（前の日までは動いていた）
//   途中休止 … ほかの乗り物の多くは2回以上更新されたのに、この乗り物だけ60分以上更新がない
//   遅い開始・早い終了 … いつもより60分以上遅く始まった／早く終わった
// 使い方: node scripts/check-rides.mjs [日数=3]   （直近の日数ぶんを表示。問題があれば終了コード 1）
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = path.join(ROOT, 'history');
const GAP = 60; // 分
const SHIFT = 60; // 分
const BASE_DAYS = 7; // いつもの開始・終了をくらべる日数

const jstMin = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// index.html の ITEMS から、見張る乗り物（qt があるもの）と表示名を取り出す
async function planRides() {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const rides = [];
  for (const line of html.split('\n')) {
    const qt = line.match(/\bqt: (\d+)/);
    if (!qt || !/^\s*\{ id: '/.test(line)) continue;
    const name = (line.match(/chip: '([^']+)'/) || line.match(/short: '([^']+)'/) || line.match(/name: '([^']+)'/))[1];
    if (!rides.some((r) => r.qt === +qt[1])) rides.push({ qt: +qt[1], name });
  }
  return rides;
}

// 1日分：乗り物ごとの更新時刻と待ち時間、パーク全体の更新時刻（ルートの乗り物の半分以上が更新された時刻だけ）
async function loadDay(file, ids) {
  const text = await readFile(path.join(HISTORY, file), 'utf8');
  const count = new Map(); const byRide = {};
  for (const line of text.trim().split('\n')) {
    if (!line) continue;
    for (const [id, wait, open, lu] of JSON.parse(line)) {
      if (!open) continue;
      const m = jstMin(lu);
      if (ids.has(id)) count.set(m, (count.get(m) || 0) + 1);
      (byRide[id] ||= new Map()).set(m, wait);
    }
  }
  const ran = [...ids].filter((id) => byRide[id]?.size).length;
  const polls = [...count].filter(([, n]) => n >= ran / 2).map(([m]) => m).sort((a, b) => a - b);
  return { date: file.slice(0, 10), polls, byRide };
}

function analyze(day, qt) {
  const m = day.byRide[qt];
  if (!day.polls.length) return { noData: true };
  if (!m || !m.size) return { ran: false };
  const times = [...m.keys()].sort((a, b) => a - b);
  const waits = times.map((t) => m.get(t));
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const missed = day.polls.filter((p) => p > times[i - 1] && p < times[i]).length;
    if (times[i] - times[i - 1] >= GAP && missed >= 2) gaps.push([times[i - 1], times[i]]);
  }
  return {
    ran: true, first: times[0], last: times.at(-1), gaps,
    startOff: times[0] - day.polls[0], endOff: day.polls.at(-1) - times.at(-1),
    min: Math.min(...waits), max: Math.max(...waits),
  };
}

const days = Math.max(1, Number(process.argv[2]) || 3);
const files = (await readdir(HISTORY)).filter((f) => f.endsWith('.jsonl')).sort();
const rides = await planRides();
const ids = new Set(rides.map((r) => r.qt));
const all = await Promise.all(files.map((f) => loadDay(f, ids)));
let problems = 0;

for (const day of all.slice(-days)) {
  const i = all.indexOf(day);
  const base = all.slice(Math.max(0, i - BASE_DAYS), i);
  const lines = [];
  if (!day.polls.length) { console.log(`■ ${day.date}：まだデータなし（開園前）`); continue; }
  for (const r of rides) {
    const a = analyze(day, r.qt);
    const past = base.map((d) => analyze(d, r.qt)).filter((x) => x.ran);
    const notes = [];
    if (!a.ran && day === all.at(-1) && past.length && day.polls.at(-1) < median(past.map((x) => x.first))) {
      lines.push(`  … ${r.name}：まだ始まる前（いつもは${hm(median(past.map((x) => x.first)))}ごろから）`);
      continue;
    } else if (!a.ran) {
      if (past.length) notes.push(`運休（一度も更新なし。前の${base.length}日のうち${past.length}日は動いていた）`);
      else notes.push('この数日ずっと更新なし');
    } else {
      for (const [s, e] of a.gaps) notes.push(`途中休止 ${hm(s)}〜${hm(e)}`);
      if (past.length >= 3) {
        const s0 = median(past.map((x) => x.startOff)), e0 = median(past.map((x) => x.endOff));
        if (a.startOff - s0 >= SHIFT) notes.push(`開始が遅い（${hm(a.first)}〜）`);
        if (a.endOff - e0 >= SHIFT && day !== all.at(-1)) notes.push(`終了が早い（〜${hm(a.last)}）`);
      }
    }
    if (notes.length) { problems++; lines.push(`  ⚠ ${r.name}：${notes.join('、')}`); }
    else lines.push(`  ✓ ${r.name}：${hm(a.first)}〜${hm(a.last)} 待ち${a.min}〜${a.max}分`);
  }
  console.log(`■ ${day.date}（記録 ${hm(day.polls[0])}〜${hm(day.polls.at(-1))}）`);
  console.log(lines.join('\n'));
}
console.log(problems ? `\n気になる点：${problems}件` : '\n全部ふつうに動いています');
process.exitCode = problems ? 1 : 0;
