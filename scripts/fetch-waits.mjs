// Queue-Times.com から USJ の待ち時間を取り、waits.json に保存する。
// 中身が変わったときだけファイルを書き換える（GitHub Actions のコミットを減らすため）。
// 使い方: node scripts/fetch-waits.mjs
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SOURCE = 'https://queue-times.com/parks/284/queue_times.json';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'waits.json');
const HISTORY = path.join(ROOT, 'history');

// 日本時間の日付（YYYY-MM-DD）
const jstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

// history: true のときは、新しくなったアトラクションの待ち時間を history/日付.jsonl に1行追記する（集計用）
export async function fetchWaits({ history = false } = {}) {
  const res = await fetch(SOURCE, {
    headers: { 'User-Agent': 'usj-navi (personal trip helper)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Queue-Times HTTP ${res.status}`);
  const json = await res.json();

  // rides[] と lands[].rides[] の両方を見る（同じIDは1つにまとめる）
  const all = [...(json.rides ?? []), ...(json.lands ?? []).flatMap((l) => l.rides ?? [])];
  const byId = new Map();
  for (const r of all) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      is_open: r.is_open,
      wait_time: r.wait_time,
      last_updated: r.last_updated,
    });
  }
  const rides = [...byId.values()].sort((a, b) => a.id - b.id);
  if (rides.length === 0) throw new Error('rides が空でした');

  const data = {
    source: 'Powered by Queue-Times.com',
    source_url: 'https://queue-times.com/',
    updated_at: rides.map((r) => r.last_updated).sort().at(-1),
    rides,
  };
  const text = JSON.stringify(data, null, 1) + '\n';

  let old = '';
  try { old = await readFile(OUT, 'utf8'); } catch {}
  if (old === text) {
    // 朝（5〜11時）にまだ全部止まっていたら「確認したけどまだ開園前」と記録する（開園時刻を絞り込むため）：[0, 0, 0, 確認した時刻]
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    if (history && h >= 5 && h < 11 && !rides.some((r) => r.is_open)) {
      await mkdir(HISTORY, { recursive: true });
      await appendFile(path.join(HISTORY, jstDate(new Date().toISOString()) + '.jsonl'), JSON.stringify([[0, 0, 0, new Date().toISOString()]]) + '\n');
      return { changed: true, data };
    }
    return { changed: false, data };
  }
  await writeFile(OUT, text);
  if (history) {
    // 前回から last_updated が変わったものだけ記録する：[id, 待ち分, 運営中なら1, last_updated]
    let prev = {};
    try { for (const r of JSON.parse(old).rides) prev[r.id] = r.last_updated; } catch {}
    const rows = rides.filter((r) => prev[r.id] !== r.last_updated).map((r) => [r.id, r.wait_time, r.is_open ? 1 : 0, r.last_updated]);
    if (rows.length) {
      await mkdir(HISTORY, { recursive: true });
      await appendFile(path.join(HISTORY, jstDate(data.updated_at) + '.jsonl'), JSON.stringify(rows) + '\n');
    }
  }
  return { changed: true, data };
}

// 直接実行されたときだけ動く（dev-server.mjs から import されたときは動かない）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { changed, data } = await fetchWaits({ history: true });
    const open = data.rides.filter((r) => r.is_open).length;
    console.log(`${changed ? '更新しました' : '変化なし'}: ${data.rides.length}件（運営中 ${open}件）データ時刻 ${data.updated_at}`);
  } catch (e) {
    // 取得に失敗しても前の waits.json はそのまま残す
    console.log(`::warning::待ち時間の取得に失敗しました: ${e.message}`);
  }
}
