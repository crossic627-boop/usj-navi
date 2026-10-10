// Queue-Times.com から USJ の待ち時間を取り、waits.json に保存する。
// 中身が変わったときだけファイルを書き換える（GitHub Actions のコミットを減らすため）。
// 使い方: node scripts/fetch-waits.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SOURCE = 'https://queue-times.com/parks/284/queue_times.json';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'waits.json');

export async function fetchWaits() {
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
  if (old === text) return { changed: false, data };
  await writeFile(OUT, text);
  return { changed: true, data };
}

// 直接実行されたときだけ動く（dev-server.mjs から import されたときは動かない）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { changed, data } = await fetchWaits();
    const open = data.rides.filter((r) => r.is_open).length;
    console.log(`${changed ? '更新しました' : '変化なし'}: ${data.rides.length}件（運営中 ${open}件）データ時刻 ${data.updated_at}`);
  } catch (e) {
    // 取得に失敗しても前の waits.json はそのまま残す
    console.log(`::warning::待ち時間の取得に失敗しました: ${e.message}`);
  }
}
