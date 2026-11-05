// パーツX(AIの窓口)のテスト。予行(--dry)だけ。外へはつながない。
// 動かし方: node --test tests/server.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateResult } from '../server/validate.mjs';
import { buildSystem, BASE_PROMPT } from '../server/prompt.mjs';
import { isCrisis, crisisAnswer } from '../server/crisis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', 'server', 'server.mjs');

function start() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--dry', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('起動しない')); }, 10_000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('止まった ' + code)); });
  });
}

function stop(s) {
  if (!s) return;
  s.child.removeAllListeners('exit');
  s.child.kill();
}

// 決めた形のまま送る(fetch は Origin などを勝手に変えることがあるので、http で送る)
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function post(port, data, extra = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return request(port, {
    method: 'POST', path: '/api/next5', body,
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'content-length': Buffer.byteLength(body), ...extra }
  });
}

let s;
before(async () => { s = await start(); });
after(() => stop(s));

test('GET / は 200・text/html・CSP の札つき', async () => {
  const r = await request(s.port, { path: '/' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.ok(r.headers['content-security-policy']);
});

test('server/・tests/・README.md は読ませない(404)', async () => {
  for (const p of ['/server/server.mjs', '/server/mamori.mjs', '/tests/server.test.mjs', '/README.md', '/parts/CONTRACT.md', '/common/../server/server.mjs']) {
    const r = await request(s.port, { path: p });
    assert.equal(r.status, 404, p);
  }
});

test('GET /common/bus.js は 200(js)', async () => {
  const r = await request(s.port, { path: '/common/bus.js' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /javascript/);
});

test('上のフォルダへ出る道は 404 か 400', async () => {
  for (const p of ['/%2e%2e/', '/../', '/common/%2e%2e/server/server.mjs', '/parts/..%2f..%2fREADME.md', '/common/..%5cserver%5cserver.mjs']) {
    const r = await request(s.port, { path: p });
    assert.ok(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
  }
});

test('POST 正しい頼み → 200・4章の形・situation_summary が入力', async () => {
  for (const lang of ['en', 'ja']) {
    const text = lang === 'ja' ? '掃除をしないといけない' : 'I need to clean my room';
    const r = await post(s.port, { text: '  ' + text + '  ', lang });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^application\/json/);
    const j = JSON.parse(r.text);
    assert.ok(validateResult(j, lang), '形が違う');
    assert.equal(j.situation_summary, text);
    assert.equal(j.language, lang);
  }
});

test('text が 241 文字 → 400 / 空 → 400', async () => {
  assert.equal((await post(s.port, { text: 'a'.repeat(241), lang: 'en' })).status, 400);
  assert.equal((await post(s.port, { text: '   ', lang: 'en' })).status, 400);
});

test('lang が fr → 400', async () => {
  assert.equal((await post(s.port, { text: 'hello', lang: 'fr' })).status, 400);
});

test('中身が JSON でない → 400', async () => {
  assert.equal((await post(s.port, 'not json {')).status, 400);
});

test('よそのサイト(Origin: http://evil.example)からの POST → 403', async () => {
  const r = await post(s.port, { text: 'hello', lang: 'en' }, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
});

test('同じ相手から 1分に 11 回目 → 429', async () => {
  const s2 = await start(); // 回数を数え直すため、別に起動する
  try {
    const rs = await Promise.all(Array.from({ length: 11 }, () => post(s2.port, { text: 'hi', lang: 'en' })));
    const codes = rs.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 200).length, 10);
    assert.equal(codes.filter((c) => c === 429).length, 1);
  } finally { stop(s2); }
});

test('つらい入力 → AI を呼ばずに safety の形(X-9)', async () => {
  for (const [text, lang] of [['I want to die', 'en'], ['もう死にたい', 'ja']]) {
    const r = await post(s.port, { text, lang });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.text);
    assert.equal(j.safety, true);
    assert.equal(j.language, lang);
    assert.ok(j.message.length > 0);
    assert.equal(j.actions, undefined);
    assert.equal(j.idiot_item_throw, undefined);
    assert.deepEqual(validateResult(j, lang), j);
  }
});

test('crisis: 言葉の当たり・外れ', () => {
  for (const t of ['I feel suicidal', 'thinking about killing myself', 'self-harm again', '消えたい', '自殺', 'ＳＵＩＣＩＤＥ']) assert.ok(isCrisis(t), t);
  for (const t of ['I need to clean my room', 'kill time before the bus', 'die-cast model', '掃除をしないといけない', '確定申告']) assert.ok(!isCrisis(t), t);
  assert.deepEqual(Object.keys(crisisAnswer('ja')), ['language', 'safety', 'message']);
});

// ---- validate.mjs だけ
const good = {
  language: 'en', situation_summary: 's', extra: 'x',
  actions: {
    idiot: { title: 't', instruction: 'i', why_it_works: 'w', more: 1 },
    average: { title: 't', instruction: 'i', why_it_works: 'w' },
    god: { title: 't', instruction: 'i', why_it_works: 'w' }
  },
  idiot_item_throw: { shout_line: 's', item_name: 'n', item_emoji: '🦖', funny_reason: 'f', amazon_search_keyword: 'k' }
};

test('validate: 正しい形は通り、余分なキーは落ちる', () => {
  const v = validateResult(good, 'en');
  assert.ok(v);
  assert.equal(v.extra, undefined);
  assert.equal(v.actions.idiot.more, undefined);
});

test('validate: 欠け・型ちがい・長すぎはだめ', () => {
  const c = structuredClone(good); delete c.actions.god;
  assert.equal(validateResult(c, 'en'), null);
  const d = structuredClone(good); d.actions.idiot.title = 5;
  assert.equal(validateResult(d, 'en'), null);
  const e = structuredClone(good); e.idiot_item_throw.item_name = 'x'.repeat(81);
  assert.equal(validateResult(e, 'en'), null);
  assert.equal(validateResult(null, 'en'), null);
  assert.equal(validateResult([], 'en'), null);
});

test('validate: language が頼んだ言語と違えばだめ・別名はそろえる(X-6)', () => {
  assert.equal(validateResult(good, 'ja'), null);
  const f = structuredClone(good); f.language = 'fr';
  assert.equal(validateResult(f, 'en'), null);
  const g = structuredClone(good); g.language = 'English';
  assert.equal(validateResult(g, 'en').language, 'en');
  const h = structuredClone(good); h.language = '日本語';
  assert.equal(validateResult(h, 'ja').language, 'ja');
});

test('validate: つらい入力の形', () => {
  assert.deepEqual(validateResult({ safety: true, message: 'Please talk to someone.', joke: 'x' }, 'en'),
    { language: 'en', safety: true, message: 'Please talk to someone.' });
  assert.equal(validateResult({ safety: true, message: '' }, 'ja'), null);
});

test('prompt: 原文を土台に、言語・安全・お手本が入る', () => {
  const en = buildSystem('en');
  const ja = buildSystem('ja');
  assert.ok(en.startsWith(BASE_PROMPT.split('{{selected_language}}').join('English')));
  assert.ok(!en.includes('{{selected_language}}'));
  assert.ok(ja.includes('natural Japanese (日本語)'));
  assert.ok(en.includes('"safety": true') && en.includes('<approved_humor_examples>'));
  assert.ok(ja.includes('確定申告'));
});
