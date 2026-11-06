// バカ工房の鍵の暗号化保存(2026-11-06)。社長の指示「鍵はパソコンが動いている間だけでなくずっと持ってほしい」(決定事項 N5 2026-11-06 / 2)。
//   作り方は、ideaAI のデモサイトの鍵の保存(同じ社長の決めごと。Windows の DPAPI)にならった。外の部品は使わない。
//
//   口(どれも、鍵の中身を、画面・記録・エラーの文に出さない。失敗は、固定の文の { ok:false, code, text } で返す。例外は投げない):
//     saveKey(key, deps?)  -> Promise<{ ok:true, savedAt } | { ok:false, code, text }>   暗号化して保存する(あれば置き換える)
//     loadKey(deps?)       -> Promise<{ ok:true, key, savedAt } | { ok:false, code, text }>   読んで復号する(key は、AIを呼ぶのにだけ使う)
//     deleteKey(deps?)     -> { ok:true, existed } | { ok:false, code, text }              保存した鍵のファイルを消す(あれば)
//     keyInfo(deps?)       -> { exists, savedAt? }                                         ファイルの形が正しければ exists:true(復号はしない)
//
//   保存先: %LOCALAPPDATA%\Next5MinsAI\idiot-lab-key\key.dat(会社のフォルダの外。記録と下書きの置き場 idiot-lab\ とは別のフォルダ)。
//   中身(JSON): { v:1, savedAt, blob } だけ。鍵の一部も長さも書かない。8KB まで。リンクは追わない。形が違えば「保存した鍵はない」扱い。
//   暗号化: Windows の DPAPI(CurrentUser。同じ Windows の利用者だけが復号できる)を PowerShell で行う。
//     鍵は PowerShell の標準入力で渡す(引数・環境変数・一時ファイル・画面には出さない)。PowerShell の標準エラーは読み捨てる。
//     Windows 以外・PowerShell なし・失敗のときは、保存しない(今回貼った鍵だけで動く)。
//   deps(試験用の差し込み口): { dir, localAppData, platform, protect, unprotect, spawn, powershell, systemRoot, timeoutMs, now }
//     protect・unprotect を渡すと、PowerShell は使わない(試験は、にせの暗号化を渡す)。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';

export const FOLDER = ['Next5MinsAI', 'idiot-lab-key'];
export const FILE_NAME = 'key.dat';
export const MAX_FILE_BYTES = 8 * 1024;
const MIN_BLOB_CHARS = 16;
const MAX_BLOB_CHARS = 4096;
const MAX_PS_OUT_CHARS = 8192;
const PS_TIMEOUT_MS = 20000;
const BLOB_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{13,}$/;   // Anthropic の鍵の形(「sk-ant-」で始まり、20文字以上)

// 鍵の形か(形が違うものは、保存しない・使わない)
export const keyShapeOk = k => typeof k === 'string' && k.length <= 1000 && KEY_RE.test(k);

// 固定の文(鍵・道・PowerShell の文は入れない)
export const KEY_STORE_TEXT = Object.freeze({
  no_key: '保存した鍵はありません。',
  no_dir: '鍵の保存先(LOCALAPPDATA)が分かりません。保存しませんでした。',
  bad_dir: '鍵の保存先が、安全な場所ではありません(ネットワークの共有・リポジトリの中・試験中の本物の保存先)。保存も消去もしませんでした。',
  not_windows: 'この PC では鍵を保存できません(Windows だけです)。保存しませんでした。',
  no_powershell: 'PowerShell が使えないので、鍵を保存できません。保存しませんでした。',
  bad_key: '「sk-ant-」で始まる鍵の形ではありません。保存しませんでした。',
  encrypt_failed: '鍵を暗号化できませんでした。保存しませんでした。',
  write_failed: '鍵のファイルを書けませんでした。保存しませんでした。',
  decrypt_failed: '保存した鍵を読めませんでした(別の Windows の利用者で保存した鍵か、壊れています)。',
  delete_failed: '保存した鍵のファイルを消せませんでした。',
});

class StoreFail extends Error {
  constructor(code) { super(code); this.name = 'StoreFail'; this.code = code; } // 文は符号だけ
}
const fail = code => ({ ok: false, code, text: KEY_STORE_TEXT[code] || KEY_STORE_TEXT.encrypt_failed });
const codeOf = (err, fallback) => (err instanceof StoreFail && Object.hasOwn(KEY_STORE_TEXT, err.code) ? err.code : fallback);

// ---------------- 保存先 ----------------
const UNC_RE = /^[\\/]{2}/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 断る場所: このリポジトリ(と、その上の .git のある所)の中
const REPO_ROOTS = (() => {
  const roots = [path.resolve(HERE, '..', '..', '..', '..', '..')]; // lab → idiot-lab → Next5MinsAI → 制作・販売部 → 成果物 → リポジトリ
  try {
    for (let d = HERE, i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(d, '.git'))) { roots.push(d); break; }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  } catch { /* 探せなければ、上の固定の場所だけ */ }
  return roots;
})();
const isInside = (child, root) => {
  const rel = path.relative(root, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};
function locate(deps) {
  let dir;
  if (typeof deps.dir === 'string' && deps.dir !== '') {
    dir = deps.dir; // 試験用: 一時フォルダ
  } else {
    const isDefault = deps.localAppData === undefined;
    const base = isDefault ? process.env.LOCALAPPDATA : deps.localAppData; // 読むだけ
    if (typeof base !== 'string' || base === '' || !path.isAbsolute(base)) return { code: 'no_dir' };
    if (UNC_RE.test(base)) return { code: 'bad_dir' };
    // 二重の守り: node の試験の中では、一時フォルダの下でない本物の保存先に触れない
    if (isDefault && process.env.NODE_TEST_CONTEXT && !isInside(path.resolve(base), path.resolve(os.tmpdir()))) return { code: 'bad_dir' };
    dir = path.join(base, ...FOLDER);
  }
  if (UNC_RE.test(dir)) return { code: 'bad_dir' };
  const abs = path.resolve(dir);
  if (UNC_RE.test(abs) || REPO_ROOTS.some(root => isInside(abs, root))) return { code: 'bad_dir' };
  return { dir: abs };
}
export function resolveDir(deps = {}) { return locate(deps).dir || null; }

// 画面に出す「保存した日時」(この PC の時刻。分まで)
export function formatSavedAt(iso) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------- 暗号化(DPAPI を PowerShell で) ----------------
// スクリプトは固定(鍵は入らない)。鍵・暗号化した塊は、標準入力から読む。
const PS_HEAD = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd().Trim();";
export const PS_PROTECT = PS_HEAD
  + '$b=[System.Text.Encoding]::UTF8.GetBytes($s);'
  + '$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);'
  + '[Console]::Out.Write([Convert]::ToBase64String($p))';
export const PS_UNPROTECT = PS_HEAD
  + '$b=[Convert]::FromBase64String($s);'
  + '$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);'
  + '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($p))';

// PowerShell は %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe の1か所だけ(名前だけで探さない=今いるフォルダや PATH の偽物を起こさない)
export function powershellPath(deps = {}) {
  const root = deps.systemRoot !== undefined ? deps.systemRoot : process.env.SystemRoot;
  if (typeof root !== 'string' || root === '' || !path.isAbsolute(root) || UNC_RE.test(root)) return null;
  const p = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
}

function runPowerShell({ script, input, deps }) {
  return new Promise((resolve, reject) => {
    const platform = deps.platform || process.platform;
    if (platform !== 'win32') { reject(new StoreFail('not_windows')); return; }
    const spawn = deps.spawn || nodeSpawn;
    const exe = deps.powershell || powershellPath(deps);
    if (!exe) { reject(new StoreFail('no_powershell')); return; }
    let child;
    try {
      child = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch { reject(new StoreFail('no_powershell')); return; }
    let out = '';
    let done = false;
    let timer = null;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); if (err) reject(err); else resolve(value); };
    const kill = () => { try { child.kill(); } catch { /* もう終わっている */ } };
    timer = setTimeout(() => { kill(); finish(new StoreFail('encrypt_failed')); }, Number.isFinite(deps.timeoutMs) ? deps.timeoutMs : PS_TIMEOUT_MS);
    child.on('error', () => finish(new StoreFail('no_powershell')));
    child.stdout.on('data', d => { out += d; if (out.length > MAX_PS_OUT_CHARS) { kill(); finish(new StoreFail('encrypt_failed')); } });
    child.stderr.on('data', () => { /* 読み捨てる */ });
    child.on('close', code => { if (code === 0) finish(null, out); else finish(new StoreFail('encrypt_failed')); });
    child.stdin.on('error', () => { /* 先に終わった。close で失敗として扱う */ });
    child.stdin.end(input);
  });
}
const dpapi = deps => ({
  protect: async plain => String(await runPowerShell({ script: PS_PROTECT, input: plain, deps })).trim(),
  unprotect: async blob => String(await runPowerShell({ script: PS_UNPROTECT, input: blob, deps })),
});

const blobOk = b => typeof b === 'string' && b.length >= MIN_BLOB_CHARS && b.length <= MAX_BLOB_CHARS && b.length % 4 === 0 && BLOB_RE.test(b);

// ---------------- ファイル ----------------
const isLink = p => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

function readStored(dir) {
  const file = path.join(dir, FILE_NAME);
  try {
    if (isLink(dir)) return null;
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size === 0 || st.size > MAX_FILE_BYTES) return null;
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
    if (Object.keys(o).sort().join(',') !== 'blob,savedAt,v' || o.v !== 1) return null;
    if (typeof o.savedAt !== 'string' || !ISO_RE.test(o.savedAt) || Number.isNaN(new Date(o.savedAt).getTime())) return null;
    if (!blobOk(o.blob)) return null;
    return { savedAt: o.savedAt, blob: o.blob };
  } catch {
    return null;
  }
}

export function keyInfo(deps = {}) {
  const dir = resolveDir(deps);
  if (!dir) return { exists: false };
  const rec = readStored(dir);
  return rec ? { exists: true, savedAt: rec.savedAt } : { exists: false };
}

export async function saveKey(key, deps = {}) {
  const loc = locate(deps);
  if (!loc.dir) return fail(loc.code);
  if (!keyShapeOk(key)) return fail('bad_key');
  let blob;
  try {
    blob = await (typeof deps.protect === 'function' ? deps.protect : dpapi(deps).protect)(key);
  } catch (err) {
    return fail(codeOf(err, 'encrypt_failed'));
  }
  // 塊の形が違う・鍵がそのまま入っている(暗号化になっていない)ときは、書かない
  if (!blobOk(blob) || blob.includes(key) || Buffer.from(blob, 'base64').includes(Buffer.from(key, 'utf8'))) return fail('encrypt_failed');
  const savedAt = new Date(typeof deps.now === 'function' ? deps.now() : Date.now()).toISOString();
  const body = JSON.stringify({ v: 1, savedAt, blob }) + '\n';
  const file = path.join(loc.dir, FILE_NAME);
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(loc.dir, { recursive: true });
    if (isLink(loc.dir) || isLink(file) || isLink(tmp)) return fail('write_failed'); // リンクは追わない
    try { fs.unlinkSync(tmp); } catch { /* 前の書きかけが無ければよい */ }
    fs.writeFileSync(tmp, body, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* 無ければよい */ }
    return fail('write_failed');
  }
  return { ok: true, savedAt };
}

export async function loadKey(deps = {}) {
  const loc = locate(deps);
  if (!loc.dir) return fail(loc.code === 'bad_dir' ? 'bad_dir' : 'no_key');
  const rec = readStored(loc.dir);
  if (!rec) return fail('no_key');
  let plain;
  try {
    plain = await (typeof deps.unprotect === 'function' ? deps.unprotect : dpapi(deps).unprotect)(rec.blob);
  } catch (err) {
    return fail(err instanceof StoreFail && (err.code === 'not_windows' || err.code === 'no_powershell') ? err.code : 'decrypt_failed');
  }
  const key = typeof plain === 'string' ? plain.trim() : '';
  if (!keyShapeOk(key)) return fail('decrypt_failed');
  return { ok: true, key, savedAt: rec.savedAt };
}

export function deleteKey(deps = {}) {
  const loc = locate(deps);
  if (!loc.dir) return loc.code === 'bad_dir' ? fail('bad_dir') : { ok: true, existed: false };
  if (isLink(loc.dir)) return fail('delete_failed'); // リンクの先は消さない
  const file = path.join(loc.dir, FILE_NAME);
  try { fs.unlinkSync(file + '.tmp'); } catch { /* 書きかけが無ければよい */ }
  let st;
  try { st = fs.lstatSync(file); } catch { st = null; }
  if (!st) return { ok: true, existed: false };
  if (st.isDirectory()) return fail('delete_failed');
  try { fs.unlinkSync(file); } catch { return fail('delete_failed'); }
  try { fs.rmdirSync(loc.dir); } catch { /* 空でなければ残す */ }
  return { ok: true, existed: true };
}
