# 守りの部品(社長専用のセキュリティ)

これから作るアプリ・道具に入れる「守り」を、部品にまとめたものです(2026-10-30 作成)。
JavaScript / TypeScript 用と Python 用があります。どちらも、外から何も入れずに動きます(ファイル1つ)。

| 場所 | 中身 |
|---|---|
| `js/mamori.mjs` | JavaScript 用の部品(TypeScript からは `js/mamori.d.mts` の型で使える) |
| `py/mamori.py` | Python 用の部品(名前は `check_request` のように小文字とアンダーバー) |
| `js/mamori.test.mjs`・`py/test_mamori.py` | 自動テスト |

## 入っている守り(たとえつき)

| 番号 | 部品(JS / Python) | 何を守るか |
|---|---|---|
| 1 | `listenLocal` / `serve_local` | 自分のPCの中だけで待ち受ける。家の中のほかの機械からも入れない「鍵のかかった部屋」 |
| 2 | `checkRequest` / `check_request` | 届いた頼みの「宛名」と「差出人」を見て、なりすましや、よそのサイトからの勝手な操作を断る |
| 3 | `securityHeaders` / `security_headers` | 画面に「よその物を動かさない・ほかのサイトに埋め込ませない」と札を貼る |
| 4 | `createLocalServer` / `SafeHandler` | 1〜3 を全部つけたサーバー。エラーの中身は相手に見せない。**ふだんはこれを使う** |
| 5 | `readBody`・`readJson` / `read_body`・`read_json` | 送られてくる中身に大きさの上限をつける(大きすぎる荷物は受け取らない) |
| 6 | `safeJoin`・`urlToFile` / `safe_join`・`url_to_file` | 「../../」で、決めたフォルダの外のファイルを読ませない |
| 7 | `redact` / `redact` | 記録・エラーの文に、APIの鍵・パスワードが出たら `[伏せた]` にする |
| 8 | `escapeHtml` / `escape_html` | 画面に出す文字に混ざったプログラムを、ただの文字にする |
| 9 | `csvCell` / `csv_cell` | Excel で開く表(CSV)で、「=」で始まる文字を式として動かさない |
| 10 | `newToken`・`sameToken` / `new_token`・`same_token` | 合言葉を作る・くらべる(くらべる時間から当てられない) |
| 11 | `writeFileAtomic` / `write_file_atomic` | 保存の途中で止まっても、こわれたファイルを残さない |
| 12 | `rateLimiter` / `RateLimiter` | 短い時間に何度も来る頼みを断る(回数の上限) |
| 13 | `checkUrl`・`safeFetch` / `check_url`・`safe_fetch` | 外へつなぐのは、決めた行き先だけ(https だけ・転送について行かない・時間と大きさの上限) |

## 作るときの3つの約束(部品だけでは守れない所)

1. **GET(ページや中身を読む頼み)では、何も書きかえない・消さない。** 書きかえは POST などだけにする(同じPCのほかの画面からのリンクでも、勝手に書きかわらないように)。
2. **ファイルを出すのは、公開用の専用フォルダだけ。** `safeJoin` の「元のフォルダ」に、プロジェクト全体や鍵の入ったフォルダを渡さない(`.env`・`.git` などの点で始まる名前は、部品が断る)。
3. **鍵は、部品の `secrets` に渡す。** 決まった形にない鍵(自前の合言葉など)も、エラーの記録で伏せられる。Python は、つなぎっぱなし(`protocol_version = 'HTTP/1.1'`)にしない。

## 入れ方

部品のファイルを、作るアプリのフォルダにコピーして使います(アプリを別の場所に移しても動くように)。
会社のフォルダの中なら、コピーせずに道でつないでもかまいません。

### JavaScript(いちばん小さい形)

```js
import { createLocalServer, sendText, readJson } from './mamori.mjs';

await createLocalServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    const data = await readJson(req);   // 大きさの上限・壊れたJSONは自動で断る
    return sendText(res, 200, 'saved');
  }
  sendText(res, 200, 'hello');
}, { port: 8800 });
```

- 画面のページで `<script>` を直接書く(インライン)と、既定の守りの札で止まります。JS は別ファイルにします。どうしても要るときは `csp` を渡して変えます(変えたら点検に通す)。
- 画面から POST するときは、同じアプリのページから `fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })` で送ります(ブラウザが出どころを自動でつけます)。

### Python(いちばん小さい形)

```python
from mamori import SafeHandler, serve_local

class Handler(SafeHandler):
    def do_GET(self):
        self.send_text(200, 'hello')
    def do_POST(self):
        data = self.read_json()      # 大きさの上限・壊れたJSONは自動で断る
        self.send_text(200, 'saved')

serve_local(Handler, 8800).serve_forever()
```

### 外へつなぐ道具

```python
from mamori import safe_fetch, redact
r = safe_fetch('https://api.example.com/v1/prices', hosts=['api.example.com'], headers={'Authorization': ...})
print(redact(r['text']))   # 記録に出す前に、鍵を伏せる
```

## 守れないこと(この部品だけでは足りない所)

- **インターネットに公開するサイト**には、この部品だけでは足りません(ログイン・パスワードの保存・https の証明書・多くの人からの攻撃)。公開するものは、作る前に社長が決めて、点検室と、必要なら専門家に見てもらいます。
- LAN(家の Wi-Fi)で使う形(`allowRemote` / `allow_remote`)は、社長の許可を取ってからにします。
- 鍵そのものの置き場所は、この部品では決めません。鍵はプログラムに書かず、git に入れません。

## テストの動かし方

```bash
node --test 守りの部品/js/mamori.test.mjs
```

```bash
py -I 守りの部品/py/test_mamori.py
```

部品を直したら、両方の言葉で同じ動きになるように、両方を直して、両方のテストを動かします。
