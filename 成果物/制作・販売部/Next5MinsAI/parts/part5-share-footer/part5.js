// パーツ5 共有とフッター(比べ表 5-1〜5-2)。差し込み口 #n5-part5。約束は parts/CONTRACT.md
(function () {
  'use strict';
  var N5 = window.N5;
  var root = document.getElementById('n5-part5');
  if (!N5 || !root) return;
  var T = {
    share: { en: 'Share', ja: '共有' },
    copy: { en: 'Copy', ja: 'コピー' },
    copied: { en: 'Copied', ja: 'コピーした' },
    brand: { en: 'Next5Mins AI', ja: 'Next5Mins AI' },
    afl: { en: 'This site contains affiliate links (Amazon Associates) and display ads.', ja: 'このサイトは、アフィリエイトのリンク(Amazonアソシエイト)と広告を含みます。' },
    privacy: { en: 'Privacy Policy', ja: 'プライバシーポリシー' },
    contact: { en: 'Contact', ja: '問い合わせ' },
    soon: { en: 'Coming soon', ja: '準備中' },
    fallback: { en: 'Next5Mins AI: let AI decide your next 5 minutes', ja: 'Next5Mins AI: 5分後の行動をAIに決めてもらう' }
  };

  function shareText() {
    var r = N5.state.result;
    var a = r && r.actions;
    if (a && a.idiot && a.average && a.god) {
      var i = a.idiot.title, m = a.average.title, g = a.god.title;
      if (N5.state.lang === 'ja') return 'バカ:' + i + '/平凡:' + m + '/神:' + g + ' — 5分後の行動は Next5Mins AI に決めてもらった';
      return 'Idiot: ' + i + ' / Average: ' + m + ' / God: ' + g + ' — my next 5 minutes, decided by Next5Mins AI';
    }
    return N5.t(T.fallback);
  }

  var els = {}, copiedTimer = null, soonTimer = null;
  function mk(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  function build() {
    root.textContent = '';
    var share = mk('div', 'n5-p5-share n5-container', root);
    els.shareTitle = mk('h2', 'n5-p5-share-title', share);
    var row = mk('div', 'n5-p5-share-row', share);
    els.reddit = mk('a', 'n5-p5-btn', row);
    els.x = mk('a', 'n5-p5-btn', row);
    [els.reddit, els.x].forEach(function (a) { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    els.copy = mk('button', 'n5-p5-btn', row);
    els.copy.type = 'button';
    els.copy.addEventListener('click', function () {
      var text = shareText();
      var done = function () {
        els.copy.textContent = N5.t(T.copied);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(function () { els.copy.textContent = N5.t(T.copy); }, 2000);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
      } catch (e) { /* 使えない環境 */ }
    });
    var foot = mk('div', 'n5-p5-foot', root);
    var inner = mk('div', 'n5-p5-foot-inner n5-container', foot);
    var left = mk('div', '', inner);
    els.brand = mk('p', 'n5-p5-brand', left);
    els.note = mk('p', 'n5-p5-note', left);
    var links = mk('div', 'n5-p5-links', inner);
    els.privacy = mk('a', '', links);
    els.contact = mk('a', '', links);
    [els.privacy, els.contact].forEach(function (a) {
      a.href = '#';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        els.soon.hidden = false;
        els.soon.textContent = N5.t(T.soon);
        clearTimeout(soonTimer);
        soonTimer = setTimeout(function () { els.soon.hidden = true; }, 3000);
      });
    });
    els.soon = mk('p', 'n5-p5-soon', links);
    els.soon.hidden = true;
    els.soon.setAttribute('role', 'status');
  }

  function render() {
    var text = shareText();
    els.shareTitle.textContent = N5.t(T.share);
    els.reddit.textContent = 'Reddit';
    els.reddit.href = 'https://www.reddit.com/submit?title=' + encodeURIComponent(text) + '&text=' + encodeURIComponent(text);
    els.x.textContent = 'X';
    els.x.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
    els.copy.textContent = N5.t(T.copy);
    els.brand.textContent = N5.t(T.brand);
    els.note.textContent = N5.t(T.afl);
    els.privacy.textContent = N5.t(T.privacy);
    els.contact.textContent = N5.t(T.contact);
    if (!els.soon.hidden) els.soon.textContent = N5.t(T.soon);
  }

  build();
  render();
  N5.on('n5:lang', render);
  N5.on('n5:result', render);
  N5.on('n5:reset', render);
})();
