// Next5Mins AI 共通の掲示板(パーツ同士のやりとり)。約束は parts/CONTRACT.md。
// パーツは window.N5 を通してだけやりとりする。state は読むだけ。
(function () {
  'use strict';
  const state = { lang: 'en', text: '', result: null, selected: null, timer: null };
  const config = Object.assign(
    { amazonTag: { en: '', ja: '' }, throwTiming: 'timer', allowFake: true, adSlotHtml: '' },
    window.N5_CONFIG || {}
  );
  const N5 = {
    state,
    config,
    emit(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); },
    on(name, fn) { document.addEventListener(name, (e) => fn(e.detail || {})); },
    t(dict) { return (dict && (dict[state.lang] != null ? dict[state.lang] : dict.en)) || ''; },
    esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); },
    // 言語に合わせた Amazon の検索ページ(設計書 2-4)。印が空なら印なし
    amazonUrl(keyword, lang) {
      const l = lang || state.lang;
      const host = l === 'ja' ? 'https://www.amazon.co.jp' : 'https://www.amazon.com';
      const tag = (config.amazonTag && config.amazonTag[l]) || '';
      return host + '/s?k=' + encodeURIComponent(String(keyword || '')) + (tag ? '&tag=' + encodeURIComponent(tag) : '');
    }
  };
  // 出来事を見て state を更新する(bus.js だけが書く)
  N5.on('n5:lang', (d) => { if (d.lang === 'en' || d.lang === 'ja') { state.lang = d.lang; try { localStorage.setItem('n5.lang', d.lang); } catch (e) { /* 使えない環境 */ } } });
  N5.on('n5:generate', (d) => { state.text = String(d.text || ''); state.result = null; state.selected = null; state.timer = null; });
  N5.on('n5:result', (d) => { state.result = d.result || null; });
  N5.on('n5:select', (d) => { state.selected = d.model || null; });
  N5.on('n5:timer', (d) => { state.timer = { status: d.status, remaining: d.remaining }; });
  N5.on('n5:reset', () => { state.text = ''; state.result = null; state.selected = null; state.timer = null; });
  // 最初の言語: 前回の選択 → 端末の言語 → en
  let lang = null;
  try { lang = localStorage.getItem('n5.lang'); } catch (e) { /* 使えない環境 */ }
  if (lang !== 'en' && lang !== 'ja') lang = /^ja/i.test(navigator.language || '') ? 'ja' : 'en';
  state.lang = lang;
  window.N5 = N5;
  // 全パーツの js が読み込まれたあと(DOMContentLoaded)に、最初の n5:lang を出す
  document.addEventListener('DOMContentLoaded', () => N5.emit('n5:lang', { lang: state.lang }));
})();
