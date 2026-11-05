# パーツ同士の約束(CONTRACT)

Next5Mins AI のサイトは、パーツを1つずつ別々に作ります(社長の指示 2026-11-04「サイトのパーツを一つ一つ分けて作ってそれぞれ作り直せるようにして。全部まとめて合わせて作ってはダメ」)。
**どのパーツも、この約束だけを守れば、ほかのパーツを触らずに作り直せます。** 約束を変えるときは、この文書を先に直し、点検に通します。

## 1. パーツの一覧と置き場所

| パーツ | フォルダ | 画面の場所(`index.html` の差し込み口) | もと(比べ表の行) |
|---|---|---|---|
| 0 ページ全体 | `parts/part0-page/` | `<body>` 全体・`.n5-container` | 0-1〜0-6 |
| 1 ヘッダーと状況の入力 | `parts/part1-header-input/` | `<header id="n5-part1">` と `<section id="n5-part1-input">` | 1-1〜1-12 |
| 2 3枚のカード | `parts/part2-cards/` | `<section id="n5-part2">` | 2-1〜2-8 |
| 3 5分タイマーと広告 | `parts/part3-timer-ads/` | `<section id="n5-part3">` | 3-1〜3-4 |
| 4 投げる品物(重ねる) | `parts/part4-item-throw/` | `<div id="n5-part4">`(画面の上に重ねる層) | 4-1〜4-6 |
| 5 共有とフッター | `parts/part5-share-footer/` | `<footer id="n5-part5">` | 5-1〜5-2 |
| X AIの窓口(サーバー) | `server/` と `common/api.js` | 画面にはない | X-1〜X-9 |

比べ表 = `成果物/企画部/2026-11-04_Next5MinsAI_パーツ別_もとと実物の比べ表.md`。設計 = `成果物/企画部/2026-11-04_Next5MinsAI_企画と設計書.md`。

## 2. 各パーツのフォルダに入れるもの(全部そろえる)

| ファイル | 中身 |
|---|---|
| `partN.css` | そのパーツだけの見た目。クラス名は `n5-pN-` で始める(ほかのパーツとぶつからないように) |
| `partN.js` | そのパーツだけの動き。読み込まれたら、自分の差し込み口(`#n5-partN`)の中に画面を作り、掲示板(下の3)を聞く |
| `partN.html` | **そのパーツだけを1つで見る画面**(予行)。`../../parts/part0-page/page.css`・`../../common/config.js`・`../../common/bus.js`・`../../common/samples.js`・`../../common/api.js` と、自分の css/js を読む。ほかのパーツは読まない。ほかのパーツの代わりにボタンを押して出来事を起こす「試しの操作」は `preview.js` に書く |
| `preview.js` | 予行画面の「試しの操作」(例: 「結果が来たことにする」ボタンで `n5:result` を出す)。本番の `index.html` では読まない |
| `README.md` | このパーツが何を出し(emit)・何を聞く(on)か。もとの行の番号。作り直すときの手順(フォルダの中を消して、この約束と比べ表の行を見て、作り直す) |

## 3. 掲示板(出来事のやりとり)

`common/bus.js` が `window.N5` を作ります。パーツは **ほかのパーツの関数や要素を直接さわらず**、出来事だけでやりとりします。

```js
N5.emit('n5:generate', { text, lang });           // 出す
N5.on('n5:result', ({ result }) => { ... });        // 聞く
N5.state.lang;                                      // いまの状態を読む(書かない)
N5.t({ en: 'Log In', ja: 'ログイン' });              // いまの言語の文を返す
```

| 出来事 | 中身(detail) | 出す人 | 聞く人 | 意味 |
|---|---|---|---|---|
| `n5:lang` | `{ lang: 'en' \| 'ja' }` | パーツ1(切り替え)。最初の1回は bus.js | 全部 | 言語が変わった。**全パーツは、この出来事で自分の文字を全部書き直す** |
| `n5:generate` | `{ text, lang }` | パーツ1 | パーツ2 | 決定ボタンが押された(text は 1〜240文字) |
| `n5:generating` | `{}` | パーツ2 | パーツ1・3・4・5 | AIに頼んで待っている |
| `n5:result` | `{ result }`(下の4の形) | パーツ2 | パーツ4・5 | AIの答えが来た |
| `n5:error` | `{ message }` | パーツ2 | パーツ1 | AIの答えが来なかった |
| `n5:select` | `{ model: 'idiot' \| 'average' \| 'god', action }` | パーツ2 | パーツ3・4 | カードが1枚選ばれた(action = そのカードの `{title, instruction, why_it_works}`) |
| `n5:timer` | `{ status: 'start' \| 'tick' \| 'done', remaining }`(秒) | パーツ3 | パーツ4・5 | タイマーの始まり・毎秒・終わり |
| `n5:item-thrown` | `{ item }` | パーツ4 | (記録用) | 品物を投げた |
| `n5:item-caught` | `{ item, url }` | パーツ4 | パーツ3(`is_item_caught`) | 品物をキャッチした |
| `n5:reset` | `{}` | パーツ3(終わったとき)・パーツ1(✕ Clear) | 全部 | 入力待ちに戻る。パーツ2〜4は自分を消す |
| `n5:auth` | `{ user: { name } \| null }` | (まだ誰も。ログインの仕組みをつなぐ人) | パーツ1 | ログインの状態が変わった(いまは見た目だけ。本物のログインは未接続) |

補足(2026-11-04 に作って分かったこと):
- `n5:lang` で書き直すのは、パーツが自分で持つ文(見出し・ボタン・ラベル)だけ。**AIの答えの文**(title・instruction・why_it_works・品物の文)は、来たときの言語のまま(作り直さない)。
- `n5:generating` を受けたら、パーツ3・4・5 は前の結果の表示を消す(「もう一度」の間に、古いタイマーや品物が残らないように)。
- `n5:error` の文を画面に出すのはパーツ1だけ。パーツ1がない予行では `preview.js` が代わりに出す。

`N5.state` = `{ lang, text, result, selected, timer }`。bus.js が出来事を見て更新する。**パーツは state を読むだけ(書かない)。**

`N5.config`(`common/config.js`。社長が直す所):

| 名前 | 意味 | 最初の値 |
|---|---|---|
| `amazonTag.en` / `amazonTag.ja` | Amazon アソシエイトの印(空なら印なしのURL) | `''` |
| `throwTiming` | 品物を投げる時。`'timer'`=タイマーが始まったとき(7-2)/`'cards'`=カードが出たとき(7-3)。設計書の M-2。社長が決めるまで `'timer'` | `'timer'` |
| `allowFake` | サーバーがないとき、にせの答え(`common/samples.js`)で動かす(予行用) | `true` |
| `adSlotHtml` | 広告の枠に入れる中身(空なら「広告の枠」のしるしだけ)。`<script>` は動かない(守りの CSP)。本物の広告のタグを入れる段で、CSP を変える前に点検に通す | `''` |

## 4. AIの答えの形(設計書 4章)

```json
{
  "language": "en",
  "situation_summary": "...",
  "actions": {
    "idiot":   { "title": "...", "instruction": "...", "why_it_works": "..." },
    "average": { "title": "...", "instruction": "...", "why_it_works": "..." },
    "god":     { "title": "...", "instruction": "...", "why_it_works": "..." }
  },
  "idiot_item_throw": {
    "shout_line": "...", "item_name": "...", "item_emoji": "🦖",
    "funny_reason": "...", "amazon_search_keyword": "..."
  }
}
```

つらい入力(設計書 M-9)のときは、サーバーが AI に送る前に言葉で絞り込み(`server/crisis.mjs`)、AI にも同じ決まりを指示して、代わりに `{ "language": "en", "safety": true, "message": "..." }` が返る。パーツ2はカードを出さず、`message` を静かに出す(ジョークなし)。パーツ4は投げない。

`N5.api.generate(text, lang)` → 上の形の Promise(`common/api.js`)。サーバー(`POST /api/next5`)がなければ、`config.allowFake` のときだけ、`common/samples.js` の答えを返す。

## 5. 全パーツで守ること

- **自分のフォルダの外に書かない。** 共通(`common/`・`parts/part0-page/`・`index.html`)を直したいときは、秘書室長に言う(約束の変更になる)。
- **HTML の中に `<script>`・`<style>`・`style="..."` を書かない。** サーバーの守り(CSP)で止まる。見た目は css のクラス、動きは js のファイル。動かす見た目(飛ぶ品物など)は、js から `el.style.transform = ...` のように付ける(これは通る)。`innerHTML` に利用者やAIの文字を入れない(`textContent` を使う。どうしても要るときは `N5.esc()` で文字にしてから)。
- **外のサイトから何も読まない**(フォント・画像・JSのCDN)。文字は絵文字と、端末の字体。
- **両方の言語の文は、そのパーツの js の中に持つ**(`{ en: '...', ja: '...' }`)。`n5:lang` で全部書き直す。
- 色・幅は `parts/part0-page/page.css` の変数(`var(--n5-idiot)` など)を使う。数字を直書きしない。
- 鍵(APIキー)・Amazonの印・個人の情報を、ファイルに書かない。
- スマホ(幅 375px)でも、横にはみ出さない。
