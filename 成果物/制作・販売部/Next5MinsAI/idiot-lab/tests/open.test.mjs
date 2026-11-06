// ブラウザを開く(lab/server.mjs の openBrowser)の自動テスト。にせの spawn だけを使う(本物のブラウザは開かない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import { openBrowser, portBusy } from '../lab/server.mjs';

const ROOT = path.join(path.parse(process.cwd()).root, 'Windows');
const fakeSpawn = (calls) => (exe, args, opts) => { calls.push({ exe, args, opts }); return { on() {}, unref() {} }; };

test('この窓口の http://127.0.0.1:番号/ だけを、決まった場所の explorer.exe で開く', () => {
  const calls = [];
  assert.equal(openBrowser('http://127.0.0.1:4910/', { platform: 'win32', systemRoot: ROOT, spawn: fakeSpawn(calls) }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, path.join(ROOT, 'explorer.exe'));
  assert.deepEqual(calls[0].args, ['http://127.0.0.1:4910/']);
  assert.equal(calls[0].opts.shell, undefined); // シェルを通さない
});

test('ほかの URL・Windows 以外・あやしい SystemRoot では開かない', () => {
  const calls = [];
  const s = fakeSpawn(calls);
  for (const url of ['http://evil.example/', 'http://127.0.0.1:4910/x', 'https://127.0.0.1:4910/', 'http://localhost:4910/', 'http://127.0.0.1:4910/ & calc', 'file:///C:/x']) {
    assert.equal(openBrowser(url, { platform: 'win32', systemRoot: ROOT, spawn: s }), false, url);
  }
  assert.equal(openBrowser('http://127.0.0.1:4910/', { platform: 'linux', spawn: s }), false);
  assert.equal(openBrowser('http://127.0.0.1:4910/', { platform: 'win32', systemRoot: '\\\\srv\\share', spawn: s }), false);
  assert.equal(openBrowser('http://127.0.0.1:4910/', { platform: 'win32', systemRoot: 'Windows', spawn: s }), false);
  assert.equal(calls.length, 0);
});

test('起こせなくても例外を投げない', () => {
  assert.equal(openBrowser('http://127.0.0.1:4910/', { platform: 'win32', systemRoot: ROOT, spawn: () => { throw new Error('x'); } }), false);
});

test('番号がもう使われているかを見分ける(前のバカ工房が動いているとき)', async () => {
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  assert.equal(await portBusy(port), true);
  await new Promise(r => srv.close(r));
  assert.equal(await portBusy(port), false);
  assert.equal(await portBusy(0), false);
});
