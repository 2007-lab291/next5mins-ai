# 安全点検: Next5Mins AI サーバーと共通の部分

- 点検した日: 2026-11-04
- 点検した人: 安全点検員(security-inspector)。作った人(開発担当・秘書室長)とは別。保存は秘書室長。
- 対象: `成果物/制作・販売部/Next5MinsAI/` の `server/server.mjs`・`prompt.mjs`・`validate.mjs`・`README.md`、`common/api.js`・`bus.js`・`config.js`、`index.html`、各パーツの js の innerHTML・外部URL・eval・localStorage の使い方。
- 結論: **高・中の指摘なし(合格)。** 低い指摘が4つ → 1〜2 は直した、3〜4 は残す(下の表)。

| 番号 | 重さ | 所 | 指摘 | 直し |
|---|---|---|---|---|
| 1 | 低 | validate.mjs | AIの答えの `language` を 1〜16文字なら何でも通していた | 直した: 頼んだ言語(en/ja)と合わないと null(1回やり直し、だめなら 502)。サーバーの直しのパッチで反映 |
| 2 | 低 | server.mjs | API がエラーを返したとき、返事の本文を500文字まで記録に出していた | 直した: 状態の番号だけ出す(本文は出さない) |
| 3 | 低 | part3.js | 広告の枠に `config.adSlotHtml` を innerHTML で入れている(いまは社長の設定だけなので問題なし) | 残す。本物の広告のタグを入れる段で、CSP を変える前に点検に通す、と CONTRACT と README に書いた |
| 4 | 低 | server.mjs | 答えの形がだめなとき、もう1回 API を呼ぶ(1回の頼みで最大2回のお金) | 残す。費用の見積もりに「最大2回」を入れる(設計書 M-3 の 0.06〜0.10円は1回分) |

## 確かめたこと(合格の根拠。安全点検員の報告から)
- 鍵は起動のときの標準入力だけ。環境変数・ファイルから読まない。記録に出ない(`secrets` に渡して伏せる)。
- 利用者の文は記録に出ない(状態の番号とかかった時間だけ)。
- 静的ファイルは `/`・`/common/`・`/parts/` だけ。`/server/`・`/tests/`・`..` は 404。
- 入力の検査(長さ 1〜240・言語 en/ja・中身 10KB まで)、連打の制限(IP ごと・全体)、外へつなぐ先は api.anthropic.com だけ(`safeFetch`)、AIの返事は `validate` を通す、CSP は守りの部品の既定のまま。
- 画面は利用者・AIの文字を textContent で出す。Amazon のリンクは `rel="sponsored noopener noreferrer"`。利用者の文は system に混ぜない(user の文として送る)。
