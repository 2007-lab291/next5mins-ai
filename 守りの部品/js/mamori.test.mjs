// 守りの部品(JS)の自動テスト。動かし方: node --test 守りの部品/js/mamori.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as m from './mamori.mjs';

// サーバーに頼みを送る(Host などを自由に決められるように http.request を使う)
function ask(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, res => {
      let t = '';
      res.on('data', c => { t += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('サーバー: 守りの札・Host・Origin・大きさ・エラーを隠す', async () => {
  const logs = [];
  const server = await m.createLocalServer(async (req, res) => {
    if (req.url === '/boom') throw new Error('sk-ant-abcdefghijklmnop123 が漏れた');
    if (req.method === 'POST') { const j = await m.readJson(req, { limit: 50 }); return m.sendText(res, 200, JSON.stringify(j)); }
    m.sendText(res, 200, 'ok');
  }, { port: 0, log: s => logs.push(s) });
  const port = server.address().port;
  try {
    assert.equal(server.address().address, '127.0.0.1');
    const ok = await ask(port);
    assert.equal(ok.status, 200);
    assert.match(ok.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');

    assert.equal((await ask(port, { headers: { Host: 'evil.example:80' } })).status, 400);
    assert.equal((await ask(port, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).status, 400);
    assert.equal((await ask(port, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await ask(port, { headers: { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'navigate' } })).status, 200);
    assert.equal((await ask(port, { headers: { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' } })).status, 403);

    const json = { 'Content-Type': 'application/json' };
    assert.equal((await ask(port, { method: 'POST', headers: json, body: '{"a":1}' })).status, 403); // Origin なし
    assert.equal((await ask(port, { method: 'POST', headers: { ...json, Origin: 'http://evil.example' }, body: '{"a":1}' })).status, 403);
    const good = await ask(port, { method: 'POST', headers: { ...json, Origin: `http://localhost:${port}` }, body: '{"a":1,"__proto__":{"x":1}}' });
    assert.equal(good.status, 200);
    assert.equal(good.text, '{"a":1}');
    const own = { ...json, Origin: `http://127.0.0.1:${port}` };
    assert.equal((await ask(port, { method: 'POST', headers: own, body: 'x'.repeat(100) })).status, 413);
    assert.equal((await ask(port, { method: 'POST', headers: own, body: '{bad' })).status, 400);
    assert.equal((await ask(port, { method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);

    const boom = await ask(port, { path: '/boom' });
    assert.equal(boom.status, 500);
    assert.equal(boom.text, 'server error');
    assert.ok(logs.some(s => s.includes('[伏せた]')) && !logs.some(s => s.includes('sk-ant-abc')));
  } finally {
    server.close();
  }
});

test('checkRequest: よその送り主を断る(allowRemote で外せる)', () => {
  const req = { method: 'GET', socket: { remoteAddress: '192.168.1.5' }, headers: { host: '127.0.0.1:80' } };
  assert.deepEqual(m.checkRequest(req, { port: 80 }), { status: 403, reason: 'not local' });
  assert.equal(m.checkRequest(req, { port: 80, allowRemote: true }), null);
  assert.equal(m.isLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
});

test('safeJoin: フォルダの外に出さない', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-'));
  try {
    fs.mkdirSync(path.join(root, 'css'));
    assert.equal(m.safeJoin(root, '/css/a.css'), path.join(root, 'css', 'a.css'));
    assert.equal(m.safeJoin(root, 'a/../b.txt'), path.join(root, 'b.txt'));
    for (const bad of ['../x', '..\\x', '/../../etc/passwd', 'C:/Windows/win.ini', 'a\0b', 'secret.txt::$DATA', 'NUL', 'con.txt', 'a.txt.', 'a.txt ', 'css/../../x', '.env', 'a/.git/config', 'SECRET~1.JSO', 'CONIN$', 'COM¹']) {
      assert.equal(m.safeJoin(root, bad), null, bad);
    }
    assert.equal(m.urlToFile(root, '/%2e%2e/%2e%2e/x'), path.join(root, 'x')); // URL の決まりで「..」は消える(外に出ない)
    assert.equal(m.urlToFile(root, '/%252e%252e/x'), path.join(root, '%2e%2e', 'x')); // 2回は戻さない
    assert.equal(m.urlToFile(root, '/..%5c..%5cx'), null);
    assert.equal(m.urlToFile(root, '/%E0%A4%A'), null);
    assert.equal(m.urlToFile(root, '/css/a%20b.css?x=1'), path.join(root, 'css', 'a b.css'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('redact: 鍵を伏せる', () => {
  const s = m.redact('k=sk-ant-api03-AAAAAAAAAAAAAAAA x sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB Authorization: Bearer abcdefghij\n?api_key=12345678&q=1 ghp_CCCCCCCCCCCCCCCCCCCCCCCC AKIAABCDEFGHIJKLMNOP "password": "hunter22"');
  for (const leak of ['sk-ant-api03', 'BBBBBBBB', 'abcdefghij', '12345678', 'ghp_', 'AKIAABCD', 'hunter22']) assert.ok(!s.includes(leak), leak);
  assert.ok(s.includes('q=1'));
  const s2 = m.redact('Authorization: Basic dXNlcjpwYXNz\n{\\"api_key\\":\\"abc12345\\"} ASIAABCDEFGHIJKLMNOP sk_live_abcdefghijkl hf_ABCDEFGHIJKLMNOPQRSTU glpat-ABCDEFGHIJKLMNOPQRST https://me:pass1234@example.com/x');
  for (const leak of ['dXNlcjpwYXNz', 'abc12345', 'ASIAABCD', 'sk_live_a', 'hf_ABC', 'glpat-ABC', 'pass1234']) assert.ok(!s2.includes(leak), leak);
  assert.ok(s2.includes('@example.com/x'));
  assert.equal(m.redact('私の鍵は my-own-secret です', { secrets: ['my-own-secret'] }), '私の鍵は [伏せた] です');
  assert.equal(m.redact('ふつうの文'), 'ふつうの文');
});

test('escapeHtml と csvCell', () => {
  assert.equal(m.escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(m.csvCell('=1+1'), "'=1+1");
  assert.equal(m.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(m.csvCell('＝HYPERLINK("x")'), `"'＝HYPERLINK(""x"")"`);
  assert.equal(m.csvCell('-5.2'), '-5.2');
  assert.equal(m.csvCell(-3), '-3');
  assert.equal(m.csvCell('a,b'), '"a,b"');
  assert.equal(m.csvCell('a\x07b'), 'ab');
  assert.equal(m.csvCell(null), '');
});

test('合言葉・ファイルの置きかえ・回数の上限・行き先', () => {
  const t = m.newToken();
  assert.ok(t.length >= 40);
  assert.equal(m.sameToken(t, t), true);
  assert.equal(m.sameToken(t, t + 'x'), false);
  assert.equal(m.sameToken(undefined, undefined), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamori-'));
  try {
    const f = path.join(dir, 'a.json');
    m.writeFileAtomic(f, '1');
    m.writeFileAtomic(f, '2');
    assert.equal(fs.readFileSync(f, 'utf8'), '2');
    assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const ok = m.rateLimiter({ max: 2, perMs: 60_000 });
  assert.deepEqual([ok('a'), ok('a'), ok('a'), ok('b')], [true, true, false, true]);
  const ok2 = m.rateLimiter({ max: 1, perMs: 60_000 });
  ok2('login');
  for (let i = 0; i < 10_001; i++) ok2('x' + i); // 違う鍵をたくさん送っても
  ok2('login');
  for (let i = 0; i < 9_000; i++) ok2('y' + i);
  assert.equal(ok2('login'), false); // 最近使った login の上限は消えない

  const hosts = ['api.example.com'];
  assert.ok(m.checkUrl('https://api.example.com/v1?x=1', { hosts }));
  for (const bad of ['http://api.example.com/', 'https://evil.com/', 'https://api.example.com.evil.com/', 'https://u:p@api.example.com/', 'https://api.example.com:444/', 'nonsense']) {
    assert.equal(m.checkUrl(bad, { hosts }), null, bad);
  }
});

test('safeFetch: 許可の無い行き先には、つながない', async () => {
  await assert.rejects(m.safeFetch('https://evil.example/', { hosts: ['api.example.com'] }), /許可の一覧に無い/);
});
