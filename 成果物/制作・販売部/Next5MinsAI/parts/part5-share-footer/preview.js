// パーツ5 予行の「試しの操作」。本番の index.html では読まない
(function () {
  'use strict';
  var N5 = window.N5;
  var box = document.getElementById('n5-p5-preview');
  if (!N5 || !box) return;
  var n = 0;
  function btn(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); box.appendChild(b); }
  var log = document.createElement('pre');
  function add(s) { log.textContent += s + '\n'; }
  btn('result を起こす(samples)', function () {
    var s = window.N5_SAMPLES || [];
    var pick = s.filter(function (r) { return r.language === N5.state.lang; });
    if (!pick.length) pick = s;
    var r = pick[n++ % pick.length];
    N5.emit('n5:result', { result: r });
  });
  btn('reset', function () { N5.emit('n5:reset', {}); });
  btn('言語切替', function () { N5.emit('n5:lang', { lang: N5.state.lang === 'en' ? 'ja' : 'en' }); });
  box.appendChild(log);
  ['n5:lang', 'n5:result', 'n5:reset'].forEach(function (name) {
    N5.on(name, function (d) { add(name + ' ' + (d.lang || (d.result ? d.result.language : ''))); });
  });
})();
