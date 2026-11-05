// パーツ4 予行の「試しの操作」。本番の index.html では読まない。
(function () {
  'use strict';
  const N5 = window.N5;
  const box = document.getElementById('n5-p4-controls');
  const log = document.getElementById('n5-p4-log');
  function add(label, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => fn(b)); box.appendChild(b); return b;
  }
  function sample() {
    const list = window.N5_SAMPLES || [];
    return JSON.parse(JSON.stringify(list.find((s) => s.language === N5.state.lang) || list[0]));
  }
  add('result (samples)', () => N5.emit('n5:result', { result: sample() }));
  add('result (safety: no throw)', () => N5.emit('n5:result', { result: { language: N5.state.lang, safety: true, message: 'You are not alone.' } }));
  add('timer start', () => N5.emit('n5:timer', { status: 'start', remaining: 300 }));
  add('reset', () => N5.emit('n5:reset', {}));
  add('lang: en', () => N5.emit('n5:lang', { lang: 'en' }));
  add('lang: ja', () => N5.emit('n5:lang', { lang: 'ja' }));
  const tBtns = {};
  ['timer', 'cards'].forEach((v) => {
    tBtns[v] = add('throwTiming: ' + v, () => { N5.config.throwTiming = v; sync(); write('throwTiming = ' + v); });
  });
  function sync() { Object.keys(tBtns).forEach((k) => tBtns[k].setAttribute('aria-pressed', String(N5.config.throwTiming === k))); }
  function write(text) {
    const li = document.createElement('li');
    li.textContent = new Date().toLocaleTimeString() + ' ' + text;
    log.appendChild(li);
  }
  ['n5:result', 'n5:timer', 'n5:reset', 'n5:lang', 'n5:generating', 'n5:item-thrown', 'n5:item-caught'].forEach((name) => {
    N5.on(name, (d) => {
      let s = name;
      if (d.item) s += ' ' + (d.item.item_name || '');
      if (d.url) s += ' ' + d.url;
      if (d.status) s += ' ' + d.status;
      if (d.lang) s += ' ' + d.lang;
      write(s);
    });
  });
  sync();
})();
