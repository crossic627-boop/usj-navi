# USJナビ

11/4・11/5 の USJ で「次にどこへ行くか」を教えてくれるスマホ用Webアプリ。

- `index.html` … アプリ本体（これ1つで動く）
- `waits.json` … 待ち時間（GitHub Actions が日本時間 6:00〜22:59 に5分おきに更新）
- `history/日付.jsonl` … 取得のたびにためている待ち時間の記録
- `stats.json` … 記録の集計（平日／休日 × 30分ごとの待ち時間）。アプリが待ち時間の予測に使う
- `usj-navi.ics` … 時間指定のカレンダー（初期の時刻。アプリのボタンからも作れる）
- `scripts/fetch-waits.mjs` … 待ち時間を取得して `waits.json` に保存し、`history/` に記録を追記
- `scripts/build-stats.mjs` … `history/` を集計して `stats.json` を作る
- `sw.js` … 電波がなくても開けるように、ページとデータをスマホに保存する
- `manifest.json`・`icon-180.png`・`icon-512.png` … ホーム画面に追加したときの名前とアイコン
- `scripts/dev-server.mjs` … PCで試す用（`node scripts/dev-server.mjs` → http://localhost:8000/）
- `.github/workflows/fetch-waits.yml` … 自動取得と GitHub Pages への公開

待ち時間データ: [Powered by Queue-Times.com](https://queue-times.com/)
天気予報: [Open-Meteo](https://open-meteo.com/)

旅行が終わったら、GitHub の Actions → fetch-waits → 「…」→ Disable workflow で自動取得を止める。
