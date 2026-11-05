// パーツ2 3枚のカード(比べ表 2-1〜2-8)。約束は parts/CONTRACT.md。利用者・AIの文字は textContent だけで出す
(function () {
  'use strict';
  const root = document.getElementById('n5-part2');
  if (!root || !window.N5) return;
  const N5 = window.N5;
  const ORDER = ['idiot', 'average', 'god'];
  const TXT = {
    thinking: { en: 'Thinking… 3 minds at work…', ja: '考え中… 3人が考えています…' },
    situation: { en: 'Your situation: ', ja: 'あなたの状況: ' },
    why: { en: 'Why it works', ja: 'なぜ効くか' },
    pick: { en: 'Do this for 5 min', ja: 'これを5分やる' },
    selected: { en: 'Selected', ja: '選んだ' },
    retry: { en: 'Try again', ja: 'もう一度' },
    error: { en: "Couldn't get an answer. Please try again.", ja: '答えを取れませんでした。もう一度試してください' }
  };
  const BADGE = {
    idiot: { en: '🤪 Idiot · Lv.1', ja: '🤪 バカ・Lv.1' },
    average: { en: '😐 Average · Lv.50', ja: '😐 平凡・Lv.50' },
    god: { en: '⚡ God · Lv.999', ja: '⚡ 神・Lv.999' }
  };
  let mode = 'idle'; // idle | loading | cards | safety
  let result = null;
  let selected = null;
  let token = 0; // 古い答えを捨てるための番号

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clear() { while (root.firstChild) root.removeChild(root.firstChild); }

  function renderLoading() {
    clear();
    const p = el('p', 'n5-p2-thinking', N5.t(TXT.thinking));
    p.setAttribute('role', 'status');
    root.appendChild(p);
    const list = el('div', 'n5-p2-cards');
    for (let i = 0; i < 3; i++) list.appendChild(el('div', 'n5-p2-skeleton'));
    root.appendChild(list);
  }
  function renderSafety() {
    clear();
    const box = el('div', 'n5-p2-safety', result.message || '');
    box.setAttribute('role', 'status');
    root.appendChild(box);
  }
  function renderCards() {
    clear();
    if (result.situation_summary) root.appendChild(el('p', 'n5-p2-summary', N5.t(TXT.situation) + result.situation_summary));
    const list = el('div', 'n5-p2-cards');
    ORDER.forEach((m) => {
      const a = (result.actions || {})[m] || {};
      const card = el('div', 'n5-p2-card n5-p2-card-' + m + (selected === m ? ' n5-p2-card-selected' : ''));
      card.appendChild(el('span', 'n5-p2-badge n5-p2-badge-' + m, N5.t(BADGE[m])));
      card.appendChild(el('h3', 'n5-p2-title', a.title));
      card.appendChild(el('p', 'n5-p2-instruction', a.instruction));
      const why = el('p', 'n5-p2-why');
      why.appendChild(el('span', 'n5-p2-why-label', N5.t(TXT.why)));
      why.appendChild(document.createTextNode(a.why_it_works || ''));
      card.appendChild(why);
      card.appendChild(el('div', 'n5-p2-spacer'));
      card.appendChild(el('div', 'n5-p2-selected-mark', selected === m ? '✓ ' + N5.t(TXT.selected) : ''));
      const btn = el('button', 'n5-p2-pick n5-p2-pick-' + m, N5.t(TXT.pick));
      btn.type = 'button';
      btn.disabled = selected !== null;
      btn.addEventListener('click', () => choose(m));
      card.appendChild(btn);
      list.appendChild(card);
    });
    root.appendChild(list);
    const bar = el('div', 'n5-p2-actions');
    const retry = el('button', 'n5-p2-retry', N5.t(TXT.retry));
    retry.type = 'button';
    retry.disabled = selected !== null;
    retry.addEventListener('click', () => {
      if (selected !== null) return;
      N5.emit('n5:generate', { text: N5.state.text, lang: N5.state.lang });
    });
    bar.appendChild(retry);
    root.appendChild(bar);
  }
  function render() {
    if (mode === 'loading') renderLoading();
    else if (mode === 'safety') renderSafety();
    else if (mode === 'cards') renderCards();
  }
  function choose(m) {
    if (selected !== null || !result) return;
    selected = m;
    const action = (result.actions || {})[m] || {};
    renderCards();
    N5.emit('n5:select', { model: m, action: { title: action.title, instruction: action.instruction, why_it_works: action.why_it_works } });
  }
  function hideAll() { token++; mode = 'idle'; result = null; selected = null; clear(); root.hidden = true; }

  // file:// で開いたときは fetch が使えず console にエラーが出るので、サーバーを呼ばず、にせの答えだけを使う(予行用。common/api.js は変えない)
  const realGenerate = N5.api && N5.api.generate;
  function callApi(text, lang) {
    if (N5.api.generate === realGenerate && location.protocol === 'file:' && N5.config.allowFake && N5.api && N5.api.fake) {
      return new Promise((ok) => setTimeout(() => ok(N5.api.fake(String(text || '').trim().slice(0, 240), lang === 'ja' ? 'ja' : 'en')), 800));
    }
    return N5.api.generate(text, lang);
  }

  N5.on('n5:generate', (d) => {
    const my = ++token;
    result = null; selected = null; mode = 'loading';
    root.hidden = false;
    render();
    N5.emit('n5:generating', {});
    let p;
    try { p = Promise.resolve(callApi(d.text, d.lang)); } catch (e) { p = Promise.reject(e); }
    p.then((r) => {
      if (my !== token) return;
      if (!r || (!r.safety && !r.actions)) throw new Error('bad answer');
      result = r;
      mode = r.safety ? 'safety' : 'cards';
      render();
      N5.emit('n5:result', { result: r });
    }).catch(() => {
      if (my !== token) return;
      hideAll();
      N5.emit('n5:error', { message: N5.t(TXT.error) });
    });
  });
  N5.on('n5:reset', hideAll);
  N5.on('n5:lang', () => { if (mode !== 'idle') render(); });
})();
