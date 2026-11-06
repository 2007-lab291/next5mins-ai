// 鍵の暗号化保存(lab/key-store.mjs)の自動テスト。にせの暗号化と一時フォルダだけを使う。
// 本物の鍵の置き場(%LOCALAPPDATA%\Next5MinsAI\idiot-lab-key)には触れない。PowerShell も起こさない(にせの spawn)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { saveKey, loadKey, deleteKey, keyInfo, keyShapeOk, resolveDir, FILE_NAME, KEY_STORE_TEXT, PS_PROTECT } from '../lab/key-store.mjs';

// 鍵の形をした、にせの文字(ソースに鍵の形の文字をそのまま書かないため、ここで組み立てる)
const FAKE = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-');
const FAKE2 = ['sk', 'ant', 'api03', 'zyxwvutsrqponmlkjihgfedcba9876543210'].join('-');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'idiot-lab-key-test-'));
// にせの暗号化: 逆にして、印をつけて base64(鍵がそのまま入らない)
const protect = async s => Buffer.from('X' + [...s].reverse().join('') + 'X').toString('base64');
const unprotect = async b => { const t = Buffer.from(b, 'base64').toString('utf8'); return [...t.slice(1, -1)].reverse().join(''); };
const HERE = path.dirname(fileURLToPath(import.meta.url));

test('鍵の形: sk-ant- で始まる鍵だけ通す', () => {
  assert.equal(keyShapeOk(FAKE), true);
  for (const bad of ['', 'sk-test-not-a-real-key-0000', 'sk-ant-短い', 'sk-ant-abc', FAKE + ' ', 'あ' + FAKE, null, 12]) assert.equal(keyShapeOk(bad), false);
});

test('保存して読める。ファイルに鍵はそのまま入らない。中身は v・savedAt・blob だけ', async () => {
  const dir = tmp();
  const s = await saveKey(FAKE, { dir, protect });
  assert.equal(s.ok, true);
  const raw = fs.readFileSync(path.join(dir, FILE_NAME), 'utf8');
  assert.equal(raw.includes(FAKE), false);
  assert.equal(raw.includes('abcdefghij'), false);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['blob', 'savedAt', 'v']);
  assert.equal(keyInfo({ dir }).exists, true);
  const l = await loadKey({ dir, unprotect });
  assert.equal(l.ok, true);
  assert.equal(l.key, FAKE);
});

test('貼り直すと置き換わる', async () => {
  const dir = tmp();
  await saveKey(FAKE, { dir, protect });
  await saveKey(FAKE2, { dir, protect });
  assert.equal((await loadKey({ dir, unprotect })).key, FAKE2);
  assert.deepEqual(fs.readdirSync(dir), [FILE_NAME]); // 書きかけが残らない
});

test('暗号化になっていない(鍵がそのまま・base64 のまま)ときは書かない', async () => {
  const dir = tmp();
  for (const enc of [async s => s, async s => Buffer.from(s).toString('base64')]) {
    const r = await saveKey(FAKE, { dir, protect: enc });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'encrypt_failed');
  }
  assert.equal(fs.existsSync(path.join(dir, FILE_NAME)), false);
});

test('形の違う鍵は保存しない', async () => {
  const dir = tmp();
  const r = await saveKey('sk-test-not-a-real-key-0000', { dir, protect });
  assert.equal(r.code, 'bad_key');
  assert.equal(fs.existsSync(path.join(dir, FILE_NAME)), false);
});

test('失敗の文は固定で、鍵を含まない', async () => {
  const dir = tmp();
  const r = await saveKey(FAKE, { dir, protect: async () => { throw new Error('boom ' + FAKE); } });
  assert.equal(r.ok, false);
  assert.equal(r.text, KEY_STORE_TEXT.encrypt_failed);
  assert.equal(JSON.stringify(r).includes(FAKE), false);
  fs.writeFileSync(path.join(dir, FILE_NAME), JSON.stringify({ v: 1, savedAt: new Date().toISOString(), blob: 'QUJDREVGR0hJSktMTU5PUA==' }));
  const l = await loadKey({ dir, unprotect: async () => { throw new Error(FAKE); } });
  assert.equal(l.code, 'decrypt_failed');
  assert.equal(JSON.stringify(l).includes(FAKE), false);
});

test('壊れた・形の違うファイルは「保存した鍵はない」扱い', async () => {
  const dir = tmp();
  const f = path.join(dir, FILE_NAME);
  for (const body of ['{', '[]', '{"v":2,"savedAt":"2026-11-06T00:00:00Z","blob":"QUJDREVGR0hJSktMTU5PUA=="}',
    '{"v":1,"savedAt":"2026-11-06T00:00:00Z","blob":"QUJDREVGR0hJSktMTU5PUA==","key":"x"}', 'x'.repeat(9000)]) {
    fs.writeFileSync(f, body);
    assert.equal(keyInfo({ dir }).exists, false);
    assert.equal((await loadKey({ dir, unprotect })).code, 'no_key');
  }
});

test('消す: あれば消す・無くてもよい', async () => {
  const dir = tmp();
  await saveKey(FAKE, { dir, protect });
  assert.deepEqual(deleteKey({ dir }), { ok: true, existed: true });
  assert.equal(fs.existsSync(path.join(dir, FILE_NAME)), false);
  assert.deepEqual(deleteKey({ dir }), { ok: true, existed: false });
  assert.equal((await loadKey({ dir, unprotect })).code, 'no_key');
});

test('保存先: リポジトリの中・ネットワークの共有・相対の道は断る。既定は LOCALAPPDATA\\Next5MinsAI\\idiot-lab-key', () => {
  assert.equal(resolveDir({ dir: path.join(HERE, 'keys') }), null);
  assert.equal(resolveDir({ localAppData: '\\\\server\\share' }), null);
  assert.equal(resolveDir({ localAppData: 'relative' }), null);
  const base = tmp();
  assert.equal(resolveDir({ localAppData: base }), path.join(base, 'Next5MinsAI', 'idiot-lab-key'));
});

test('試験の中では、一時フォルダの外の本物の保存先に触れない', async () => {
  const saved = process.env.LOCALAPPDATA;
  try {
    process.env.LOCALAPPDATA = path.join(os.homedir(), 'idiot-lab-not-tmp-place'); // 一時フォルダの外
    if (!process.env.NODE_TEST_CONTEXT) return; // node --test のときだけ確かめる
    const r = await saveKey(FAKE, { protect });
    assert.equal(r.code, 'bad_dir');
  } finally {
    if (saved === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = saved;
  }
});

test('PowerShell には、鍵を標準入力だけで渡す(引数に入れない)。Windows 以外は保存しない', async () => {
  const dir = tmp();
  let seen = null;
  const spawn = (exe, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    let input = '';
    child.stdin = { on() {}, end(s) { input = s; seen = { exe, args, input }; setImmediate(() => { child.stdout.emit('data', 'QUJDREVGR0hJSktMTU5PUA=='); child.emit('close', 0); }); } };
    return child;
  };
  const r = await saveKey(FAKE, { dir, platform: 'win32', spawn, powershell: 'C:\\ps.exe' });
  assert.equal(r.ok, true);
  assert.equal(seen.input, FAKE);
  assert.equal(seen.args.join(' ').includes(FAKE), false);
  assert.equal(seen.args.at(-1), PS_PROTECT);
  const r2 = await saveKey(FAKE, { dir: tmp(), platform: 'linux' });
  assert.equal(r2.code, 'not_windows');
});
