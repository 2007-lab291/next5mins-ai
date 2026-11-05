# パーツ4 投げる品物(`parts/part4-item-throw/`)

バカが「これが必要だ!」と叫んで品物を投げ、押す(キャッチ)と小窓と Amazon のリンクが出る。差し込み口は `<div id="n5-part4">`(画面の上に重ねる層。`position:fixed`・`pointer-events:none`。品物と小窓だけ押せる)。約束は `../CONTRACT.md`。

## 出す(emit)
| 出来事 | 中身 | いつ |
|---|---|---|
| `n5:item-thrown` | `{ item }`(`idiot_item_throw`) | 品物を投げるたび(最大3回) |
| `n5:item-caught` | `{ item, url }` | 飛んでいる品物を押したとき。url は `N5.amazonUrl(amazon_search_keyword)` |

## 聞く(on)
| 出来事 | することは |
|---|---|
| `n5:result` | `idiot_item_throw` を覚える(`safety:true` なら覚えない)。`throwTiming` が `'cards'` ならここで投げる |
| `n5:timer` | `status:'start'` で、`throwTiming` が `'timer'` なら投げる |
| `n5:generating` | 飛行中・小窓を消す(新しい依頼) |
| `n5:reset` | 全部消して、回数を戻す |
| `n5:lang` | 小窓の文を書き直す(リンクの行き先も言語に合わせる) |

## もとの行
- 4-1 投げる時: `N5.config.throwTiming`(設計書 M-2。社長が決めるまで `'timer'`)
- 4-2 バカの叫び: 左下か右下にふきだし(🤪 + `shout_line`)。2.5秒。ふきだしの1秒後に投げる
- 4-3 飛んでくる品物: `<button>` に大きな絵文字。端から反対側へ、放物線で3秒。回りながら飛ぶ。64px 四方
- 4-4 キャッチ: 押すと止まって小窓。取りそこねたら消えて、8秒後にもう一度。合わせて3回まで
- 4-5 小窓: 絵文字・品名・おかしな理由・「Idiot says / バカいわく:」。右上に必ず「Ad・PR / 広告・PR」
- 4-6 リンク: `target=_blank rel="sponsored noopener noreferrer"`。閉じるボタン・Esc・外側で閉じる
- 回数・秒数は `part4.js` の先頭の定数(`FLY_MS` `RETRY_MS` `MAX_THROWS` など)で変える

## 予行
`part4.html` をブラウザで開く(`file://` でよい)。ボタンで result・timer start・reset・言語・throwTiming を起こせる。出来事は画面の下の log に出る。

## 作り直す手順
1. このフォルダの中のファイルを消す(ほかのパーツ・`common/`・`index.html` は触らない)。
2. `../CONTRACT.md` の 3(掲示板)・4(答えの形)・5(守ること)と、比べ表の「パーツ4」の行 4-1〜4-6 を読む。
3. `part4.css`・`part4.js`・`part4.html`・`preview.js`・この README を作り直す。
4. `part4.html` を開いて確かめる(コンソールにエラーなし・幅1024と375で横にはみ出さない)。

## 約束にまだない点
- Amazon アソシエイトの決まった一文(設計書 M-5)の置き場所と文は未定。いまは「Ad・PR」の札だけ。
- 危ないもの・大人向けの品物の絞り込み(M-9)は、サーバーの指示文側の仕事。このパーツは出さないだけの作りはしていない。
