// パーツ1の予行用「試しの操作」。本番の index.html では読まない。
(function () {
  'use strict';
  const N5 = window.N5;
  const host = document.getElementById('n5-preview');
  if (!N5 || !host) return;
  const box = document.createElement('div');
  box.className = 'n5-p1-preview';
  host.appendChild(box);
  const h = document.createElement('h2'); h.textContent = '試しの操作(予行)'; box.appendChild(h);
  const row = document.createElement('div'); box.appendChild(row);
  const log = document.createElement('pre'); log.id = 'n5-p1-log'; box.appendChild(log);
  function btn(label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); row.appendChild(b); }
  btn('generating を起こす', () => N5.emit('n5:generating'));
  btn('result を起こす(samples から)', () => {
    const list = window.N5_SAMPLES || [];
    const r = list.filter((s) => s.language === N5.state.lang)[0] || list[0];
    N5.emit('n5:result', { result: r });
  });
  btn('error を起こす', () => N5.emit('n5:error', { message: N5.t({ en: 'Something went wrong. Please try again.', ja: 'うまくいきませんでした。もう一度ためしてください。' }) }));
  btn('ログイン後にする(n5:auth)', () => N5.emit('n5:auth', { user: { name: 'Demo' } }));
  btn('reset を起こす', () => N5.emit('n5:reset'));
  ['n5:auth', 'n5:lang', 'n5:generate', 'n5:generating', 'n5:result', 'n5:error', 'n5:reset'].forEach((n) => {
    N5.on(n, (d) => {
      let s; try { s = JSON.stringify(d); } catch (e) { s = '?'; }
      log.textContent += n + ' ' + (s.length > 120 ? s.slice(0, 120) + '…' : s) + '\n';
    });
  });
})();
