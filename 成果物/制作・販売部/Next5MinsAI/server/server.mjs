// Next5Mins AI の窓口(サーバー)。パーツX(比べ表 X-1〜X-9)。
//   予行:   node server/server.mjs --dry            (にせの答え。外へつながない)
//   本物:   node server/server.mjs                  (起動時に鍵を貼る。保存しない。社長だけが動かす)
//   番号:   --port N(既定 4900。0 なら空いている番号)
// 守りは mamori.mjs(守りの部品の写し。変えない)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalServer, readJson, sendText, urlToFile, safeFetch, rateLimiter, redact, httpError } from './mamori.mjs';
import { buildSystem, loadSamples, sampleFor } from './prompt.mjs';
import { validateResult } from './validate.mjs';
import { isCrisis, crisisAnswer } from './crisis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------------------------------------------------------------- 後から変える値(どれも仮置き。社長が決める)
// model(X-1): 【未確認】'claude-haiku-5-5' は仮置き。本物を動かす前に、Anthropic のモデル一覧と料金のページで
//   社長が正しい名前と料金を確かめる。名前が違うと API が 4xx を返し、全部 502 になる。起動のとき --model で替えられる。
// perClient / overall(X-4): 【仮置き】1分あたりの回数の上限。もと(比べ表・設計書)には数字がない。
//   相手は「つないできた機械の番号(remoteAddress)」で見分ける。いまはこのPCの中だけで開くので、
//   相手はほぼ1つ(=実際の上限は perClient の 10回)。公開する・中継(プロキシ)を通すときは、見分け方を作り直す。
export const DEFAULTS = { model: 'claude-haiku-5-5', perClient: 10, overall: 60, perMs: 60_000 };

// ---------------------------------------------------------------- 引数
function parseArgs(argv) {
  const o = { dry: false, port: 4900, model: DEFAULTS.model, perClient: DEFAULTS.perClient, overall: DEFAULTS.overall };
  const count = (name, v, min, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} は ${min}〜${max} の数`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') o.dry = true;
    else if (argv[i] === '--port') o.port = count('--port', argv[++i], 0, 65535);
    else if (argv[i] === '--model') {
      const m = String(argv[++i] || '');
      if (!/^[a-z0-9][a-z0-9.\-]{0,63}$/.test(m)) throw new Error('--model は英小文字・数字・「.」「-」だけ');
      o.model = m;
    }
    else if (argv[i] === '--per-client') o.perClient = count('--per-client', argv[++i], 1, 1000);
    else if (argv[i] === '--overall') o.overall = count('--overall', argv[++i], 1, 10000);
  }
  return o;
}

// ---------------------------------------------------------------- 鍵を聞く(本物のモードだけ)
// 画面に出さずに1行読む(端末のときは打った文字を出さない)。メモリにだけ持つ。
function askKey(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let buf = '';
    const finish = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(buf.trim());
    };
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.on('end', finish);
    stdin.resume();
  });
}

// ---------------------------------------------------------------- 静的ファイル
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};
const OPEN_DIRS = ['common', 'parts']; // 外から読めるフォルダ(server/・tests/ は読ませない)
// 「..」「.」の段(%2e も)・「\」は、そもそも受けつけない
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)|\\|%5c/i;

function staticFile(rawUrl) {
  const raw = String(rawUrl).split('?')[0].split('#')[0];
  if (DOT_SEGMENT.test(raw)) return null;
  if (raw === '/' || raw === '/index.html') return path.join(ROOT, 'index.html');
  const full = urlToFile(ROOT, raw);
  if (!full) return null;
  const rel = path.relative(ROOT, full).split(path.sep);
  if (rel.length < 2 || !OPEN_DIRS.includes(rel[0])) return null;
  const ext = path.extname(full).toLowerCase();
  if (ext === '.bat' || !TYPES[ext]) return null;
  return full;
}

function serveStatic(req, res) {
  const file = staticFile(req.url);
  let data = null;
  if (file) {
    try { if (fs.statSync(file).isFile()) data = fs.readFileSync(file); } catch { /* 無い */ }
  }
  if (!data) return sendText(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] });
  res.end(data);
}

// ---------------------------------------------------------------- 送られてきた中身を確かめる
function checkInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'bad request');
  if (typeof body.text !== 'string') throw httpError(400, 'bad text');
  const text = body.text.trim();
  const n = Array.from(text).length;
  if (n < 1 || n > 240) throw httpError(400, 'bad text');
  if (body.lang !== 'en' && body.lang !== 'ja') throw httpError(400, 'bad lang');
  return { text, lang: body.lang };
}

// ---------------------------------------------------------------- AIの答え
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// 予行: samples.js の答えを、入力に合わせて少し変えて返す
async function fakeAnswer(text, lang) {
  const r = JSON.parse(JSON.stringify(sampleFor(lang, loadSamples())));
  r.language = lang;
  r.situation_summary = Array.from(text).slice(0, 120).join('');
  await sleep(400);
  return validateResult(r, lang);
}

// AIの返事の文から JSON を取り出す(前後の ``` を除く・最初の { から最後の } まで)
export function extractJson(s) {
  let t = String(s || '').trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

class AiError extends Error {}

// 本物: Anthropic の API を1回呼ぶ。Dify に替えるときは、この関数だけ替える。
async function callAnthropic(key, model, text, lang) {
  let r;
  try {
    r = await safeFetch('https://api.anthropic.com/v1/messages', {
      hosts: ['api.anthropic.com'],
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: buildSystem(lang),
        messages: [{ role: 'user', content: text }]
      })
    });
  } catch (e) {
    console.error('[AI] つながらない: ' + redact(String(e?.message || e), { secrets: [key] }));
    throw new AiError('unreachable');
  }
  if (!r.ok) {
    // 返事の中身は記録に出さない(利用者の文が混じることがあるため。X-8)。状態の番号だけ。
    console.error(`[AI] API が ${r.status} を返した` + (r.status === 404 || r.status === 400 ? '(モデル名がちがう かもしれない。--model を確かめる)' : ''));
    throw new AiError('api ' + r.status);
  }
  let body;
  try { body = JSON.parse(r.text); } catch { return null; }
  const first = Array.isArray(body?.content) ? body.content.find((c) => c && c.type === 'text') : null;
  return first ? extractJson(first.text) : null;
}

async function realAnswer(key, model, text, lang) {
  for (let i = 0; i < 2; i++) { // 形がだめなら1回だけやり直す
    const ok = validateResult(await callAnthropic(key, model, text, lang), lang);
    if (ok) return ok;
  }
  return null;
}

// ---------------------------------------------------------------- 起動
async function main() {
  const opt = parseArgs(process.argv.slice(2));
  let key = '';
  if (!opt.dry) {
    key = await askKey('ANTHROPIC_API_KEY を貼って Enter: ');
    if (!key) { console.error('鍵がないので終わります。'); process.exit(1); }
  }

  const perClient = rateLimiter({ max: opt.perClient, perMs: DEFAULTS.perMs });
  const overall = rateLimiter({ max: opt.overall, perMs: DEFAULTS.perMs });

  async function handleApi(req, res) {
    const t0 = Date.now();
    res.on('finish', () => console.log(`POST /api/next5 ${res.statusCode} ${Date.now() - t0}ms`));
    const who = String(req.socket.remoteAddress || '?');
    if (!perClient(who) || !overall('all')) throw httpError(429, 'too many requests');
    const { text, lang } = checkInput(await readJson(req, { limit: 10_000 }));
    let result;
    // つらい入力は、AI に送らずに、ここで静かな文を返す(X-9。予行でも同じ)
    if (isCrisis(text)) result = crisisAnswer(lang);
    else if (opt.dry) result = await fakeAnswer(text, lang);
    else {
      try { result = await realAnswer(key, opt.model, text, lang); }
      catch (e) { if (e instanceof AiError) return sendText(res, 502, 'ai error'); throw e; }
    }
    if (!result) return sendText(res, 502, 'bad ai response');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  }

  const server = await createLocalServer(async (req, res) => {
    const p = String(req.url).split('?')[0];
    if (p === '/api/next5') {
      if (req.method !== 'POST') throw httpError(405, 'method not allowed');
      return handleApi(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'method not allowed');
    return serveStatic(req, res);
  }, { port: opt.port, secrets: key ? [key] : [] });

  console.log(`http://127.0.0.1:${server.address().port}/`);
  console.error(opt.dry ? '(予行: にせの答え。外へはつながりません)' : `(本物のAI: モデル名 ${opt.model}【未確認の仮置き。違うと全部 502】。止めるときは Ctrl+C)`);
  console.error(`(回数の上限: ひとつの相手 1分 ${opt.perClient}回・全体 1分 ${opt.overall}回【仮置き】)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('起動できなかった: ' + redact(String(e?.message || e))); process.exit(1); });
}
