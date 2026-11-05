"""守りの部品(Python 用)。社長専用。これから作るものに入れて使う。

Python の標準の部品だけで作る(外から何も入れない)。このファイル1つをコピーすれば動く。
使い方は ../README.md。JS 版は ../js/mamori.mjs(同じ名前の部品が、同じ動きをする)。
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import secrets as _secrets
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ---------------------------------------------------------------------------
# 0. 断るときのエラー(status=返す番号・public_message=相手に見せてよい短い文)
# ---------------------------------------------------------------------------
class HttpError(Exception):
    def __init__(self, status: int, public_message: str):
        super().__init__(public_message)
        self.status = status
        self.public_message = public_message


# ---------------------------------------------------------------------------
# 2. 届いた頼みを確かめる(なりすまし・よそのサイトからの操作を断る)。JS 版の checkRequest と同じ
#    よければ None。だめなら (番号, 理由)。
#    allow_remote=True は LAN で使うときだけ(社長の許可を取ってから)
# ---------------------------------------------------------------------------
PROXY_HEADERS = ('x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded',
                 'via', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip', 'x-real-ip')
READ_METHODS = ('GET', 'HEAD')
_ONE_ONLY = ('host', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'content-type', 'content-length')


def is_loopback(client_ip: str) -> bool:
    a = re.sub(r'^::ffff:', '', str(client_ip or ''), flags=re.I)
    return a == '::1' or re.fullmatch(r'127\.\d{1,3}\.\d{1,3}\.\d{1,3}', a) is not None


def allowed_hosts(port: int, hosts=()) -> set:
    return {h.lower() for h in (f'127.0.0.1:{port}', f'localhost:{port}', *hosts)}


def check_request(method: str, headers, client_ip: str, port: int, hosts=(), allow_remote=False):
    items = [(str(k).lower(), str(v)) for k, v in headers.items()]
    h = dict(items)
    for name in _ONE_ONLY:  # 同じ札が2枚あると、読む側でずれる。断る
        if sum(1 for k, _ in items if k == name) > 1:
            return (400, 'duplicate header')
    if not allow_remote and not is_loopback(client_ip):
        return (403, 'not local')
    if any(p in h for p in PROXY_HEADERS):
        return (400, 'proxy header')
    ok = allowed_hosts(port, hosts)
    if h.get('host', '').lower() not in ok:
        return (400, 'bad host')
    site = h.get('sec-fetch-site')
    if method in READ_METHODS:
        if not site or site in ('same-origin', 'none'):
            return None
        if site == 'same-site' and h.get('sec-fetch-mode') == 'navigate':  # 同じPCの別の道具からのリンク
            return None
        return (403, 'cross site')
    origin = None
    try:
        u = urllib.parse.urlsplit(h.get('origin', ''))
        if u.scheme in ('http', 'https') and u.hostname:
            origin = f'{u.hostname}:{u.port}' if u.port else u.hostname
    except ValueError:
        pass
    if not origin or origin.lower() not in ok:
        return (403, 'bad origin')
    if site and site != 'same-origin':
        return (403, 'cross site')
    return None


# ---------------------------------------------------------------------------
# 3. 返事につける守りの札。csp を渡すと、画面の決まりを変えられる。既定は、いちばん固い形
# ---------------------------------------------------------------------------
DEFAULT_CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
               "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")


def security_headers(csp: str | None = None) -> dict:
    return {
        'Content-Security-Policy': csp or DEFAULT_CSP,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
        'Cache-Control': 'no-store',
    }


# ---------------------------------------------------------------------------
# 1・4. いちばん簡単な入れ方: SafeHandler を元にして、serve_local で動かす
#    class MyHandler(SafeHandler):
#        def do_GET(self): self.send_text(200, 'ok')
#    server = serve_local(MyHandler, 8800); server.serve_forever()
#    - このPCの中だけで待ち受ける・2の確かめ・3の札・遅い相手を待ちすぎない
#    - do_XXX の中で HttpError を投げると、その番号と短い文を返す。ほかのエラーは 'server error' だけ返し、
#      記録には鍵を伏せて書く
# ---------------------------------------------------------------------------
#    - protocol_version は上げない(HTTP/1.0 のまま。1回ごとに切る)。断ったときも、つなぎ目を切る
#    - secrets に、その道具が使う本物の鍵を入れると、エラーの記録でも伏せる
class SafeHandler(BaseHTTPRequestHandler):
    hosts: tuple = ()
    csp: str | None = None
    secrets: tuple = ()
    timeout = 30
    server_version = 'local'
    sys_version = ''

    def parse_request(self):
        if not super().parse_request():
            return False
        bad = check_request(self.command, self.headers, self.client_address[0], self.server.server_address[1], self.hosts)
        if bad:
            self.close_connection = True  # 読んでいない中身が「次の頼み」として読まれないように
            self.send_text(*bad)
            return False
        name = 'do_' + self.command
        if hasattr(type(self), name):  # do_XXX をエラーの受け止めで包む(つなぎっぱなしで何度来ても、包むのは1回)
            fn = getattr(type(self), name).__get__(self)
            setattr(self, name, lambda: self._guarded(fn))
        return True

    def _guarded(self, fn):
        try:
            fn()
        except HttpError as e:
            self.close_connection = True
            self.send_text(e.status if 400 <= e.status < 500 else 500, e.public_message if 400 <= e.status < 500 else 'server error')
        except Exception as e:  # noqa: BLE001  中身は相手に見せない
            self.close_connection = True
            sys.stderr.write('[守り] エラー: ' + redact(f'{type(e).__name__}: {e}', self.secrets) + '\n')
            try:
                self.send_text(500, 'server error')
            except OSError:
                pass

    def end_headers(self):
        for k, v in security_headers(self.csp).items():
            self.send_header(k, v)
        super().end_headers()

    def send_text(self, status: int, text: str):
        body = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def log_message(self, format, *args):  # 記録にも鍵を出さない
        sys.stderr.write(redact('%s - %s\n' % (self.address_string(), format % args), self.secrets))

    def read_body(self, limit: int = 1_000_000) -> bytes:
        return read_body(self, limit)

    def read_json(self, limit: int = 1_000_000):
        return read_json(self, limit)


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):  # 中の詳しいエラー(鍵が入ることがある)を、伏せて書く
        e = sys.exc_info()[1]
        sys.stderr.write('[守り] エラー: ' + redact(f'{type(e).__name__}: {e}', getattr(self.RequestHandlerClass, 'secrets', ())) + '\n')


def serve_local(handler_cls, port: int = 0) -> LocalServer:
    return LocalServer(('127.0.0.1', port), handler_cls)


# ---------------------------------------------------------------------------
# 5. 送られてきた中身を読む(大きさの上限つき)
# ---------------------------------------------------------------------------
def read_body(handler: BaseHTTPRequestHandler, limit: int = 1_000_000) -> bytes:
    if handler.headers.get('Transfer-Encoding'):
        raise HttpError(411, 'need length')
    raw = handler.headers.get('Content-Length')
    if raw is None:
        raise HttpError(411, 'need length')
    try:
        n = int(raw)
    except ValueError:
        raise HttpError(400, 'bad length') from None
    if n < 0:
        raise HttpError(400, 'bad length')
    if n > limit:
        raise HttpError(413, 'too large')
    return handler.rfile.read(n)


def _no_constant(_):
    raise ValueError('NaN/Infinity')


def parse_json_safe(text):
    try:
        return json.loads(text, parse_constant=_no_constant)
    except (ValueError, RecursionError, UnicodeDecodeError):
        raise HttpError(400, 'bad json') from None


def read_json(handler: BaseHTTPRequestHandler, limit: int = 1_000_000):
    if not re.match(r'application/json\b', handler.headers.get('Content-Type', ''), re.I):
        raise HttpError(415, 'need json')
    return parse_json_safe(read_body(handler, limit))


# ---------------------------------------------------------------------------
# 6. ファイルの道を、決めたフォルダの外に出さない。だめなら None
# ---------------------------------------------------------------------------
_WIN_DEVICE = re.compile(r'^(con|prn|aux|nul|com[\d¹²³]|lpt[\d¹²³]|conin\$|conout\$)(\..*)?$', re.I)


def safe_join(root: str, user_path: str):
    if not isinstance(user_path, str) or '\0' in user_path or ':' in user_path:
        return None
    parts = user_path.replace('\\', '/').split('/')
    for s in parts:
        if s in ('', '.', '..'):
            continue
        if _WIN_DEVICE.match(s) or s.endswith(('.', ' ')):
            return None
        if s.startswith('.') or '~' in s:  # .env・.git などの隠しファイル・短い別名(SECRET~1.JSO)
            return None
    base = os.path.abspath(root)
    full = os.path.normpath(os.path.join(base, *[p for p in parts if p]))
    if not _inside(base, full):
        return None
    # 置き換えの印(シンボリックリンク)で外を指していないか。本当の場所で確かめる
    if not _inside(os.path.realpath(base), os.path.realpath(full)):
        return None
    return full


def _inside(base: str, p: str) -> bool:
    try:
        return os.path.commonpath([os.path.normcase(base), os.path.normcase(p)]) == os.path.normcase(base)
    except ValueError:  # ドライブがちがう
        return False


def url_to_file(root: str, req_path: str):
    path = urllib.parse.urlsplit(str(req_path)).path
    try:
        p = urllib.parse.unquote(path, errors='strict')
    except UnicodeDecodeError:
        return None
    # JS 版(URL の決まり)とそろえる: 「..」は道の上で消す
    out = []
    for s in p.split('/'):
        if s == '..':
            if out:
                out.pop()
        elif s not in ('', '.'):
            out.append(s)
    return safe_join(root, '/'.join(out))


# ---------------------------------------------------------------------------
# 7. 鍵・合言葉を伏せる。secrets に本物の鍵を渡すと、それも伏せる(6文字以上)
# ---------------------------------------------------------------------------
MASK = '[伏せた]'
_SECRET_PATTERNS = [
    re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'),
    re.compile(r'\bsk-ant-[A-Za-z0-9_-]{10,}'),
    re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}'),
    re.compile(r'\bgh[pousr]_[A-Za-z0-9]{20,}'),
    re.compile(r'\bgithub_pat_[A-Za-z0-9_]{20,}'),
    re.compile(r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'),
    re.compile(r'\bAIza[0-9A-Za-z_-]{30,}'),
    re.compile(r'\bya29\.[A-Za-z0-9_-]{20,}'),
    re.compile(r'\bxox[abprs]-[A-Za-z0-9-]{10,}'),
    re.compile(r'\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}'),
    re.compile(r'\b(?:hf|npm)_[A-Za-z0-9]{20,}'),
    re.compile(r'\bglpat-[A-Za-z0-9_-]{20,}'),
    re.compile(r'\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}'),
]
_PAIR_PATTERNS = [
    re.compile(r'''(\bauthorization\\?["']?\s*[:=]\s*\\?["']?)[^\r\n"'\\]+''', re.I),  # Basic・Token などの形も、行の終わりまで伏せる
    re.compile(r'(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}', re.I),
    re.compile(r'''((?:api[_-]?key|apikey|token|secret|password|passwd|pwd|access[_-]?key|client[_-]?secret)\\?["']?\s*[:=]\s*\\?["']?)[^\s"'&,;\\]{4,}''', re.I),
    re.compile(r'(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+(?=@)', re.I),  # https://名前:パスワード@
]


def redact(text, secrets=()) -> str:
    s = '' if text is None else str(text)
    for v in secrets:
        if isinstance(v, str) and len(v) >= 6:
            s = s.replace(v, MASK)
    for r in _SECRET_PATTERNS:
        s = r.sub(MASK, s)
    for r in _PAIR_PATTERNS:
        s = r.sub(lambda m: m.group(1) + MASK, s)
    return s


# ---------------------------------------------------------------------------
# 8. 画面に出す文字を安全にする
# ---------------------------------------------------------------------------
def escape_html(v) -> str:
    return html.escape('' if v is None else str(v), quote=True).replace('`', '&#96;')


# ---------------------------------------------------------------------------
# 9. CSV の1マスを安全にする。「=」などで始まる文字を式として動かさない。数はそのまま
# ---------------------------------------------------------------------------
_CTRL = re.compile(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')


def csv_cell(v) -> str:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    s = _CTRL.sub('', '' if v is None else str(v))
    if re.match(r'[=+\-@\t\r＝＋－＠]', s) and not re.fullmatch(r'[-+]?\d+(\.\d+)?', s):
        s = "'" + s
    if re.search(r'[",\r\n]', s):
        s = '"' + s.replace('"', '""') + '"'
    return s


# ---------------------------------------------------------------------------
# 10. 合言葉(トークン)を作る・くらべる
# ---------------------------------------------------------------------------
def new_token(nbytes: int = 32) -> str:
    return _secrets.token_urlsafe(nbytes)


def same_token(a, b) -> bool:
    if not isinstance(a, str) or not isinstance(b, str) or not a or not b:
        return False
    return hmac.compare_digest(hashlib.sha256(a.encode()).digest(), hashlib.sha256(b.encode()).digest())


# ---------------------------------------------------------------------------
# 11. ファイルを「全部書けたときだけ」置きかえる
# ---------------------------------------------------------------------------
def write_file_atomic(path: str, data, encoding: str = 'utf-8') -> None:
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=os.path.basename(path) + '.', suffix='.tmp', dir=d)
    try:
        try:  # 前からあるファイルは、その権限を写す(新しいファイルは本人だけが読める 0600 のまま)
            os.chmod(tmp, os.stat(path).st_mode & 0o777)
        except OSError:
            pass
        with os.fdopen(fd, 'wb') as f:
            f.write(data.encode(encoding) if isinstance(data, str) else data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise OSError(f'保存できなかった({os.path.basename(path)}): {e.__class__.__name__}。ほかのアプリで開いていたら閉じて、もう一度') from None


# ---------------------------------------------------------------------------
# 12. 回数の上限。ok = RateLimiter(max=30, per_sec=60); if not ok('login'): 断る
# ---------------------------------------------------------------------------
class RateLimiter:
    def __init__(self, max: int = 30, per_sec: float = 60):
        self.max, self.per = max, per_sec
        self.hits: dict = {}
        self.lock = threading.Lock()

    def __call__(self, key: str = 'all') -> bool:
        now = time.monotonic()
        with self.lock:
            lst = [t for t in self.hits.pop(key, []) if now - t < self.per]  # 使った鍵を後ろへ(古いものから消すため)
            ok = len(lst) < self.max
            if ok:
                lst.append(now)
            self.hits[key] = lst
            while len(self.hits) > 10_000:
                self.hits.pop(next(iter(self.hits)))
            return ok


# ---------------------------------------------------------------------------
# 13. 外へつなぐときは、決めた行き先だけ(https だけ・転送はついて行かない・時間と大きさの上限)
#     hosts は 'api.example.com' のように書く(番号つきなら 'api.example.com:8443')
# ---------------------------------------------------------------------------
def check_url(url, hosts=()):
    s = str(url)
    if re.search(r'[\s\\\x00-\x1f]', s):
        return None
    try:
        u = urllib.parse.urlsplit(s)
        port = u.port
    except ValueError:
        return None
    if u.scheme != 'https' or u.username or u.password or not u.hostname:
        return None
    host = f'{u.hostname}:{port}' if port and port != 443 else u.hostname
    return u if host.lower() in {h.lower() for h in hosts} else None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise urllib.error.URLError('転送(リダイレクト)には、ついて行かない')


_OPENER = urllib.request.build_opener(_NoRedirect)


def safe_fetch(url, hosts, method='GET', headers=None, data=None, timeout=15, max_bytes=10_000_000) -> dict:
    if not check_url(url, hosts):
        raise ValueError('行き先が、許可の一覧に無い(https だけ)')
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    deadline = time.monotonic() + timeout  # 全体の締め切り(少しずつ返す相手を、ずっと待たない)
    try:
        res = _OPENER.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:  # 4xx・5xx も、中身を読んで返す
        res = e
    with res:
        parts, size = [], 0
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError('返事が遅すぎる')
            chunk = res.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise ValueError('返事が大きすぎる')
            parts.append(chunk)
        body = b''.join(parts)
        text = body.decode('utf-8', errors='replace')
        return {'ok': 200 <= res.status < 300, 'status': res.status, 'headers': dict(res.headers), 'text': text,
                'json': lambda: parse_json_safe(text)}
