// AIの窓口(パーツ2が使う)。サーバー(server/)が動いていれば POST /api/next5。
// サーバーがなければ、config.allowFake のときだけ、にせの答え(samples.js)を返す。約束は parts/CONTRACT.md の 4。
(function () {
  'use strict';
  function fake(text, lang) {
    const list = (window.N5_SAMPLES || []).filter((s) => s.language === lang);
    const base = list[0] || (window.N5_SAMPLES || [])[0];
    if (!base) throw new Error('samples.js がない');
    const r = JSON.parse(JSON.stringify(base));
    r.language = lang;
    if (text) r.situation_summary = String(text).slice(0, 120);
    return r;
  }
  async function generate(text, lang) {
    text = String(text || '').trim().slice(0, 240);
    lang = lang === 'ja' ? 'ja' : 'en';
    let res;
    // ブラウザで直接ファイルを開いた予行(file:)では、サーバーがないので fetch をしない(console にエラーを出さないため)
    if (location.protocol === 'file:') {
      if (window.N5.config.allowFake) return new Promise((ok) => setTimeout(() => ok(fake(text, lang)), 800));
      throw new Error('server unreachable');
    }
    try {
      res = await fetch('/api/next5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang })
      });
    } catch (e) {
      if (window.N5.config.allowFake) return new Promise((ok) => setTimeout(() => ok(fake(text, lang)), 800));
      throw new Error('server unreachable');
    }
    if (res.status === 404 && window.N5.config.allowFake) return fake(text, lang);
    if (!res.ok) {
      const err = new Error('http ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
  window.N5.api = { generate, fake };
})();
