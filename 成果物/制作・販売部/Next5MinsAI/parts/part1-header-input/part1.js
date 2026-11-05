// パーツ1 ヘッダーと状況の入力(比べ表 1-1〜1-12)。約束は parts/CONTRACT.md。
(function () {
  'use strict';
  const N5 = window.N5;
  const head = document.getElementById('n5-part1');
  const input = document.getElementById('n5-part1-input');
  if (!N5 || (!head && !input)) return;
  const MAX = 240;

  // ---- 文(両言語。ここだけに持つ) ----
  const T = {
    logoName: { en: 'Next5Mins AI', ja: 'Next5Mins AI' },
    idiot: { en: 'Idiot', ja: 'バカ' },
    average: { en: 'Average', ja: '平凡' },
    god: { en: 'God', ja: '神' },
    langLabel: { en: 'Language', ja: '言語' },
    login: { en: 'Log In', ja: 'ログイン' },
    loginTitle: { en: 'Log In', ja: 'ログイン' },
    google: { en: 'Continue with Google', ja: 'Google で続ける' },
    email: { en: 'Continue with Email', ja: 'メールで続ける' },
    soon: { en: 'Coming soon (not available yet)', ja: '準備中(まだ使えません)' },
    close: { en: 'Close', ja: '閉じる' },
    title: { en: 'What are you procrastinating on right now?', ja: 'いま、何を先延ばしにしていますか?' },
    placeholder: {
      en: "E.g., I'm staring at an empty document for my history paper, scrolling social media instead...",
      ja: '例:明日テストなのにベッドでSNSを無限に見ている…'
    },
    random: { en: '🎲 Random Situation', ja: '🎲 ランダムな状況' },
    clear: { en: '✕ Clear', ja: '✕ 消す' },
    decide: { en: 'Decide My Next 5 Mins >>', ja: '5分後の行動を決める >>' },
    thinking: { en: 'Thinking…', ja: '考え中…' },
    myHistory: { en: 'My History', ja: 'My History(履歴)' },
    logout: { en: 'Log Out', ja: 'ログアウト' },
    account: { en: 'Account', ja: 'アカウント' },
    inputLabel: { en: 'Your situation', ja: 'いまの状況' }
  };
  const RANDOM = [
    { en: "I have a 10-page report due tomorrow and I've reorganized my desk three times instead of writing.", ja: '明日が締め切りのレポートがあるのに、机の整理ばかりしている。' },
    { en: "I keep opening my inbox, seeing 47 unread emails, and closing it again.", ja: '未読メールが47通たまっているのに、開いては閉じている。' },
    { en: "I told myself I'd go for a run, but I've been lying on the couch watching short videos for an hour.", ja: '走りに行くと決めたのに、1時間ソファで短い動画を見続けている。' },
    { en: "The dishes are piling up and I'm pretending not to see them.", ja: '洗い物がたまってきているのに、見ないふりをしている。' },
    { en: "I need to start my presentation slides, but I just keep changing the font of the title.", ja: 'プレゼンの資料を作り始めたいのに、タイトルのフォントばかり変えている。' },
    { en: "I should call the dentist to book an appointment, but I keep postponing it to \"later\".", ja: '歯医者の予約の電話をしないといけないのに、「あとで」と先送りしている。' }
  ];
  const PRESETS = [
    { label: { en: 'Studying', ja: '勉強・試験' }, text: { en: "I need to study for my exam but I keep scrolling my phone instead.", ja: '試験勉強をしないといけないのに、スマホばかり見ている。' } },
    { label: { en: 'Writing', ja: '文章を書く' }, text: { en: "I'm staring at an empty document and can't write the first sentence.", ja: '白紙の文書を前に、最初の1文が書けないでいる。' } },
    { label: { en: 'Exercise', ja: '運動' }, text: { en: "I planned to work out today but I can't get off the couch.", ja: '今日は運動すると決めたのに、ソファから動けない。' } },
    { label: { en: 'Work Task', ja: '仕事のタスク' }, text: { en: "I have an important work task due soon and I keep avoiding it.", ja: '締め切りが近い大事な仕事があるのに、手をつけずにいる。' } },
    { label: { en: 'Chores', ja: '部屋の片付け' }, text: { en: "My room is a mess and I keep telling myself I'll clean it later.", ja: '部屋が散らかっているのに、「あとで片付ける」と言い続けている。' } },
    { label: { en: 'Emails', ja: 'メール' }, text: { en: "I have a pile of emails to answer and I don't want to open them.", ja: '返信しないといけないメールがたまっているのに、開きたくない。' } }
  ];

  // ---- 部品づくり ----
  function el(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  const texts = []; // [要素, 辞書] 言語が変わったら textContent を書き直す
  function tx(e, dict) { texts.push([e, dict]); e.textContent = N5.t(dict); return e; }

  let sel, loginBtn, overlay, closeBtn, ta, countEl, decideBtn, errEl, titleEl, modalTitle;
  let busy = false;
  let user = null, accountBox, userBtn, menu;
  const LANG_KEY = 'n5-p1-account-lang'; // ログイン中だけ、言語の選択を端末に覚える(仕組み未接続の代わり)

  if (head) {
    head.textContent = '';
    const wrap = el('div', 'n5-p1-header', head);
    const bar = el('div', 'n5-container n5-p1-bar', wrap);
    const brand = el('div', 'n5-p1-brand', bar);
    tx(el('span', 'n5-p1-logo', brand), { en: '5m', ja: '5m' });
    tx(el('span', 'n5-p1-name', brand), T.logoName);
    const badges = el('div', 'n5-p1-badges', bar);
    [['idiot', '🤪'], ['average', '😐'], ['god', '⚡']].forEach(([k, em]) => {
      const b = el('span', 'n5-p1-badge n5-p1-badge-' + k, badges);
      const emo = el('span', '', b); emo.textContent = em; emo.setAttribute('aria-hidden', 'true');
      tx(el('span', '', b), T[k]);
    });
    const right = el('div', 'n5-p1-right', bar);
    sel = el('select', 'n5-p1-lang', right);
    [['en', '🌐 EN'], ['ja', '🌐 日本語']].forEach(([v, label]) => { const o = el('option', '', sel); o.value = v; o.textContent = label; });
    sel.value = N5.state.lang;
    sel.addEventListener('change', () => N5.emit('n5:lang', { lang: sel.value }));
    accountBox = el('div', 'n5-p1-account', right); accountBox.hidden = true;
    userBtn = el('button', 'n5-p1-user', accountBox); userBtn.type = 'button'; userBtn.setAttribute('aria-haspopup', 'true'); userBtn.setAttribute('aria-expanded', 'false');
    menu = el('div', 'n5-p1-menu', accountBox); menu.hidden = true;
    const hist = el('button', 'n5-p1-menu-item', menu); hist.type = 'button'; hist.disabled = true; tx(hist, T.myHistory);
    const out = el('button', 'n5-p1-menu-item', menu); out.type = 'button'; tx(out, T.logout);
    userBtn.addEventListener('click', () => { menu.hidden = !menu.hidden; userBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
    out.addEventListener('click', () => setUser(null));
    document.addEventListener('click', (e) => { if (menu && !menu.hidden && !accountBox.contains(e.target)) { menu.hidden = true; userBtn.setAttribute('aria-expanded', 'false'); } });
    loginBtn = el('button', 'n5-p1-login', right); loginBtn.type = 'button';
    tx(loginBtn, T.login);
    loginBtn.addEventListener('click', openModal);

    overlay = el('div', 'n5-p1-overlay', head); overlay.hidden = true;
    const modal = el('div', 'n5-p1-modal', overlay);
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modalTitle = tx(el('h2', 'n5-p1-modal-title', modal), T.loginTitle);
    modal.setAttribute('aria-labelledby', 'n5-p1-modal-title'); modalTitle.id = 'n5-p1-modal-title';
    closeBtn = el('button', 'n5-p1-close', modal); closeBtn.type = 'button'; closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeModal);
    ['google', 'email'].forEach((k) => { const b = el('button', 'n5-p1-oauth', modal); b.type = 'button'; tx(b, T[k]); });
    tx(el('p', 'n5-p1-soon', modal), T.soon);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) closeModal(); });
  }
  // ログインの状態。本物のログインは未接続。n5:auth { user: {name} | null } を聞いて見た目だけ切り替える
  function setUser(u) {
    user = u && u.name ? u : null;
    if (!accountBox) return;
    loginBtn.hidden = !!user; accountBox.hidden = !user; menu.hidden = true;
    userBtn.setAttribute('aria-expanded', 'false');
    if (user) {
      userBtn.textContent = '👤 ' + user.name;
      let saved = null; try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* 使えないときは覚えない */ }
      if ((saved === 'en' || saved === 'ja') && saved !== N5.state.lang) N5.emit('n5:lang', { lang: saved });
    }
  }
  function saveLang() { if (user) { try { localStorage.setItem(LANG_KEY, N5.state.lang); } catch (e) { /* 覚えない */ } } }
  function openModal() { overlay.hidden = false; closeBtn.focus(); }
  function closeModal() { overlay.hidden = true; loginBtn.focus(); }

  if (input) {
    input.textContent = '';
    const root = el('div', 'n5-p1-input', input);
    titleEl = tx(el('h1', 'n5-p1-title', root), T.title);
    const box = el('div', 'n5-p1-box', root);
    ta = el('textarea', 'n5-p1-textarea', box);
    ta.maxLength = MAX; ta.rows = 4;
    ta.addEventListener('input', onInput);
    const tools = el('div', 'n5-p1-tools', box);
    const rnd = el('button', 'n5-p1-tool', tools); rnd.type = 'button'; tx(rnd, T.random);
    rnd.addEventListener('click', () => { setText(N5.t(RANDOM[Math.floor(Math.random() * RANDOM.length)])); ta.focus(); });
    const clr = el('button', 'n5-p1-tool', tools); clr.type = 'button'; tx(clr, T.clear);
    clr.addEventListener('click', () => { setText(''); ta.focus(); N5.emit('n5:reset'); });
    countEl = el('span', 'n5-p1-count', tools);
    const presets = el('div', 'n5-p1-presets', root);
    PRESETS.forEach((p) => {
      const b = el('button', 'n5-p1-chip', presets); b.type = 'button'; tx(b, p.label);
      b.addEventListener('click', () => { setText(N5.t(p.text)); ta.focus(); });
    });
    errEl = el('p', 'n5-p1-error', root); errEl.hidden = true; errEl.setAttribute('role', 'alert');
    const actions = el('div', 'n5-p1-actions', root);
    decideBtn = el('button', 'n5-p1-decide', actions); decideBtn.type = 'button';
    decideBtn.addEventListener('click', onDecide);
  }

  function setText(s) { ta.value = s.slice(0, MAX); onInput(); }
  function onInput() { refresh(); }
  function refresh() {
    if (!input) return;
    countEl.textContent = ta.value.length + ' / ' + MAX;
    decideBtn.textContent = N5.t(busy ? T.thinking : T.decide);
    decideBtn.disabled = busy || ta.value.trim() === '';
  }
  function onDecide() {
    const text = ta.value.trim();
    if (!text || busy) return;
    errEl.hidden = true; errEl.textContent = '';
    N5.emit('n5:generate', { text, lang: N5.state.lang });
  }
  function rewrite() {
    texts.forEach(([e, d]) => { e.textContent = N5.t(d); });
    if (sel) { sel.value = N5.state.lang; sel.setAttribute('aria-label', N5.t(T.langLabel)); if (userBtn) { userBtn.setAttribute('aria-label', N5.t(T.account)); if (user) userBtn.textContent = '👤 ' + user.name; } closeBtn.setAttribute('aria-label', N5.t(T.close)); }
    if (input) {
      ta.placeholder = N5.t(T.placeholder);
      ta.setAttribute('aria-label', N5.t(T.inputLabel));
      document.documentElement.lang = N5.state.lang;
      refresh();
    }
  }

  // ---- 掲示板を聞く ----
  N5.on('n5:lang', () => { rewrite(); saveLang(); });
  N5.on('n5:auth', (d) => setUser(d && d.user));
  N5.on('n5:generating', () => { busy = true; refresh(); });
  N5.on('n5:result', () => { busy = false; refresh(); });
  N5.on('n5:error', (d) => {
    busy = false; refresh();
    if (errEl) { errEl.textContent = (d && d.message) || ''; errEl.hidden = !errEl.textContent; }
  });
  N5.on('n5:reset', () => { busy = false; if (errEl) { errEl.hidden = true; errEl.textContent = ''; } refresh(); });

  rewrite();
})();
