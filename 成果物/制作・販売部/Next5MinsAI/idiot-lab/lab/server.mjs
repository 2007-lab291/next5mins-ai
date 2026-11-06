// バカ工房の窓口(サーバー。②)。約束は ../CONTRACT.md の4〜6章。
//   予行:  node lab/server.mjs --dry            (にせのバカ。外へつながらない)
//   本物:  node lab/server.mjs                  (社長だけが動かす。保存した鍵があれば使う。無ければ貼って、暗号化して保存する)
//          --new-key 鍵を貼り直して保存し直す / --delete-key 保存した鍵を消して終わる(決定事項 N5 2026-11-06 / 2)
//   ほか:  --port 4910  --data <フォルダ>  --model claude-haiku-5-5  --per-client 20  --overall 60
// 守りは mamori.mjs(守りの部品の写し。変えない)。外の部品は使わない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createLocalServer, readJson, sendText, urlToFile, rateLimiter, redact, newToken } from './mamori.mjs';
import { isCrisis, crisisAnswer } from '../../server/crisis.mjs';
import { refOk, loadOfficial, listOfficial } from '../brain/blueprint.mjs';
import { buildSystem, buildVariation, AFTER_SAFETY_NOTE } from '../brain/prompt.mjs';
import { randomInt } from 'node:crypto';
import { askIdiot, THINK_LEVELS, PRICES, costUsd } from '../brain/call.mjs';
import { fakeIdiot } from '../brain/fake.mjs';
import { createStore, defaultDataDir, redactDeep, buildSummary } from './store.mjs';
import { loadKey, saveKey, deleteKey, keyShapeOk, formatSavedAt } from './key-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..'); // idiot-lab/

// 後から変える値(どれも仮置き。社長が決める)
export const DEFAULTS = { model: 'claude-haiku-5-5', perClient: 20, overall: 60, perMs: 60_000, port: 4910 };
const MAX_CONVS = 50;      // 覚えておく会話の数
const MAX_TURNS = 30;      // 1つの会話の回数
const BODY_LIMIT = 20_000; // 送られる JSON の大きさ(バイト)
const DRAFT_LIMIT = 120_000;
const WORST_USD = 0.04;   // 1回の送信で、かかりうる最大の目安(ドル)。--max-usd の判定に使う(2026-11-06 費用点検で 0.03→0.04。理屈の上の最悪 約0.032)

// ---------------------------------------------------------------- 失敗(状態の番号・コード・日本語の文)
class LabError extends Error {
  constructor(status, error, message, extra = null) { super(message); this.status = status; this.error = error; this.extra = extra; }
}
const bad = message => new LabError(400, 'bad_request', message);

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// 送られてきた JSON を読む(大きさの上限つき。だめなら 400)
async function readBodyJson(req, limit = BODY_LIMIT) {
  try {
    const v = await readJson(req, { limit });
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('送る中身が { } の形ではありません。');
    return v;
  } catch (e) {
    if (e instanceof LabError) throw e;
    throw bad(e?.status === 413 ? '送る中身が大きすぎます。' : '送る中身が読めません。');
  }
}

// ---------------------------------------------------------------- 静的ファイル(web/ の中だけ)
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};
// 「.」「..」の段(%2e も)・「\」(%5c も)は、そもそも受けつけない
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)|\\|%5c/i;

function staticFile(rawPath) {
  if (DOT_SEGMENT.test(rawPath)) return null;
  if (rawPath === '/' || rawPath === '/index.html') return path.join(ROOT, 'web', 'index.html');
  if (!rawPath.startsWith('/web/')) return null;
  const full = urlToFile(ROOT, rawPath);
  if (!full) return null;
  const rel = path.relative(ROOT, full).split(path.sep);
  if (rel.length < 2 || rel[0] !== 'web') return null;
  if (!TYPES[path.extname(full).toLowerCase()]) return null;
  return full;
}

function serveStatic(req, res, rawPath) {
  const file = staticFile(rawPath);
  let data = null;
  if (file) { try { if (fs.statSync(file).isFile()) data = fs.readFileSync(file); } catch { /* 無い */ } }
  if (!data) return sendText(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// ---------------------------------------------------------------- 入力の確かめ
const KEY_LIKE = '鍵のような文字が入っています。消してから送ってください(鍵は黒い画面にだけ貼ります)。';
const cpLen = s => Array.from(s).length;
const isLang = v => v === 'ja' || v === 'en';
const isThink = v => typeof v === 'string' && Object.hasOwn(THINK_LEVELS, v);
const nowMs = () => Date.now();

function checkText(v, secrets = []) {
  if (typeof v !== 'string') throw bad('文は文字で送ってください。');
  const t = v.trim();
  const n = cpLen(t);
  if (n < 1 || n > 400) throw bad('文は 1〜400 文字で書いてください。');
  // 鍵はここに貼らない。鍵のように見える文字は、AIにも記録にも送らずに断る
  if (redact(t, { secrets }) !== t) throw bad(KEY_LIKE);
  return t;
}

// ---------------------------------------------------------------- 起動(鍵を聞かない。テストでも使う)
export async function startLab({
  dry = false, port = 0, dataDir, model = DEFAULTS.model, key = '', fetchImpl,
  perClient = DEFAULTS.perClient, overall = DEFAULTS.overall, maxUsd = null,
} = {}) {
  if (!dry && (typeof key !== 'string' || !key)) throw new Error('本物のモードには、APIの鍵が要ります。');
  // 料金表に無いモデルでは費用が足されず、上限が効かない。黙って効かないより、起動を断る(費用点検 2026-11-06 2回目)
  if (!dry && maxUsd !== null && !Object.hasOwn(PRICES, model)) {
    throw new Error(`--max-usd は、料金表にあるモデル(${Object.keys(PRICES).join('・')})のときだけ使えます。`);
  }
  const secrets = key ? [key] : [];
  const store = createStore(dataDir || defaultDataDir(), { secrets });
  const limitClient = rateLimiter({ max: perClient, perMs: DEFAULTS.perMs });
  const limitAll = rateLimiter({ max: overall, perMs: DEFAULTS.perMs });
  const convs = new Map(); // 会話の id → 会話(メモリだけ)
  const totals = { turns: 0, usd: 0, unknown: 0 }; // unknown: 料金表に無いモデルで、目安を出せなかった回数
  const totalsOut = () => ({ turns: totals.turns, usd: totals.usd, unknown: totals.unknown });
  let listenPort = 0;
  let inflight = 0; // いま答えを待っている本物の送信の数(上限の判定に入れる)
  const thinkLabels = Object.fromEntries(Object.entries(THINK_LEVELS).map(([k, v]) => [k, v.label]));

  // ---- 設計図
  function blueprintList() {
    return [
      ...listOfficial().map(b => ({ ...b, kind: 'official' })),
      ...store.listDrafts(),
    ];
  }
  function loadRef(ref) {
    if (!refOk(ref)) throw bad('設計図の指定がおかしいです。');
    try {
      return ref.startsWith('official:') ? loadOfficial(ref.slice(9)) : store.loadDraft(ref.slice(6));
    } catch (e) {
      throw new LabError(404, 'not_found', String(e?.message || '設計図が見つかりません。'));
    }
  }

  // ---- 会話
  function touch(conv) { convs.delete(conv.id); convs.set(conv.id, conv); }
  function getConv(id) {
    const c = typeof id === 'string' ? convs.get(id) : undefined;
    if (!c) throw new LabError(404, 'not_found', '会話が見つかりません。新しい会話にしてください。');
    touch(c);
    return c;
  }
  // 1回ごとの種を、設計図の variety とネタの型から、でたらめに選ぶ(前の回と同じネタの型は避ける)
  function pickVariety(conv, first) {
    const v = conv.blueprint.variety;
    const one = a => (Array.isArray(a) && a.length ? a[randomInt(a.length)] : null);
    const ids = conv.blueprint.neta_types.map(n => n.id).filter(id => id !== conv.lastNeta && !(first && id === 'saga')); // 1回目に「続きの物語」は選ばない
    const p = { stage: one(v?.stages), character: one(v?.characters), style: one(v?.styles), neta: one(ids) };
    if (!v) { p.stage = null; p.character = null; p.style = null; }
    conv.lastNeta = p.neta;
    return p;
  }

  function newConv(body) {
    if (!refOk(body.ref)) throw bad('設計図の指定がおかしいです。');
    if (!isLang(body.lang)) throw bad('言語の指定がおかしいです(日本語か English)。');
    if (!isThink(body.think)) throw bad('考える量の指定がおかしいです。');
    let blueprint;
    try { blueprint = loadRef(body.ref); } catch (e) { throw bad(e.message); } // 約束どおり、ref がおかしければ 400
    // 指示文は、始めるときに作って固定する(あとで設計図のファイルが変わっても、この会話は変えない)
    const conv = {
      id: newToken(16), ref: body.ref, lang: body.lang, think: body.think, blueprint,
      system: buildSystem(blueprint, body.lang),
      messages: [],   // AIとの会話の履歴(足していくだけ)
      turn: 0,        // 次に付ける番号(つらい入力の回も数える)
      last: null,     // いちばん新しいバカの答え(言い直し用)
      regen: 0, busy: false,
    };
    convs.set(conv.id, conv);
    while (convs.size > MAX_CONVS) convs.delete(convs.keys().next().value);
    return conv;
  }

  // 1回ぶんの答えを作る。userText は、いまの利用者の文。historyBase は、その文の前までの履歴。
  async function answer(conv, userText, historyBase, turn) {
    const t0 = nowMs();
    const first = historyBase.length === 0;
    let filtered = false;
    let reply, problems, usage, thinking, content, tries, picks = null;
    let fail = null;

    if (isCrisis(userText)) {
      // つらい入力は、AIに送らない。履歴にも足さない。
      filtered = true;
      conv.safety = true; // この会話では、もう種(毎回ちがう答えの種)をつけない
      reply = { mode: 'safety', language: conv.lang, neta: 'none', say: crisisAnswer(conv.lang).message, action: null, item: null };
      problems = []; usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      thinking = ''; content = null; tries = 0;
    } else {
      const messages = [...historyBase, { role: 'user', content: userText }];
      picks = conv.safety ? null : pickVariety(conv, first); // 安全モードが出た会話には、種をつけない(安全点検 2026-11-06)
      let r;
      if (!dry && maxUsd !== null && totals.usd + (inflight + 1) * WORST_USD > maxUsd) {
        throw new LabError(429, 'over_budget', `起動してからの費用が、上限(約 $${maxUsd})に近づいたので止めました。続けるなら、黒い画面を閉じて、上限を上げて起動し直してください。`, { totals: totalsOut() });
      }
      if (dry) {
        r = await fakeIdiot({ blueprint: conv.blueprint, lang: conv.lang, text: userText + '​'.repeat(conv.regen), first, turnIndex: historyBase.length / 2 });
      } else {
        inflight += 1;
        try {
          r = await askIdiot({ key, model, system: conv.system, messages, think: conv.think, lang: conv.lang, first, fetchImpl,
            // 安全モードが出た会話では、答え(行動カード)を求めず、まじめにする固定の一文を付ける(安全点検 2026-11-06)
            blueprint: conv.safety ? { ...conv.blueprint, always_action: false } : conv.blueprint,
            variation: conv.safety ? AFTER_SAFETY_NOTE : buildVariation(picks) });
        } finally { inflight -= 1; }
      }
      if (!r.ok) fail = r;
      else ({ reply, problems, usage, thinking, content, tries } = r);
      if (!fail) {
        conv.messages = [...messages, { role: 'assistant', content }];
        if (reply && reply.mode === 'safety') conv.safety = true;
      }
    }
    if (fail) {
      // 失敗でも、返事が届いていれば、お金はかかっている。合計と記録に入れる
      const failCost = fail.usage ? costUsd(fail.usage, model) : 0;
      totals.usd += failCost || 0;
      if (fail.usage && failCost === null) totals.unknown += 1;
      if (fail.usage) {
        store.appendLog({ type: 'error', at: new Date().toISOString(), conv: conv.id, turn, ref: conv.ref, error: String(fail.error || 'api'), model, usage: fail.usage, costUsd: failCost });
      }
      throw new LabError(502, String(fail.error || 'api'), String(fail.message || 'AIの呼び出しに失敗しました。'),
        { costUsd: failCost, totals: totalsOut() });
    }

    const cost = filtered || dry ? 0 : costUsd(usage, model);
    totals.turns += 1;
    totals.usd += cost || 0;
    if (cost === null) totals.unknown += 1;
    const ms = nowMs() - t0;
    const entry = {
      type: 'turn', at: new Date().toISOString(), conv: conv.id, turn, ref: conv.ref, lang: conv.lang, think: conv.think,
      model, dry, user: userText, reply, problems, filtered, usage, costUsd: cost, ms, regen: conv.regen, picks,
    };
    store.appendLog(entry);
    conv.last = { text: userText, filtered, turn };
    const out = {
      conv: conv.id, turn, ref: conv.ref, lang: conv.lang, think: conv.think, model, dry,
      reply, problems, thinking, filtered, usage, costUsd: cost,
      totals: totalsOut(), ms, tries,
    };
    return redactDeep(out, secrets);
  }

  // ---- 道
  async function chat(req, res) {
    const body = await readBodyJson(req);
    const text = checkText(body.text, secrets);
    const isNew = body.conv === null || body.conv === undefined;
    if (!isNew && typeof body.conv !== 'string') throw bad('会話の指定がおかしいです。');
    const conv = isNew ? newConv(body) : getConv(body.conv);
    if (conv.busy) throw new LabError(409, 'busy', 'いま前の答えを待っています。少し待ってください。');
    if (conv.turn >= MAX_TURNS) throw new LabError(409, 'too_many_turns', '新しい会話にしてください(1つの会話は 30 回までです)。');
    conv.busy = true;
    try {
      const turn = conv.turn;
      const out = await answer(conv, text, conv.messages, turn);
      conv.turn += 1;
      return sendJson(res, 200, out);
    } catch (e) {
      if (isNew) convs.delete(conv.id); // 失敗した新しい会話は、残さない
      throw e;
    } finally { conv.busy = false; }
  }

  async function regenerate(req, res) {
    const body = await readBodyJson(req);
    if (typeof body.conv !== 'string') throw bad('会話の指定がおかしいです。');
    const conv = getConv(body.conv);
    if (conv.busy) throw new LabError(409, 'busy', 'いま前の答えを待っています。少し待ってください。');
    if (!conv.last) throw new LabError(409, 'nothing', '言い直させる答えがまだありません。');
    conv.busy = true;
    const saved = conv.messages;
    try {
      const { text, turn, filtered } = conv.last;
      // 最後のバカの答え(と、その文)だけを外して、同じ文でもう一度。つらい入力の回は、履歴に無いのでそのまま。
      const base = filtered ? conv.messages : conv.messages.slice(0, -2);
      conv.regen += 1;
      const out = await answer(conv, text, base, turn);
      return sendJson(res, 200, out);
    } catch (e) {
      conv.messages = saved; // 失敗したら、履歴は元のまま
      throw e;
    } finally { conv.busy = false; }
  }

  async function rate(req, res) {
    const body = await readBodyJson(req);
    const conv = getConv(body.conv);
    if (!Number.isInteger(body.turn) || body.turn < 0 || body.turn >= conv.turn) throw bad('何回目の答えかの指定がおかしいです。');
    if (!['good', 'meh', 'bad'].includes(body.rating)) throw bad('評価は「いい・ふつう・だめ」のどれかにしてください。');
    const memo = body.memo === undefined || body.memo === null ? '' : body.memo;
    if (typeof memo !== 'string' || cpLen(memo) > 500) throw bad('メモは 500 文字までです。');
    if (redact(memo, { secrets }) !== memo) throw bad(KEY_LIKE);
    store.appendLog({ type: 'rate', at: new Date().toISOString(), conv: conv.id, turn: body.turn, rating: body.rating, memo });
    return sendJson(res, 200, { ok: true });
  }

  async function saveBlueprint(req, res) {
    const body = await readBodyJson(req, DRAFT_LIMIT);
    loadRef(body.base); // 元の設計図が無ければ 400/404
    if (!body.blueprint || typeof body.blueprint !== 'object' || Array.isArray(body.blueprint)) throw bad('設計図の中身が { } の形ではありません。');
    let bp;
    try { bp = store.saveDraft(body.blueprint, body.base); }
    catch (e) { throw bad(String(e?.message || '設計図がだめです。')); }
    return sendJson(res, 200, { ref: 'draft:' + bp.version, blueprint: bp });
  }

  async function summary(req, res) {
    const body = await readBodyJson(req);
    const days = body.days;
    if (!Number.isInteger(days) || days < 1 || days > 30) throw bad('日数は 1〜30 にしてください。');
    if (typeof body.onlyRated !== 'boolean') throw bad('「評価をつけた回だけ」の指定がおかしいです。');
    let draft = null;
    if (body.includeDraft !== null && body.includeDraft !== undefined) draft = { ref: body.includeDraft, blueprint: loadRef(body.includeDraft) };
    const markdown = buildSummary({ entries: store.readLogs(days), days, onlyRated: body.onlyRated, thinkLabels, draft });
    return sendJson(res, 200, { markdown: redact(markdown, { secrets }) });
  }

  function limited(req) {
    const who = String(req.socket.remoteAddress || '?');
    if (!limitClient(who) || !limitAll('all')) throw new LabError(429, 'too_many', '回数が多すぎます。少し待ってから、もう一度。');
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const method = req.method;
    if (!p.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') throw new LabError(405, 'method', 'この頼みは使えません。');
      return serveStatic(req, res, String(req.url).split('?')[0].split('#')[0]);
    }
    try {
      const gets = {
        '/api/state': () => sendJson(res, 200, {
          dry, model, port: listenPort,
          thinkLevels: Object.entries(THINK_LEVELS).map(([k, v]) => ({ key: k, label: v.label })),
          blueprints: blueprintList(),
          defaultRef: (listOfficial().at(-1) || { ref: 'official:v001' }).ref, // いちばん新しい公式の設計図
          totals: totalsOut(),
        }),
        '/api/blueprint': () => sendJson(res, 200, loadRef(url.searchParams.get('ref'))),
        '/api/system': () => {
          const ref = url.searchParams.get('ref');
          const lang = url.searchParams.get('lang');
          if (!isLang(lang)) throw bad('言語の指定がおかしいです(日本語か English)。');
          return sendJson(res, 200, { ref, lang, system: buildSystem(loadRef(ref), lang) });
        },
      };
      const posts = {
        '/api/chat': () => { limited(req); return chat(req, res); },
        '/api/regenerate': () => { limited(req); return regenerate(req, res); },
        '/api/rate': () => rate(req, res),
        '/api/blueprint': () => saveBlueprint(req, res),
        '/api/summary': () => summary(req, res),
      };
      if (method === 'GET' && gets[p]) return await gets[p]();
      if (method === 'POST' && posts[p]) return await posts[p]();
      if (gets[p] || posts[p]) throw new LabError(405, 'method', 'この頼みは使えません。');
      throw new LabError(404, 'not_found', 'その道はありません。');
    } catch (e) {
      if (e instanceof LabError) return sendJson(res, e.status, { error: e.error, message: e.message, ...(e.extra || {}) });
      throw e; // ほかは createLocalServer が、短い文だけ返す
    }
  }

  const server = await createLocalServer(handler, { port, secrets });
  listenPort = server.address().port;
  return {
    server, port: listenPort,
    close: () => new Promise(ok => { server.close(() => ok()); server.closeAllConnections?.(); }),
  };
}

// ---------------------------------------------------------------- 引数・鍵を聞く・起動
function parseArgs(argv) {
  const o = { dry: false, open: false, newKey: false, deleteKey: false, port: DEFAULTS.port, dataDir: undefined, model: DEFAULTS.model, perClient: DEFAULTS.perClient, overall: DEFAULTS.overall, maxUsd: null };
  const count = (name, v, min, max) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} は ${min}〜${max} の数`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') o.dry = true;
    else if (argv[i] === '--open') o.open = true;
    else if (argv[i] === '--new-key') o.newKey = true;
    else if (argv[i] === '--delete-key') o.deleteKey = true;
    else if (argv[i] === '--port') o.port = count('--port', argv[++i], 0, 65535);
    else if (argv[i] === '--data') {
      const d = String(argv[++i] || '');
      if (!d) throw new Error('--data にはフォルダを書いてください');
      o.dataDir = path.resolve(d);
    } else if (argv[i] === '--model') {
      const m = String(argv[++i] || '');
      if (!/^[a-z0-9][a-z0-9.\-]{0,63}$/.test(m)) throw new Error('--model は英小文字・数字・「.」「-」だけ');
      o.model = m;
    } else if (argv[i] === '--per-client') o.perClient = count('--per-client', argv[++i], 1, 1000);
    else if (argv[i] === '--overall') o.overall = count('--overall', argv[++i], 1, 10000);
    else if (argv[i] === '--max-usd') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0 || n > 10000) throw new Error('--max-usd は 0 より大きい数(ドル)');
      o.maxUsd = n;
    }
  }
  return o;
}

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
      for (const ch of chunk.toString('utf8')) {
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

// 準備ができたあとで、いつものブラウザに画面を開く(--open。Windows だけ)。
// 2026-11-06 社長の知らせ「本物のAIでサイトが開かなくて会話できない」: 本物の .bat はブラウザを開かなかったため。
// 開くのは、この窓口の http://127.0.0.1:番号/ だけ。explorer.exe を Windows の決まった場所から、決まった引数で起こす(シェルを通さない)。
export function openBrowser(url, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32' || typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/$/.test(url)) return false;
  const root = deps.systemRoot !== undefined ? deps.systemRoot : process.env.SystemRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root) || /^[\\/]{2}/.test(root)) return false;
  const exe = path.join(root, 'explorer.exe');
  try {
    const child = (deps.spawn || spawn)(exe, [url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* 開けなくても、窓口は動かし続ける */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// その番号が、もう使われているか(前に開いたバカ工房がまだ動いているとき)。使われていれば true
// 2026-11-06 社長の知らせ「鍵をはったのに開かない」: 動いている最中に .bat をもう一度開くと、番号がぶつかって止まっていたため。
export function portBusy(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) { resolve(false); return; }
    const s = net.createServer();
    s.once('error', (e) => resolve(Boolean(e && e.code === 'EADDRINUSE')));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(false)));
  });
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.deleteKey) {
    const r = deleteKey();
    console.error(r.ok ? (r.existed ? '保存した鍵を消しました。次に本物を動かすときは、また鍵を貼ります。' : '保存した鍵はありませんでした。') : r.text);
    if (r.ok && r.existed && await portBusy(opt.port)) console.error(`(${opt.port} 番で動いている黒い画面は、閉じるまで、覚えている鍵で動き続けます。止めるときは、その画面を閉じてください)`);
    process.exit(r.ok ? 0 : 1);
  }
  // もう動いているときは、鍵を読まず・聞かずに、動いている画面を開いて終わる
  if (!opt.deleteKey && await portBusy(opt.port)) {
    const url = `http://127.0.0.1:${opt.port}/`;
    console.error(`${opt.port} 番は、もう使われています(ふつうは、前に開いたバカ工房の黒い画面)。新しくは起動しません。`);
    console.error(opt.open && openBrowser(url) ? 'ブラウザで、動いている画面を開きました。' : `ブラウザで ${url} を開いてください。`);
    console.error(opt.newKey
      ? '鍵を貼り直すときは、前の黒い画面を閉じてから、もう一度「バカ工房 鍵を貼り直す.bat」を開いてください。'
      : '起動し直したいときは、前の黒い画面を閉じてから、もう一度開いてください。');
    process.exit(0);
  }
  let key = '';
  if (!opt.dry) {
    if (!opt.newKey) {
      const r = await loadKey();
      if (r.ok) {
        key = r.key;
        console.error(`(保存した鍵を使います。保存した日時: ${formatSavedAt(r.savedAt)}。貼り直すときは「バカ工房 鍵を貼り直す.bat」)`);
      } else if (r.code !== 'no_key') {
        console.error(r.text + '(今回は、鍵を貼ってください)');
      }
    }
    if (!key) {
      key = await askKey('ANTHROPIC_API_KEY を貼って Enter(暗号化して、このPCに保存します): ');
      if (!key) { console.error('鍵がないので終わります。'); process.exit(1); }
      if (!keyShapeOk(key)) { console.error('「sk-ant-」で始まる鍵の形ではありません。保存しないで終わります。'); process.exit(1); }
      const s = await saveKey(key);
      if (s.ok) {
        console.error('(鍵を暗号化して保存しました。次からは貼らずに使えます。消すときは「バカ工房 鍵を消す.bat」)');
      } else {
        // 貼り直しで保存できなかったときは、前の鍵を残さない(次の起動で、黙って前の鍵が使われないように)
        const d = opt.newKey ? deleteKey() : null;
        console.error(s.text + '(今回貼った鍵だけで動きます)'
          + (d && d.ok && d.existed ? '(前に保存した鍵は消しました)' : '')
          + (d && !d.ok ? '(前に保存した鍵が残っています。「バカ工房 鍵を消す.bat」で消してください)' : ''));
      }
    }
  }
  const dataDir = opt.dataDir || defaultDataDir();
  const lab = await startLab({ dry: opt.dry, port: opt.port, dataDir, model: opt.model, key, perClient: opt.perClient, overall: opt.overall, maxUsd: opt.maxUsd });
  console.log(`http://127.0.0.1:${lab.port}/`);
  if (opt.open) {
    console.error(openBrowser(`http://127.0.0.1:${lab.port}/`)
      ? '(ブラウザで画面を開きました。開かないときは、上の http://127.0.0.1:… をブラウザに貼ってください)'
      : '(ブラウザを開けませんでした。上の http://127.0.0.1:… をブラウザに貼ってください)');
  }
  console.error(opt.dry
    ? '(予行: にせのバカが答えています。外へはつながりません)'
    : `(本物のAI: モデル名 ${opt.model}【仮置き。違うと 502】。止めるときは Ctrl+C)`);
  console.error(`(モデル名: ${opt.model})`);
  console.error(`(データの置き場: ${dataDir})`);
  if (!opt.dry && !Object.hasOwn(PRICES, opt.model)) console.error('【知らせ】このモデルは料金表に無いので、費用の目安が出ません(合計は「以上」の表示になります)。Anthropic の管理画面で、月の使う上限を決めておいてください。');
  console.error(opt.maxUsd ? `(起動してからの費用の上限: 約 $${opt.maxUsd}。超えそうなら止めます)` : '(起動してからの費用の上限: 決めていません。--max-usd 1 のように決められます)');
  console.error(`(回数の上限: ひとつの相手 1分 ${opt.perClient}回・全体 1分 ${opt.overall}回【仮置き】)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('起動できなかった: ' + redact(String(e?.message || e))); process.exit(1); });
}
