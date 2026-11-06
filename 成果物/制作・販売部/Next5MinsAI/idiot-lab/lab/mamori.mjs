// 守りの部品(JavaScript / TypeScript 用)。社長専用。これから作るものに入れて使う。
// Node の標準の部品だけで作る(外から何も入れない)。このファイル1つをコピーすれば動く。
// 使い方は ../README.md。Python 版は ../py/mamori.py(同じ名前の部品が、同じ動きをする)。
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// 0. 断るときのエラー(status=返す番号・publicMessage=相手に見せてよい短い文)
// ---------------------------------------------------------------------------
export function httpError(status, publicMessage) {
  const e = new Error(publicMessage);
  e.status = status;
  e.publicMessage = publicMessage;
  return e;
}

// ---------------------------------------------------------------------------
// 1. 自分のPCの中だけで待ち受ける(家の Wi-Fi の他の機械からも届かない)
// ---------------------------------------------------------------------------
export function listenLocal(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
  });
}

// ---------------------------------------------------------------------------
// 2. 届いた頼みを確かめる(なりすまし・よそのサイトからの操作を断る)
//    よければ null。だめなら { status, reason }。
//    - 送り主がこのPCの中か(allowRemote=true のときは見ない。LANで使うときだけ。社長の許可を取ってから)
//    - あて先の名前(Host)が 127.0.0.1:番号 / localhost:番号 / hosts のどれかか(DNS をすり替える攻撃を断る)
//    - 中継の印(X-Forwarded-For など)が無いか(このPCの中の道具は、中継を通さない)
//    - 書きかえる頼み(POST など)は、出どころ(Origin)が自分と同じか。よそのページからの操作(CSRF)を断る
//    - 読む頼み(GET など)も、よそのサイトの中からの読み込みは断る(自分で開いた・同じ場所からの移動はよい)
// ---------------------------------------------------------------------------
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded',
  'via', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip', 'x-real-ip'];
const READ_METHODS = new Set(['GET', 'HEAD']);

export function isLoopback(req) {
  const a = String(req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

export function allowedHosts(port, hosts = []) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...hosts].map(h => String(h).toLowerCase()));
}

export function checkRequest(req, { port, hosts = [], allowRemote = false } = {}) {
  if (!Number.isInteger(port)) throw new Error('checkRequest には port(番号)が要る');
  if (!allowRemote && !isLoopback(req)) return { status: 403, reason: 'not local' };
  for (const h of PROXY_HEADERS) if (req.headers[h] !== undefined) return { status: 400, reason: 'proxy header' };
  const ok = allowedHosts(port, hosts);
  if (!ok.has(String(req.headers.host || '').toLowerCase())) return { status: 400, reason: 'bad host' };
  const site = req.headers['sec-fetch-site'];
  if (READ_METHODS.has(req.method)) {
    if (!site || site === 'same-origin' || site === 'none') return null;
    if (site === 'same-site' && req.headers['sec-fetch-mode'] === 'navigate') return null; // 同じPCの別の道具からのリンク
    return { status: 403, reason: 'cross site' };
  }
  let origin = null;
  try { const u = new URL(String(req.headers.origin)); if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.host.toLowerCase(); } catch { /* 無い・壊れている */ }
  if (!origin || !ok.has(origin)) return { status: 403, reason: 'bad origin' };
  if (site && site !== 'same-origin') return { status: 403, reason: 'cross site' };
  return null;
}

// ---------------------------------------------------------------------------
// 3. 返事につける守りの札(ブラウザに「よそのものを動かさない」と伝える)
//    csp を渡すと、画面の決まり(Content-Security-Policy)を変えられる。既定は、いちばん固い形。
// ---------------------------------------------------------------------------
export const DEFAULT_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function securityHeaders({ csp = DEFAULT_CSP } = {}) {
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
    'Cache-Control': 'no-store',
  };
}

export function setSecurityHeaders(res, opts) {
  for (const [k, v] of Object.entries(securityHeaders(opts))) res.setHeader(k, v);
}

export function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// ---------------------------------------------------------------------------
// 4. いちばん簡単な入れ方: 守りを全部つけたサーバーを作る
//    const server = await createLocalServer(async (req, res) => { ... }, { port: 8800 });
//    - このPCの中だけで待ち受ける・2の確かめ・3の札・遅い相手を待ちすぎない
//    - 中で起きたエラーは、相手には短い文だけ返す(中身は見せない)。記録には鍵を伏せて書く
// ---------------------------------------------------------------------------
//    secrets に、その道具が使う本物の鍵を渡すと、エラーの記録でも伏せる
export async function createLocalServer(handler, { port = 0, hosts = [], csp, secrets = [], log = console.error } = {}) {
  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res, { csp });
    const bad = checkRequest(req, { port: server.address().port, hosts });
    if (bad) return sendText(res, bad.status, bad.reason);
    try {
      await handler(req, res);
    } catch (e) {
      const status = Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 ? e.status : 500;
      if (status === 500) log('[守り] エラー: ' + redact(String(e?.stack || e), { secrets }));
      if (!res.headersSent) sendText(res, status, status === 500 ? 'server error' : String(e.publicMessage || 'bad request'));
      else res.destroy();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  return listenLocal(server, port);
}

// ---------------------------------------------------------------------------
// 5. 送られてきた中身を読む(大きさの上限つき)
// ---------------------------------------------------------------------------
export function readBody(req, { limit = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) return reject(httpError(413, 'too large'));
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(httpError(413, 'too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}

// JSON として読む。__proto__ などの「仕組みを書きかえる名前」は捨てる
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function parseJsonSafe(text) {
  try { return JSON.parse(text, (k, v) => (BAD_KEYS.has(k) ? undefined : v)); }
  catch { throw httpError(400, 'bad json'); }
}

export async function readJson(req, opts) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw httpError(415, 'need json');
  return parseJsonSafe(await readBody(req, opts));
}

// ---------------------------------------------------------------------------
// 6. ファイルの道を、決めたフォルダの外に出さない(「../../」で他のファイルを読ませない)
//    だめなら null。userPath は、URL なら1回だけ戻した(デコードした)もの。urlToFile を使うと楽。
// ---------------------------------------------------------------------------
const WIN_DEVICE = /^(con|prn|aux|nul|com[\d¹²³]|lpt[\d¹²³]|conin\$|conout\$)(\..*)?$/i;

export function safeJoin(root, userPath) {
  if (typeof userPath !== 'string' || /[\0:]/.test(userPath)) return null; // 「:」= ドライブ名・Windows の隠れた中身(ADS)
  const parts = userPath.replace(/\\/g, '/').split('/');
  for (const s of parts) {
    if (s === '' || s === '.' || s === '..') continue;
    if (WIN_DEVICE.test(s) || /[. ]$/.test(s)) return null; // Windows の特別な名前・末尾の点や空白(別名で同じファイルを指せる)
    if (s.startsWith('.') || s.includes('~')) return null; // .env・.git などの隠しファイル・短い別名(SECRET~1.JSO)
  }
  const base = path.resolve(root);
  const full = path.resolve(base, parts.filter(Boolean).join('/'));
  if (!inside(base, full)) return null;
  // 置き換えの印(シンボリックリンク)で外を指していないか。あるところまでの本当の場所で確かめる
  let realBase;
  try { realBase = fs.realpathSync.native(base); } catch { return full; }
  let probe = full;
  for (;;) {
    try { return inside(realBase, fs.realpathSync.native(probe)) ? full : null; }
    catch { const up = path.dirname(probe); if (up === probe) return null; probe = up; }
  }
}

function inside(base, p) {
  const rel = path.relative(base, p);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

export function urlToFile(root, reqUrl) {
  let p;
  try { p = decodeURIComponent(new URL(String(reqUrl), 'http://x').pathname); } catch { return null; }
  return safeJoin(root, p);
}

// ---------------------------------------------------------------------------
// 7. 鍵・合言葉を伏せる(記録・画面・エラーの文に出さない)
//    secrets に、その道具が使う本物の鍵を渡すと、それも伏せる(6文字以上)
// ---------------------------------------------------------------------------
const MASK = '[伏せた]';
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bya29\.[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\b(?:hf|npm)_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
];
const PAIR_PATTERNS = [
  /(\bauthorization\\?["']?\s*[:=]\s*\\?["']?)[^\r\n"'\\]+/gi, // Basic・Token などの形も、行の終わりまで伏せる
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /((?:api[_-]?key|apikey|token|secret|password|passwd|pwd|access[_-]?key|client[_-]?secret)\\?["']?\s*[:=]\s*\\?["']?)[^\s"'&,;\\]{4,}/gi,
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/gi, // https://名前:パスワード@
];

export function redact(text, { secrets = [] } = {}) {
  let s = String(text ?? '');
  for (const v of secrets) if (typeof v === 'string' && v.length >= 6) s = s.split(v).join(MASK);
  for (const re of SECRET_PATTERNS) s = s.replace(re, MASK);
  for (const re of PAIR_PATTERNS) s = s.replace(re, `$1${MASK}`);
  return s;
}

// ---------------------------------------------------------------------------
// 8. 画面に出す文字を安全にする(文字に混ぜたプログラムを動かさない)
// ---------------------------------------------------------------------------
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, c => HTML_ESC[c]);
}

// ---------------------------------------------------------------------------
// 9. CSV(Excel で開く表)の1マスを安全にする。「=」などで始まる文字を式として動かさない
//    数(-5 や 1.2)は、そのまま
// ---------------------------------------------------------------------------
export function csvCell(v) {
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  let s = String(v ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (/^[=+\-@\t\r＝＋－＠]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------------------------------------------------------------------------
// 10. 合言葉(トークン)を作る・くらべる(くらべる時間から中身を当てられないように)
// ---------------------------------------------------------------------------
export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// 11. ファイルを「全部書けたときだけ」置きかえる(途中で止まっても、こわれたファイルを残さない)
//     新しいファイルは本人だけが読める形(0600)。前からあるファイルは、その権限を写す(Windows はフォルダの権限)
// ---------------------------------------------------------------------------
export function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${newToken(6)}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.fchmodSync(fd, fs.statSync(file).mode & 0o777); } catch { /* 新しいファイル */ }
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* 閉じられない */ }
    try { fs.unlinkSync(tmp); } catch { /* もう無い */ }
    throw new Error(`保存できなかった(${path.basename(file)}): ${e.code || 'error'}。ほかのアプリで開いていたら閉じて、もう一度`);
  }
}

// ---------------------------------------------------------------------------
// 12. 回数の上限(短い時間に何度も来る頼みを断る)
//     const ok = rateLimiter({ max: 30, perMs: 60_000 }); if (!ok('login')) → 断る
// ---------------------------------------------------------------------------
export function rateLimiter({ max = 30, perMs = 60_000 } = {}) {
  const hits = new Map();
  return (key = 'all') => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < perMs);
    hits.delete(key); // 使った鍵を列の後ろへ(古いものから消すため)
    const ok = list.length < max;
    if (ok) list.push(now);
    hits.set(key, list);
    while (hits.size > 10_000) hits.delete(hits.keys().next().value);
    return ok;
  };
}

// ---------------------------------------------------------------------------
// 13. 外へつなぐときは、決めた行き先だけ(https だけ・転送はついて行かない・時間と大きさの上限)
//     hosts は 'api.example.com' のように書く(番号つきなら 'api.example.com:8443')
// ---------------------------------------------------------------------------
export function checkUrl(url, { hosts = [] } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return hosts.map(h => String(h).toLowerCase()).includes(u.host.toLowerCase()) ? u : null;
}

export async function safeFetch(url, { hosts, timeoutMs = 15_000, maxBytes = 10_000_000, ...init } = {}) {
  const u = checkUrl(url, { hosts });
  if (!u) throw new Error('行き先が、許可の一覧に無い(https だけ)');
  const res = await fetch(u, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const parts = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('返事が大きすぎる'); }
      parts.push(value);
    }
  }
  const text = Buffer.concat(parts).toString('utf8');
  return { ok: res.ok, status: res.status, headers: res.headers, text, json: () => parseJsonSafe(text) };
}
