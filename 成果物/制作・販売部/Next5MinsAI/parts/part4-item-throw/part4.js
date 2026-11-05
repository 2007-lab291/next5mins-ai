// パーツ4 投げる品物(比べ表 4-1〜4-6。約束は parts/CONTRACT.md)。
// 聞く: n5:result・n5:timer・n5:generating・n5:reset・n5:lang / 出す: n5:item-thrown・n5:item-caught
(function () {
  'use strict';
  const N5 = window.N5;
  const T = {
    ad: { en: 'Ad・PR', ja: '広告・PR' },
    says: { en: 'Idiot says:', ja: 'バカいわく:' },
    link: { en: 'See it on Amazon', ja: 'Amazonで見る' },
    note: { en: 'Opens Amazon.com search results', ja: 'Amazon.co.jp の検索結果が開きます' },
    close: { en: 'Close', ja: '閉じる' },
    dialog: { en: 'Item suggestion', ja: 'バカのおすすめ品' }
  };
  // 4-6 Amazon アソシエイトの決まった一文(設計書 M-5)。文面は社長が決める(専門家に確かめる)。空なら出さない
  const ASSOCIATE_NOTE = { en: '', ja: '' };
  const FLY_MS = 3000;       // 4-3 飛ぶ時間
  const BUBBLE_MS = 2500;    // 4-2 ふきだしを出す時間
  const THROW_DELAY_MS = 1000; // 4-2 ふきだしを出してから投げるまで(自分で決めた)
  const RETRY_MS = 8000;     // 4-4 取りそこねてから、もう一度投げるまで
  const MAX_THROWS = 3;      // 4-4 合わせて何回まで

  const root = document.getElementById('n5-part4') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'n5-part4' }));
  let item = null;      // 覚えている idiot_item_throw
  let started = false;  // この result で投げ始めたか
  let count = 0;        // 投げた回数
  let gen = 0;          // reset のたびに増やす。古いタイマーを無効にする
  let timers = [];
  let raf = 0;
  let flying = null;    // 飛んでいる品物のボタン
  let bubble = null;
  let modal = null;     // { backdrop, ... 文字を書き直す部品 }
  let opener = null;
  let prevFocus = null; // 投げる前にフォーカスがあった所(品物は消えるので、閉じたあとの戻り先)

  function later(fn, ms) { const g = gen; const id = setTimeout(() => { if (g === gen) fn(); }, ms); timers.push(id); return id; }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function clearAll() {
    gen++;
    timers.forEach(clearTimeout); timers = [];
    cancelAnimationFrame(raf); raf = 0;
    if (flying) { flying.remove(); flying = null; }
    if (bubble) { bubble.remove(); bubble = null; }
    closeModal(true);
    started = false; count = 0; prevFocus = null;
  }

  // 4-1 投げる時
  function startThrowing() {
    if (!item || started) return;
    started = true;
    throwOnce();
  }
  // 4-2 ふきだし → 4-3 飛ぶ
  function throwOnce() {
    if (!item || count >= MAX_THROWS) return;
    count++;
    const ae = document.activeElement;
    if (ae && ae !== document.body && !root.contains(ae)) prevFocus = ae;
    showBubble();
    later(() => {
      N5.emit('n5:item-thrown', { item });
      fly();
    }, THROW_DELAY_MS);
  }
  function showBubble() {
    if (bubble) bubble.remove();
    bubble = el('div', 'n5-p4-bubble ' + (Math.random() < 0.5 ? 'n5-p4-bubble--left' : 'n5-p4-bubble--right'));
    bubble.setAttribute('role', 'status');
    bubble.appendChild(el('span', 'n5-p4-bubble-face', '🤪'));
    bubble.appendChild(el('span', 'n5-p4-bubble-line', item.shout_line || ''));
    root.appendChild(bubble);
    const b = bubble;
    later(() => { b.remove(); if (bubble === b) bubble = null; }, BUBBLE_MS); // 4-2 ふきだし自身の時間は BUBBLE_MS(合計2.5秒)
  }
  function fly() {
    const btn = el('button', 'n5-p4-item', item.item_emoji || '🎁');
    btn.type = 'button';
    btn.setAttribute('aria-label', item.item_name || '');
    root.appendChild(btn);
    flying = btn;
    const W = root.clientWidth || window.innerWidth;
    const H = root.clientHeight || window.innerHeight;
    const size = btn.offsetWidth || 64;
    const fromLeft = Math.random() < 0.5;
    const x0 = fromLeft ? -size : W; const x1 = fromLeft ? W : -size;
    const yBase = H * 0.65; const arc = H * 0.4;
    const spin = (fromLeft ? 1 : -1) * 180; // 少し回る
    const t0 = performance.now();
    const g = gen;
    function frame(now) {
      if (g !== gen || flying !== btn) return;
      const p = Math.min(1, (now - t0) / FLY_MS);
      const x = x0 + (x1 - x0) * p;
      const y = yBase - 4 * arc * p * (1 - p);
      btn.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (spin * p).toFixed(1) + 'deg)';
      if (p < 1) { raf = requestAnimationFrame(frame); return; }
      // 4-4 取りそこねた: 消して、8秒後にもう一度
      btn.remove(); flying = null; raf = 0;
      if (count < MAX_THROWS) later(throwOnce, RETRY_MS);
    }
    btn.addEventListener('click', () => caught(btn));
    raf = requestAnimationFrame(frame);
  }
  // 4-4 キャッチ
  function caught(btn) {
    if (flying !== btn) return;
    cancelAnimationFrame(raf); raf = 0;
    btn.remove(); flying = null;
    timers.forEach(clearTimeout); timers = [];
    if (bubble) { bubble.remove(); bubble = null; }
    opener = prevFocus && document.contains(prevFocus) ? prevFocus : null;
    const url = N5.amazonUrl(item.amazon_search_keyword);
    N5.emit('n5:item-caught', { item, url });
    openModal();
  }

  // 4-5 小窓 / 4-6 リンク
  function openModal() {
    const backdrop = el('div', 'n5-p4-backdrop');
    const dlg = el('div', 'n5-p4-dialog');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    const ad = el('span', 'n5-p4-ad');
    const emoji = el('div', 'n5-p4-modal-emoji', item.item_emoji || '🎁');
    const name = el('div', 'n5-p4-name', item.item_name || '');
    const says = el('p', 'n5-p4-says-label');
    const reason = el('p', 'n5-p4-reason', item.funny_reason || '');
    const link = el('a', 'n5-p4-link');
    link.target = '_blank'; link.rel = 'sponsored noopener noreferrer';
    const note = el('p', 'n5-p4-note');
    const assoc = el('p', 'n5-p4-note n5-p4-assoc');
    const close = el('button', 'n5-p4-close'); close.type = 'button';
    emoji.setAttribute('aria-hidden', 'true');
    [ad, emoji, name, says, reason, link, note, assoc, close].forEach((n) => dlg.appendChild(n));
    backdrop.appendChild(dlg);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    close.addEventListener('click', () => closeModal());
    root.appendChild(backdrop);
    modal = { backdrop, dlg, ad, says, link, note, assoc, close };
    renderModalText();
    close.focus();
  }
  function renderModalText() {
    if (!modal) return;
    modal.ad.textContent = N5.t(T.ad);
    modal.says.textContent = N5.t(T.says);
    modal.link.textContent = N5.t(T.link);
    modal.link.href = N5.amazonUrl(item.amazon_search_keyword);
    modal.note.textContent = N5.t(T.note);
    modal.assoc.textContent = N5.t(ASSOCIATE_NOTE);
    modal.assoc.hidden = !modal.assoc.textContent;
    modal.close.textContent = N5.t(T.close);
    modal.close.setAttribute('aria-label', N5.t(T.close));
    modal.dlg.setAttribute('aria-label', N5.t(T.dialog));
  }
  function closeModal(silent) {
    if (!modal) return;
    modal.backdrop.remove(); modal = null;
    if (!silent && opener && opener.focus && document.contains(opener)) opener.focus();
    opener = null; if (!silent) prevFocus = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal) closeModal(); });

  N5.on('n5:result', ({ result }) => {
    clearAll();
    item = (result && !result.safety && result.idiot_item_throw) || null;
    if (N5.config.throwTiming === 'cards') startThrowing();
  });
  N5.on('n5:timer', (d) => { if (d.status === 'start' && N5.config.throwTiming === 'timer') startThrowing(); });
  N5.on('n5:generating', () => { clearAll(); item = null; });
  N5.on('n5:reset', () => { clearAll(); item = null; });
  N5.on('n5:lang', () => renderModalText());
})();
