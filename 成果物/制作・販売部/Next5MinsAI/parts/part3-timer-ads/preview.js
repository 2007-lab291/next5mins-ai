// パーツ3 予行画面の「試しの操作」。本番の index.html では読まない
(function () {
  'use strict';
  const N5 = window.N5;
  const box = document.getElementById('n5-preview');
  const logBox = document.createElement('pre');
  logBox.id = 'n5-p3-log';
  function log(s) { logBox.textContent += s + '\n'; }
  ['n5:timer', 'n5:reset', 'n5:select', 'n5:item-caught', 'n5:lang'].forEach((n) => {
    N5.on(n, (d) => { if (n === 'n5:timer' && d.status === 'tick' && d.remaining % 10 && d.remaining > 5) return; log(n + ' ' + JSON.stringify(d).slice(0, 80)); });
  });
  function b(label, fn) { const x = document.createElement('button'); x.type = 'button'; x.textContent = label; x.addEventListener('click', fn); box.appendChild(x); box.appendChild(document.createTextNode(' ')); return x; }
  b('select (average)', () => {
    const s = (window.N5_SAMPLES || []).filter((r) => r.language === N5.state.lang)[0] || window.N5_SAMPLES[0];
    N5.emit('n5:select', { model: 'average', action: s.actions.average });
  });
  b('select (idiot)', () => {
    const s = (window.N5_SAMPLES || []).filter((r) => r.language === N5.state.lang)[0] || window.N5_SAMPLES[0];
    N5.emit('n5:select', { model: 'idiot', action: s.actions.idiot });
  });
  b('item-caught', () => N5.emit('n5:item-caught', { item: {}, url: '' }));
  b('reset', () => N5.emit('n5:reset'));
  b('en / ja', () => N5.emit('n5:lang', { lang: N5.state.lang === 'en' ? 'ja' : 'en' }));
  const lab = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.id = 'n5-p3-test5';
  cb.addEventListener('change', () => { window.N5_P3_TEST_SECONDS = cb.checked ? 5 : undefined; });
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode(' timer = 5 sec'));
  box.appendChild(lab);
  box.appendChild(logBox);
})();
