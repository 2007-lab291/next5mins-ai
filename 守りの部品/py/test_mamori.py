"""守りの部品(Python)の自動テスト。動かし方: py -I -m unittest 守りの部品/py/test_mamori.py"""
import http.client
import io
import os
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stderr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mamori as m  # noqa: E402


class Handler(m.SafeHandler):
    def do_GET(self):
        if self.path == '/boom':
            raise RuntimeError('sk-ant-abcdefghijklmnop123 が漏れた')
        self.send_text(200, 'ok')

    def do_POST(self):
        self.send_text(200, str(self.read_json(limit=50)))


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = m.serve_local(Handler, 0)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def ask(self, method='GET', path='/', headers=None, body=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        h = {'Host': f'127.0.0.1:{self.port}', **(headers or {})}
        if body is not None:
            h.setdefault('Content-Length', str(len(body)))
        for k, v in h.items():
            c.putheader(k, v)
        c.endheaders(body.encode() if body is not None else None)
        r = c.getresponse()
        out = (r.status, dict((k.lower(), v) for k, v in r.getheaders()), r.read().decode())
        c.close()
        return out

    def test_guards(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        st, h, t = self.ask()
        self.assertEqual((st, t), (200, 'ok'))
        self.assertIn("default-src 'self'", h['content-security-policy'])
        self.assertEqual(self.ask(headers={'Host': 'evil.example'})[0], 400)
        self.assertEqual(self.ask(headers={'X-Forwarded-For': '1.2.3.4'})[0], 400)
        self.assertEqual(self.ask(headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.ask(headers={'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'navigate'})[0], 200)

        j = {'Content-Type': 'application/json'}
        self.assertEqual(self.ask('POST', headers=j, body='{"a":1}')[0], 403)
        self.assertEqual(self.ask('POST', headers={**j, 'Origin': 'http://evil.example'}, body='{"a":1}')[0], 403)
        own = {**j, 'Origin': f'http://localhost:{self.port}'}
        self.assertEqual(self.ask('POST', headers=own, body='{"a":1}')[:3:2], (200, "{'a': 1}"))
        self.assertEqual(self.ask('POST', headers=own, body='x' * 100)[0], 413)
        self.assertEqual(self.ask('POST', headers=own, body='{bad')[0], 400)
        self.assertEqual(self.ask('POST', headers=own, body='NaN')[0], 400)
        self.assertEqual(self.ask('POST', headers={**own, 'Content-Type': 'text/plain'}, body='{}')[0], 415)

        err = io.StringIO()
        with redirect_stderr(err):
            st, _, t = self.ask(path='/boom')
        self.assertEqual((st, t), (500, 'server error'))
        self.assertIn('[伏せた]', err.getvalue())
        self.assertNotIn('sk-ant-abc', err.getvalue())

    def test_keep_alive_wraps_once(self):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        for _ in range(3):
            c.request('GET', '/', headers={'Host': f'127.0.0.1:{self.port}'})
            r = c.getresponse()
            self.assertEqual(r.status, 200)
            r.read()
        c.close()


class PartsTest(unittest.TestCase):
    def test_check_request_remote(self):
        h = {'Host': '127.0.0.1:80'}
        self.assertEqual(m.check_request('GET', h, '192.168.1.5', 80), (403, 'not local'))
        self.assertIsNone(m.check_request('GET', h, '192.168.1.5', 80, allow_remote=True))
        self.assertTrue(m.is_loopback('::ffff:127.0.0.1'))

    def test_safe_join(self):
        with tempfile.TemporaryDirectory() as root:
            os.mkdir(os.path.join(root, 'css'))
            self.assertEqual(m.safe_join(root, '/css/a.css'), os.path.join(os.path.abspath(root), 'css', 'a.css'))
            for bad in ['../x', '..\\x', '/../../etc/passwd', 'C:/Windows/win.ini', 'a\0b', 'secret.txt::$DATA',
                        'NUL', 'con.txt', 'a.txt.', 'a.txt ', 'css/../../x', '.env', 'a/.git/config', 'SECRET~1.JSO',
                        'CONIN$', 'COM¹']:
                self.assertIsNone(m.safe_join(root, bad), bad)
            self.assertEqual(m.url_to_file(root, '/%2e%2e/%2e%2e/x'), os.path.join(os.path.abspath(root), 'x'))
            self.assertIsNone(m.url_to_file(root, '/..%5c..%5cx'))
            self.assertIsNone(m.url_to_file(root, '/%E0%A4%A'))
            self.assertEqual(m.url_to_file(root, '/css/a%20b.css?x=1'), os.path.join(os.path.abspath(root), 'css', 'a b.css'))

    def test_redact(self):
        s = m.redact('k=sk-ant-api03-AAAAAAAAAAAAAAAA x sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB Authorization: Bearer abcdefghij\n'
                     '?api_key=12345678&q=1 ghp_CCCCCCCCCCCCCCCCCCCCCCCC AKIAABCDEFGHIJKLMNOP "password": "hunter22"')
        for leak in ['sk-ant-api03', 'BBBBBBBB', 'abcdefghij', '12345678', 'ghp_', 'AKIAABCD', 'hunter22']:
            self.assertNotIn(leak, s)
        self.assertIn('q=1', s)
        s2 = m.redact('Authorization: Basic dXNlcjpwYXNz\n{\\"api_key\\":\\"abc12345\\"} ASIAABCDEFGHIJKLMNOP sk_live_abcdefghijkl '
                      'hf_ABCDEFGHIJKLMNOPQRSTU glpat-ABCDEFGHIJKLMNOPQRST https://me:pass1234@example.com/x')
        for leak in ['dXNlcjpwYXNz', 'abc12345', 'ASIAABCD', 'sk_live_a', 'hf_ABC', 'glpat-ABC', 'pass1234']:
            self.assertNotIn(leak, s2)
        self.assertIn('@example.com/x', s2)
        self.assertEqual(m.redact('私の鍵は my-own-secret です', secrets=['my-own-secret']), '私の鍵は [伏せた] です')

    def test_escape_and_csv(self):
        self.assertEqual(m.escape_html('<a href="x">\'`&'), '&lt;a href=&quot;x&quot;&gt;&#x27;&#96;&amp;')
        self.assertEqual(m.csv_cell('=1+1'), "'=1+1")
        self.assertEqual(m.csv_cell('＝HYPERLINK("x")'), '"\'＝HYPERLINK(""x"")"')
        self.assertEqual(m.csv_cell('-5.2'), '-5.2')
        self.assertEqual(m.csv_cell(-3), '-3')
        self.assertEqual(m.csv_cell('a\x07b'), 'ab')
        self.assertEqual(m.csv_cell(None), '')

    def test_token_file_rate_url(self):
        t = m.new_token()
        self.assertTrue(m.same_token(t, t))
        self.assertFalse(m.same_token(t, t + 'x'))
        self.assertFalse(m.same_token(None, None))
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, 'a.json')
            m.write_file_atomic(f, '1')
            m.write_file_atomic(f, '2')
            with open(f, encoding='utf-8') as fh:
                self.assertEqual(fh.read(), '2')
            self.assertEqual(os.listdir(d), ['a.json'])
        ok = m.RateLimiter(max=2, per_sec=60)
        self.assertEqual([ok('a'), ok('a'), ok('a'), ok('b')], [True, True, False, True])
        ok2 = m.RateLimiter(max=1, per_sec=60)
        ok2('login')
        for i in range(10_001):
            ok2(f'x{i}')
        ok2('login')
        for i in range(9_000):
            ok2(f'y{i}')
        self.assertFalse(ok2('login'))
        hosts = ['api.example.com']
        self.assertTrue(m.check_url('https://api.example.com/v1?x=1', hosts))
        for bad in ['http://api.example.com/', 'https://evil.com/', 'https://api.example.com.evil.com/',
                    'https://u:p@api.example.com/', 'https://api.example.com:444/', 'https://api.example.com\\@evil.com/', 'nonsense']:
            self.assertIsNone(m.check_url(bad, hosts), bad)
        with self.assertRaises(ValueError):
            m.safe_fetch('https://evil.example/', ['api.example.com'])


if __name__ == '__main__':
    unittest.main()
