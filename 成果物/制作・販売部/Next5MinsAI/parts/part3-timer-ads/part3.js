// パーツ3 タイマーと広告(比べ表 3-1〜3-4。約束は parts/CONTRACT.md)
// 2026-11-13 社長の指示「名前はそのままに5分後にする行動という制限をなくしましょう」「本サイトもなくす」で、5分のカウントダウンをやめ、かかった時間を数える(時間の決まりはない。終わったら「できた」を押す)
(function () {
  'use strict';
  const N5 = window.N5;
  const root = document.getElementById('n5-part3');
  if (!N5 || !root) return;

  const T = {
    pause: { en: 'Pause', ja: '一時停止' },
    resume: { en: 'Resume', ja: '再開' },
    doneEarly: { en: 'Done', ja: 'できた' },
    giveUp: { en: 'Give up', ja: 'やめる' },
    done: { en: 'Done!', ja: 'できた!' },
    praise: { en: 'Nice work. Time well spent: ', ja: 'おつかれさま。ちゃんと動けました。かかった時間: ' },
    back: { en: 'Back to start', ja: '最初に戻る' },
    item: { en: '🎁 Item caught', ja: '🎁 品物をキャッチした' },
    ad: { en: 'Ad', ja: '広告' },
    adEmpty: { en: 'Ad slot', ja: '広告の枠' }
  };
  let sel = null;          // { model, action }
  let elapsed = 0;         // かかった秒(数え上げ)
  const MAX_SECONDS = 24 * 60 * 60; // 開いたままでも、24時間で「できた」と同じに止める(2026-11-13 の安全点検 所見4)
  let status = 'idle';     // idle | running | paused | done
  let startedAt = 0;
  let handle = null;
  let caught = false;
  const el = {};

  function fmt(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const mmss = String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    return h > 0 ? h + ':' + mmss : mmss; // 1時間をこえたら h:mm:ss
  }
  function stop() { if (handle != null) { clearInterval(handle); handle = null; } }
  function mk(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function btn(label, cls, fn, parent) {
    const b = mk('button', 'n5-p3-btn' + (cls ? ' ' + cls : ''), parent);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  function build() {
    root.replaceChildren();
    const card = mk('div', 'n5-p3-card', root);
    el.title = mk('p', 'n5-p3-title n5-p3-' + sel.model, card);
    el.instr = mk('p', 'n5-p3-instruction', card);
    el.clock = mk('div', 'n5-p3-clock', card);
    el.clock.setAttribute('role', 'timer');
    el.praise = mk('p', 'n5-p3-praise', card);
    el.badge = mk('div', 'n5-p3-badge', card);
    el.btns = mk('div', 'n5-p3-buttons', card);
    el.pause = btn('', '', togglePause, el.btns);
    el.early = btn('', '', finish, el.btns);
    el.give = btn('', '', () => N5.emit('n5:reset'), el.btns);
    el.back = btn('', 'n5-p3-primary', () => N5.emit('n5:reset'), el.btns);
    // 3-4 広告の枠
    el.ad = mk('div', 'n5-p3-ad', root);
    el.adLabel = mk('span', 'n5-p3-ad-label', el.ad);
    el.adBody = mk('div', 'n5-p3-ad-body', el.ad);
    const html = N5.config && N5.config.adSlotHtml;
    if (html) {
      el.adBody.innerHTML = html; // 社長の設定(config.js)。利用者の文字ではない。<script> は innerHTML では動かない(3-4。README 参照)
    } else {
      el.adEmpty = mk('div', 'n5-p3-ad-empty', el.adBody);
    }
    render();
  }

  function render() {
    if (!el.title) return;
    el.title.textContent = sel.action.title || '';
    el.instr.textContent = sel.action.instruction || '';
    const isDone = status === 'done';
    el.clock.textContent = isDone ? N5.t(T.done) : fmt(elapsed);
    el.clock.classList.toggle('n5-p3-done', isDone);
    el.praise.hidden = !isDone;
    el.praise.textContent = isDone ? N5.t(T.praise) + fmt(elapsed) : '';
    el.badge.hidden = !caught;
    el.badge.textContent = caught ? N5.t(T.item) : '';
    el.pause.textContent = N5.t(status === 'paused' ? T.resume : T.pause);
    el.early.textContent = N5.t(T.doneEarly);
    el.give.textContent = N5.t(T.giveUp);
    el.back.textContent = N5.t(T.back);
    el.pause.hidden = el.early.hidden = el.give.hidden = isDone;
    el.back.hidden = !isDone;
    el.adLabel.textContent = N5.t(T.ad);
    if (el.adEmpty) el.adEmpty.textContent = N5.t(T.adEmpty);
  }

  function tick() {
    if (status !== 'running') return;
    const now = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    if (now === elapsed) return;
    elapsed = Math.min(now, MAX_SECONDS);
    if (elapsed >= MAX_SECONDS) { finish(); return; }
    render();
    N5.emit('n5:timer', { status: 'tick', elapsed });
  }
  function finish() {
    if (status === 'done' || status === 'idle') return;
    if (status === 'running') elapsed = Math.min(MAX_SECONDS, Math.max(0, Math.floor((Date.now() - startedAt) / 1000))); // tick() は呼ばない(24時間で finish を呼ぶので、呼ぶと回り続ける)
    stop();
    status = 'done';
    render();
    N5.emit('n5:timer', { status: 'done', elapsed });
  }
  function togglePause() {
    if (status === 'running') {
      tick();
      if (status !== 'running') return;
      stop();
      status = 'paused';
    } else if (status === 'paused') {
      startedAt = Date.now() - elapsed * 1000;
      status = 'running';
      handle = setInterval(tick, 250);
    }
    render();
  }
  function start(s) {
    stop();
    sel = s;
    caught = false;
    elapsed = 0;
    status = 'running';
    startedAt = Date.now();
    root.hidden = false;
    build();
    handle = setInterval(tick, 250);
    N5.emit('n5:timer', { status: 'start', elapsed: 0 });
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function clear() {
    stop();
    status = 'idle';
    sel = null;
    caught = false;
    el.title = null;
    root.hidden = true;
    root.replaceChildren();
  }

  N5.on('n5:select', (d) => { if (d && d.action) start({ model: d.model === 'idiot' || d.model === 'god' ? d.model : 'average', action: d.action }); });
  N5.on('n5:item-caught', () => { if (status === 'idle') return; caught = true; render(); });
  N5.on('n5:reset', clear);
  N5.on('n5:generating', clear); // 作り直しの間は閉じる(自分で決めたこと)
  N5.on('n5:lang', () => render());
  // 裏タブから戻った・時計が飛んだときに、すぐ実時間に合わせる(3-2)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();
