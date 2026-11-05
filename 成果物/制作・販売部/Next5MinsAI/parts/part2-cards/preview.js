// 予行画面の「試しの操作」。本番の index.html では読まない
(function () {
  'use strict';
  const N5 = window.N5;
  const box = document.getElementById('n5-preview-controls');
  const log = document.getElementById('n5-preview-log');
  const input = document.createElement('input');
  input.type = 'text'; input.value = 'Need to do taxes'; input.maxLength = 240;
  input.setAttribute('aria-label', 'text');
  box.appendChild(input);
  function btn(label, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
    box.appendChild(b);
  }
  btn('generate を起こす(入力の文つき)', () => N5.emit('n5:generate', { text: input.value, lang: N5.state.lang }));
  btn('safety の答えを起こす', () => {
    N5.api.generate = () => Promise.resolve({ language: N5.state.lang, safety: true, message: N5.state.lang === 'ja' ? 'つらい気持ちを話してくれてありがとう。ひとりで抱えず、身近な人や相談窓口に話してみてください。' : 'Thank you for telling me. You do not have to carry this alone. Please consider reaching out to someone you trust or a local support line.' });
    N5.emit('n5:generate', { text: input.value, lang: N5.state.lang });
  });
  btn('reset', () => N5.emit('n5:reset', {}));
  btn('言語を切り替える', () => N5.emit('n5:lang', { lang: N5.state.lang === 'en' ? 'ja' : 'en' }));
  // パーツ1の代わり: n5:error の message を画面に出す(本番ではパーツ1が出す)
  const err = document.createElement('div');
  err.className = 'n5-p2-preview-error';
  err.setAttribute('role', 'alert');
  err.hidden = true;
  box.parentNode.insertBefore(err, box.nextSibling);
  N5.on('n5:error', (d) => { err.textContent = d.message || ''; err.hidden = false; });
  N5.on('n5:generate', () => { err.hidden = true; });
  N5.on('n5:reset', () => { err.hidden = true; });
  btn('error を起こす(失敗の試し)', () => {
    N5.api.generate = () => Promise.reject(new Error('test'));
    N5.emit('n5:generate', { text: input.value, lang: N5.state.lang });
  });
  ['n5:generate', 'n5:generating', 'n5:result', 'n5:select', 'n5:error', 'n5:reset', 'n5:lang'].forEach((n) => {
    N5.on(n, (d) => {
      const s = JSON.stringify(d);
      log.textContent += new Date().toLocaleTimeString() + ' ' + n + ' ' + (s.length > 120 ? s.slice(0, 120) + '…' : s) + '\n';
    });
  });
})();
