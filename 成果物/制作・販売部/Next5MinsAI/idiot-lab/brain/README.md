# brain(頭)

バカの仕組みの部分です。約束は `../CONTRACT.md` の1〜3章。外の部品は使わず、Node.js 22 の標準機能と `../lab/mamori.mjs`(safeFetch・redact)だけを使います。

| ファイル | 役目 |
|---|---|
| `blueprint.mjs` | 設計図の読み込み・確かめ(`checkBlueprint`)・公式の一覧(`listOfficial`)・参照の確かめ(`refOk`) |
| `prompt.mjs` | 設計図から、AIへの指示文を組み立てる(`buildSystem`)。安全の決まりは固定 |
| `schema.mjs` | 答えの形(`REPLY_SCHEMA`)と、形の確かめ(`checkReply`) |
| `call.mjs` | AIの呼び出し(`askIdiot`)・考える量の表・費用の目安(`costUsd`) |
| `fake.mjs` | にせのバカ(`fakeIdiot`)。予行用。外へつながらない |
| `blueprints/` | 公式の設計図(`v001.json` …)。ここは約束で別に管理 |

自動テスト: `node --test tests/brain.test.mjs`(にせの fetch を使い、外へはつながりません)。
