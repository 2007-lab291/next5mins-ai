// バカ工房の画面。文は、いつも textContent で出す(HTML として差し込まない)。
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // 画面の状態
  var state = null;            // /api/state の答え
  var conv = null;             // 会話の id(新しい会話は null)
  var busy = false;            // 送っている間
  var lastBot = null;          // いちばん新しい答えの { row, data, ... }
  var bpCache = {};            // 'キャラ:ref' -> 設計図(ネタ/一歩の型の名前を引くため)
  var editing = null;          // 設計図タブで開いている設計図
  var SEND_MAX = 400;
  var convChar = 'idiot';      // いまの会話のキャラ
  var CHAR_LABEL = { idiot: '🤪 バカ', average: '😐 平凡' };

  function cacheKey(ch, ref) { return ch + ':' + ref; }
  // 選べるキャラ(古いサーバーで chars が無ければ、バカだけ)
  function charList() {
    if (state && Array.isArray(state.chars) && state.chars.length) return state.chars;
    return [{ key: 'idiot', label: '🤪 バカ', blueprints: (state && state.blueprints) || [], defaultRef: state && state.defaultRef }];
  }
  function charInfo(key) {
    var l = charList();
    for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i];
    return l[0];
  }
  function charLabel(key) { return CHAR_LABEL[key] || charInfo(key).label || key; }
  function isAvg(key) { return key === 'average'; }
  function qs(ch, ref, extra) {
    return '?char=' + encodeURIComponent(ch) + '&ref=' + encodeURIComponent(ref) + (extra || '');
  }

  // ---------- 小さな道具 ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(node, on) { node.hidden = !on; }
  function len(s) { return Array.from(s).length; }
  function fmtUsd(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '目安なし';
    return '$' + n.toFixed(4);
  }

  async function api(path, body) {
    var opt = { method: 'GET' };
    if (body !== undefined) {
      opt = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    var res;
    try {
      res = await fetch(path, opt);
    } catch (e) {
      return { ok: false, status: 0, error: 'unreachable', message: 'サーバーにつながりません。黒い画面が開いているか、確かめてください。' };
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.ok) return { ok: true, status: res.status, data: data };
    var msg = (data && typeof data.message === 'string' && data.message) ? data.message : 'うまくいきませんでした(状態 ' + res.status + ')。';
    return { ok: false, status: res.status, error: data && data.error, message: msg, data: data };
  }

  function showError(box, text) { box.textContent = text; show(box, true); }
  function hideError(box) { box.textContent = ''; show(box, false); }

  // ---------- 上の帯 ----------
  function renderTop() {
    if (!state) return;
    $('modeBadge').textContent = state.dry ? '予行' : '本物';
    $('modelName').textContent = state.dry ? 'モデル: にせのAI(' + state.model + ')' : 'モデル: ' + state.model;
    show($('dryBand'), !!state.dry);
    renderTotals(state.totals);
  }
  function renderTotals(t) {
    var n = t && typeof t.turns === 'number' ? t.turns : 0;
    var u = t && typeof t.usd === 'number' ? t.usd : 0;
    var unk = t && typeof t.unknown === 'number' ? t.unknown : 0;
    if (state && state.dry) {
      $('totals').textContent = '起動してからの合計: 答えた回数 ' + n + '回(予行なので、費用はかかっていません)';
    } else if (unk > 0) {
      $('totals').textContent = '起動してからの合計: 答えた回数 ' + n + '回・約 ' + fmtUsd(u) + ' 以上(目安。AIを呼んだうち ' + unk + '回は、料金表に無いモデルなので目安が出せません)';
    } else {
      $('totals').textContent = '起動してからの合計: 答えた回数 ' + n + '回・約 ' + fmtUsd(u) + '(目安)';
    }
  }

  function refLabel(b) {
    var kind = b.kind === 'draft' ? '下書き' : '公式';
    return b.ref.replace(/^[a-z]+:/, '') + ' ' + b.title + '(' + kind + ')';
  }

  function fillCharSelect(sel) {
    var prev = sel.value;
    clear(sel);
    charList().forEach(function (c) {
      var o = el('option', '', c.label || charLabel(c.key));
      o.value = c.key;
      sel.appendChild(o);
    });
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === prev; });
    sel.value = has ? prev : charList()[0].key;
  }

  function fillRefSelect(sel, charSel, keepValue) {
    var prev = keepValue || sel.value;
    var info = charInfo(charSel.value);
    clear(sel);
    (info.blueprints || []).forEach(function (b) {
      var o = el('option', '', refLabel(b));
      o.value = b.ref;
      sel.appendChild(o);
    });
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === prev; });
    sel.value = has ? prev : info.defaultRef;
  }

  function fillThink() {
    var sel = $('chatThink');
    var prev = sel.value;
    clear(sel);
    (state.thinkLevels || []).forEach(function (t) {
      var o = el('option', '', t.label);
      o.value = t.key;
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  }

  function fillDraftSelect() {
    var sel = $('sumDraft');
    var prev = sel.value;
    clear(sel);
    var none = el('option', '', 'なし');
    none.value = '';
    sel.appendChild(none);
    (charInfo($('sumChar').value).blueprints || []).filter(function (b) { return b.kind === 'draft'; }).forEach(function (b) {
      var o = el('option', '', refLabel(b));
      o.value = b.ref;
      sel.appendChild(o);
    });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === prev; }) ? prev : '';
  }

  async function loadState() {
    var r = await api('/api/state');
    if (!r.ok) { showError($('loadError'), r.message); return false; }
    hideError($('loadError'));
    state = r.data;
    renderTop();
    fillCharSelect($('chatChar'));
    fillCharSelect($('bpChar'));
    fillCharSelect($('sumChar'));
    fillRefSelect($('chatRef'), $('chatChar'));
    fillRefSelect($('bpRef'), $('bpChar'));
    renderChatChar();
    renderBpChar();
    fillThink();
    fillDraftSelect();
    return true;
  }

  // ---------- タブ ----------
  function switchTab(name) {
    ['chat', 'bp', 'sum'].forEach(function (n) {
      var on = n === name;
      var t = $('tab-' + n);
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      show($('panel-' + n), on);
    });
    if (name === 'bp' && !editing) loadBlueprint($('bpRef').value);
  }

  // ---------- 会話 ----------
  function renderChatChar() {
    var ch = $('chatChar').value;
    $('thinkingWho').textContent = charLabel(ch);
    $('chatLabel').textContent = isAvg(ch) ? '平凡に相談する' : 'バカに相談する';
  }

  function lockSettings(on) {
    $('chatChar').disabled = on;
    $('chatRef').disabled = on;
    $('chatLang').disabled = on;
    $('chatThink').disabled = on;
    show($('lockNote'), on);
  }

  function updateSend() {
    var n = len($('chatText').value.trim());
    var c = len($('chatText').value);
    $('charCount').textContent = c + '/' + SEND_MAX;
    $('charCount').classList.toggle('over', c > SEND_MAX);
    $('sendBtn').disabled = busy || n < 1 || c > SEND_MAX;
    $('sendBtn').textContent = busy ? '送っています…' : '送る';
  }

  function setBusy(on) {
    busy = on;
    show($('thinkingRow'), on);
    updateSend();
    var rg = document.querySelector('.regen-btn');
    if (rg) rg.disabled = on;
    if (on) scrollToEnd();
  }

  function scrollToEnd() {
    var row = $('thinkingRow');
    if (!row.hidden && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  // ネタ(バカ)・一歩(平凡)の型の名前を、設計図から引く
  async function netaName(ch, ref, id) {
    if (!id || id === 'none') return null;
    var key = cacheKey(ch, ref);
    if (!bpCache[key]) {
      var r = await api('/api/blueprint' + qs(ch, ref));
      if (r.ok) bpCache[key] = r.data;
    }
    var bp = bpCache[key];
    var list = bp && (isAvg(ch) ? bp.step_types : bp.neta_types);
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i].name;
      }
    }
    return id;
  }

  function addUserBubble(text) {
    $('emptyNote').hidden = true;
    var row = el('div', 'user-row');
    row.appendChild(el('div', 'user-bubble', text));
    $('log').appendChild(row);
    return row;
  }

  function buildBot(d, neta) {
    var r = d.reply || {};
    var ch = d.char === 'average' ? 'average' : 'idiot';
    var avg = isAvg(ch);
    var row = el('div', 'bot-row');
    var bubble = el('div', avg ? 'bot-bubble avg-bubble' : 'bot-bubble');
    var head = el('div', 'bot-head');
    head.appendChild(el('span', 'bot-name', charLabel(ch)));
    if (neta) head.appendChild(el('span', avg ? 'neta-tag avg-tag' : 'neta-tag', neta));
    if (d.filtered || r.mode === 'safety') head.appendChild(el('span', 'safety-tag', '安全のための返事'));
    bubble.appendChild(head);

    if (r.mode === 'safety') {
      bubble.appendChild(el('p', 'say safety-say', r.say));
    } else {
      bubble.appendChild(el('p', 'say', r.say));
    }

    if (r.action) {
      var card = el('div', 'action-card');
      card.appendChild(el('p', 'action-title', r.action.title));
      card.appendChild(el('p', 'action-inst', r.action.instruction));
      card.appendChild(el('p', 'action-sub', 'なぜ効くか'));
      card.appendChild(el('p', 'action-why', r.action.why_it_works));
      bubble.appendChild(card);
    }
    if (r.item && !avg) {
      var box = el('div', 'item-box');
      box.appendChild(el('div', 'item-emoji', r.item.item_emoji));
      box.appendChild(el('p', 'item-shout', r.item.shout_line));
      box.appendChild(el('p', 'item-name', r.item.item_name));
      box.appendChild(el('p', 'item-reason', r.item.funny_reason));
      box.appendChild(el('p', 'item-amazon', 'Amazonで探す言葉: ' + r.item.amazon_search_keyword));
      bubble.appendChild(box);
    }
    (d.problems || []).forEach(function (p) {
      bubble.appendChild(el('div', 'problem-tag', 'チェック: ' + p));
    });
    row.appendChild(bubble);

    // 評価
    var rateWrap = el('div', 'rate-wrap');
    var rateRow = el('div', 'rate-row');
    var memoArea = el('div', 'memo-area');
    memoArea.hidden = true;
    var memoLabel = el('label', '', 'ひとことメモ(500文字まで)');
    var memoId = 'memo-' + d.conv + '-' + d.turn + '-' + Math.random().toString(36).slice(2, 7);
    memoLabel.setAttribute('for', memoId);
    var memo = el('textarea');
    memo.id = memoId;
    memo.rows = 2;
    var memoBtn = el('button', 'btn btn-sub btn-small', 'メモを保存');
    memoBtn.type = 'button';
    var memoMsg = el('span', 'msg-inline');
    memoMsg.setAttribute('role', 'status');
    memoArea.appendChild(memoLabel);
    memoArea.appendChild(memo);
    memoArea.appendChild(memoBtn);
    memoArea.appendChild(memoMsg);

    var current = null;
    var btns = {};
    [['good', '👍 いい'], ['meh', '😐 ふつう'], ['bad', '👎 だめ']].forEach(function (p) {
      var b = el('button', 'rate-btn', p[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', async function () {
        current = p[0];
        Object.keys(btns).forEach(function (k) { btns[k].setAttribute('aria-pressed', k === current ? 'true' : 'false'); });
        memoArea.hidden = false;
        var res = await api('/api/rate', { conv: d.conv, turn: d.turn, rating: current, memo: memo.value });
        memoMsg.textContent = res.ok ? '評価を保存しました。' : res.message;
      });
      btns[p[0]] = b;
      rateRow.appendChild(b);
    });
    memoBtn.addEventListener('click', async function () {
      if (!current) return;
      if (len(memo.value) > 500) { memoMsg.textContent = 'メモは500文字までです。'; return; }
      var res = await api('/api/rate', { conv: d.conv, turn: d.turn, rating: current, memo: memo.value });
      memoMsg.textContent = res.ok ? 'メモを保存しました。' : res.message;
    });
    rateWrap.appendChild(rateRow);
    rateWrap.appendChild(memoArea);
    row.appendChild(rateWrap);

    // 言い直し(いちばん新しい答えだけ。あとで付け外しする)
    var regenHolder = el('div', 'regen-holder');
    row.appendChild(regenHolder);

    if (d.thinking) {
      var det = el('details', 'thought');
      det.appendChild(el('summary', '', '頭の中を見る'));
      det.appendChild(el('p', 'thought-body', d.thinking));
      row.appendChild(det);
    }

    var u = d.usage || {};
    var sec = typeof d.ms === 'number' ? (d.ms / 1000).toFixed(1) : '?';
    var tries = typeof d.tries === 'number' ? Math.max(0, d.tries - 1) : 0;
    var costText = d.dry ? '予行(費用なし。トークンの数もにせ)' : (d.filtered ? 'AIには送っていません(費用なし)'
      : (d.costUsd === null ? '費用の目安なし(料金表に無いモデル)' : '約 ' + fmtUsd(d.costUsd)));
    row.appendChild(el('p', 'meta',
      '入力 ' + (u.input_tokens || 0) + ' / 出力 ' + (u.output_tokens || 0) + ' トークン(AIが読み書きする量の単位)・' + costText +
      '・' + sec + '秒・やり直し ' + tries + '回'));
    return { row: row, regenHolder: regenHolder };
  }

  function setRegenOnly(entry) {
    // 言い直しボタンは、いちばん新しい答えだけに付ける
    document.querySelectorAll('.regen-btn').forEach(function (b) { b.remove(); });
    var b = el('button', 'btn btn-sub btn-small regen-btn', '言い直させる');
    b.type = 'button';
    b.disabled = busy;
    b.addEventListener('click', regenerate);
    entry.regenHolder.appendChild(b);
  }

  async function showBot(d, replaceRow) {
    var ch = d.char === 'average' ? 'average' : 'idiot';
    var name = await netaName(ch, d.ref, d.reply && (ch === 'average' ? d.reply.step : d.reply.neta));
    var entry = buildBot(d, name);
    if (replaceRow && replaceRow.parentNode) {
      replaceRow.parentNode.replaceChild(entry.row, replaceRow);
    } else {
      $('log').appendChild(entry.row);
    }
    setRegenOnly(entry);
    lastBot = { row: entry.row, data: d };
    entry.row.scrollIntoView && entry.row.scrollIntoView({ block: 'nearest' });
  }

  function failMessage(r) {
    var m = r.message;
    // 失敗でも返事が届いていれば、お金はかかっている。合計を直し、知らせる
    if (r.data && r.data.totals) renderTotals(r.data.totals);
    if (r.data && typeof r.data.costUsd === 'number' && r.data.costUsd > 0) m += '\n(この失敗でも、約 ' + fmtUsd(r.data.costUsd) + ' かかりました)';
    else if (r.data && r.data.costUsd === null) m += '\n(この失敗でも、お金はかかっています。料金表に無いモデルなので、目安は出せません)';
    if (r.status === 409) m += '\n「新しい会話」を押して、新しく始めてください。';
    return m;
  }

  async function send() {
    if (busy) return;
    var text = $('chatText').value.trim();
    if (!text || len(text) > SEND_MAX) return;
    hideError($('chatError'));
    var bubbleRow = addUserBubble(text);
    $('chatText').value = '';
    setBusy(true);
    var r = await api('/api/chat', {
      conv: conv, char: $('chatChar').value, ref: $('chatRef').value, lang: $('chatLang').value, think: $('chatThink').value, text: text
    });
    setBusy(false);
    if (!r.ok) {
      bubbleRow.remove();
      if (!$('log').querySelector('.user-row')) $('emptyNote').hidden = false;
      $('chatText').value = text;
      showError($('chatError'), failMessage(r));
      updateSend();
      return;
    }
    var d = r.data;
    conv = d.conv;
    lockSettings(true);
    // 会話の設定を、サーバーの値に合わせて見せる
    convChar = d.char === 'average' ? 'average' : 'idiot';
    if (d.char) $('chatChar').value = convChar;
    if (d.ref) $('chatRef').value = d.ref;
    if (d.lang) $('chatLang').value = d.lang;
    if (d.think) $('chatThink').value = d.think;
    renderTotals(d.totals);
    await showBot(d, null);
    updateSend();
  }

  async function regenerate() {
    if (busy || !conv) return;
    hideError($('chatError'));
    setBusy(true);
    var r = await api('/api/regenerate', { conv: conv });
    setBusy(false);
    if (!r.ok) { showError($('chatError'), failMessage(r)); return; }
    renderTotals(r.data.totals);
    await showBot(r.data, lastBot && lastBot.row);
  }

  function newConversation() {
    if (busy) return;
    conv = null;
    lastBot = null;
    var log = $('log');
    clear(log);
    var note = el('p', 'empty-note', 'まだ会話がありません。下の欄に、いまの状況やお悩みを書いて送ってみましょう。');
    note.id = 'emptyNote';
    log.appendChild(note);
    hideError($('chatError'));
    lockSettings(false);
    updateSend();
  }

  // ---------- 設計図 ----------
  function renderBpChar() {
    var avg = isAvg($('bpChar').value);
    $('netaLegend').textContent = avg ? '一歩の型(step_types)' : 'ネタの型(neta_types)';
    $('bpPersonaLabel').textContent = avg ? '平凡の人物像(persona)' : 'バカの人物像(persona)';
    show($('itemRulesField'), !avg);
    show($('shoutGroup'), !avg);
  }

  var TEXT_FIELDS = ['title', 'note', 'persona', 'core_rule'];
  var LIST_FIELDS = ['rules', 'banned', 'conversation_rules', 'item_rules'];
  var LIST_FIELDS_AVG = ['rules', 'banned', 'conversation_rules'];

  function addNetaRow(n) {
    var item = el('div', 'neta-item');
    var grid = el('div', 'neta-grid');
    var uid = Math.random().toString(36).slice(2, 8);
    function mk(labelText, cls, tag) {
      var f = el('div', 'field');
      var l = el('label', '', labelText);
      var inp = el(tag === 'textarea' ? 'textarea' : 'input', cls);
      if (tag === 'textarea') inp.rows = 3; else inp.type = 'text';
      inp.id = 'neta-' + cls + '-' + uid;
      l.setAttribute('for', inp.id);
      f.appendChild(l); f.appendChild(inp);
      grid.appendChild(f);
      return inp;
    }
    var id = mk('id(英小文字と数字と _)', 'neta-id', 'input');
    var name = mk('name(名前)', 'neta-name', 'input');
    var how = mk('how(どうやるか)', 'neta-how', 'textarea');
    id.value = (n && n.id) || ''; name.value = (n && n.name) || ''; how.value = (n && n.how) || '';
    item.appendChild(grid);
    var del = el('button', 'btn btn-sub btn-small', 'この型を消す');
    del.type = 'button';
    del.style.marginTop = '8px';
    del.addEventListener('click', function () { item.remove(); });
    item.appendChild(del);
    $('netaList').appendChild(item);
  }

  function fillForm(bp) {
    TEXT_FIELDS.forEach(function (k) { $('bp-' + k).value = bp[k] || ''; });
    (isAvg($('bpChar').value) ? LIST_FIELDS_AVG : LIST_FIELDS).forEach(function (k) { $('bp-' + k).value = (bp[k] || []).join('\n'); });
    clear($('netaList'));
    (isAvg($('bpChar').value) ? (bp.step_types || []) : (bp.neta_types || [])).forEach(addNetaRow);
    $('bp-shout-ja').value = (bp.shout_line && bp.shout_line.ja) || '';
    $('bp-shout-en').value = (bp.shout_line && bp.shout_line.en) || '';
    if (isAvg($('bpChar').value)) { $('bp-item_rules').value = ''; $('bp-shout-ja').value = ''; $('bp-shout-en').value = ''; }
    ['ja', 'en'].forEach(function (lg) {
      ['say', 'instruction', 'why_it_works'].forEach(function (k) {
        var v = bp.length && bp.length[lg] ? bp.length[lg][k] : '';
        $('bp-len-' + lg + '-' + k).value = v === undefined ? '' : v;
      });
      $('bp-ln-' + lg).value = (bp.language_notes && bp.language_notes[lg]) || '';
    });
    $('bp-examples').value = JSON.stringify(bp.examples || [], null, 2);
  }

  async function loadBlueprint(ref) {
    hideError($('bpErr'));
    show($('bpMsg'), false);
    var ch = $('bpChar').value;
    var r = await api('/api/blueprint' + qs(ch, ref));
    if (!r.ok) { showError($('bpErr'), r.message); return; }
    editing = { ref: ref, bp: r.data, char: ch };
    bpCache[cacheKey(ch, ref)] = r.data;
    fillForm(r.data);
  }

  function lines(id) {
    return $(id).value.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
  }

  function collectForm() {
    var base = editing.bp;
    var bp = {
      format: base.format, version: base.version, made: base.made, based_on: base.based_on === undefined ? null : base.based_on,
      title: $('bp-title').value.trim(), note: $('bp-note').value.trim(),
      persona: $('bp-persona').value.trim(), core_rule: $('bp-core_rule').value.trim()
    };
    var avg = isAvg(editing.char || $('bpChar').value);
    var types = Array.prototype.map.call($('netaList').children, function (item) {
      return {
        id: item.querySelector('.neta-id').value.trim(),
        name: item.querySelector('.neta-name').value.trim(),
        how: item.querySelector('.neta-how').value.trim()
      };
    });
    if (avg) bp.step_types = types; else bp.neta_types = types;
    (avg ? LIST_FIELDS_AVG : LIST_FIELDS).forEach(function (k) { bp[k] = lines('bp-' + k); });
    if (!avg) bp.shout_line = { ja: $('bp-shout-ja').value.trim(), en: $('bp-shout-en').value.trim() };
    bp.length = { ja: {}, en: {} };
    ['ja', 'en'].forEach(function (lg) {
      ['say', 'instruction', 'why_it_works'].forEach(function (k) {
        bp.length[lg][k] = Number($('bp-len-' + lg + '-' + k).value);
      });
    });
    bp.language_notes = { ja: $('bp-ln-ja').value.trim(), en: $('bp-ln-en').value.trim() };
    var ex;
    try { ex = JSON.parse($('bp-examples').value || '[]'); }
    catch (e) { throw new Error('「上級: お手本の会話」の JSON が読めません。書き方をたしかめてください。'); }
    if (!Array.isArray(ex)) throw new Error('「上級: お手本の会話」は、[ ] で囲んだ一覧で書いてください。');
    bp.examples = ex;
    if (!avg && base.variety) bp.variety = base.variety;
    if (typeof base.always_action === 'boolean') bp.always_action = base.always_action; // 毎回、答えを出すか(画面では直さない。そのまま引き継ぐ) // 毎回ちがう答えにするための種の一覧(画面では直さない。そのまま引き継ぐ)
    return bp;
  }

  async function saveDraft() {
    hideError($('bpErr'));
    show($('bpMsg'), false);
    if (!editing) { showError($('bpErr'), '設計図がまだ読み込まれていません。'); return; }
    var bp;
    try { bp = collectForm(); } catch (e) { showError($('bpErr'), e.message); return; }
    $('bpSave').disabled = true;
    var ch = editing.char || $('bpChar').value;
    var r = await api('/api/blueprint', { char: ch, base: editing.ref, blueprint: bp });
    $('bpSave').disabled = false;
    if (!r.ok) { showError($('bpErr'), r.message); return; }
    var newRef = r.data.ref;
    bpCache[cacheKey(ch, newRef)] = r.data.blueprint;
    await loadState();
    var savedItem = (charInfo(ch).blueprints || []).filter(function (b) { return b.ref === newRef; })[0];
    $('bpMsg').textContent = (savedItem ? refLabel(savedItem) : newRef) + ' として保存しました。会話タブで選べます。';
    show($('bpMsg'), true);
    $('bpRef').value = newRef;
    editing = { ref: newRef, bp: r.data.blueprint, char: ch };
  }

  async function showSystem() {
    hideError($('bpErr'));
    var ref = $('bpRef').value;
    var lang = $('chatLang').value;
    var r = await api('/api/system' + qs($('bpChar').value, ref, '&lang=' + encodeURIComponent(lang)));
    if (!r.ok) { showError($('bpErr'), r.message); return; }
    $('sysTitle').textContent = '指示文の全文(' + r.data.ref + '・' + (r.data.lang === 'en' ? 'English' : '日本語') + ')';
    $('sysPre').textContent = r.data.system;
    show($('sysWrap'), true);
  }

  // ---------- 記録とまとめ ----------
  async function makeSummary() {
    hideError($('sumErr'));
    $('sumCopyMsg').textContent = '';
    var days = parseInt($('sumDays').value, 10);
    if (!(days >= 1 && days <= 30)) { showError($('sumErr'), '日数は 1〜30 の数で入れてください。'); return; }
    $('sumMake').disabled = true;
    var r = await api('/api/summary', {
      char: $('sumChar').value, days: days, onlyRated: $('sumRated').checked, includeDraft: $('sumDraft').value || null
    });
    $('sumMake').disabled = false;
    if (!r.ok) { showError($('sumErr'), r.message); return; }
    $('sumText').value = r.data.markdown;
    show($('sumOut'), true);
  }

  async function copySummary() {
    var ta = $('sumText');
    try {
      await navigator.clipboard.writeText(ta.value);
      $('sumCopyMsg').textContent = 'コピーしました。Claude とのチャットに貼ってください。';
    } catch (e) {
      ta.focus();
      ta.select();
      $('sumCopyMsg').textContent = 'コピーできませんでした。選んだ状態にしたので、Ctrl+C(Mac は Cmd+C)でコピーしてください。';
    }
  }

  // ---------- start ----------
  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });
    $('chatText').addEventListener('input', updateSend);
    $('chatText').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); }
    });
    $('sendBtn').addEventListener('click', send);
    $('newConv').addEventListener('click', newConversation);
    $('chatChar').addEventListener('change', function () { fillRefSelect($('chatRef'), $('chatChar')); renderChatChar(); });
    $('bpChar').addEventListener('change', function () {
      fillRefSelect($('bpRef'), $('bpChar'));
      renderBpChar();
      editing = null;
      show($('sysWrap'), false);
      loadBlueprint($('bpRef').value);
    });
    $('sumChar').addEventListener('change', fillDraftSelect);
    $('bpRef').addEventListener('change', function () { loadBlueprint($('bpRef').value); });
    $('netaAdd').addEventListener('click', function () { addNetaRow(null); });
    $('bpSave').addEventListener('click', saveDraft);
    $('bpSystem').addEventListener('click', showSystem);
    $('bpForm').addEventListener('submit', function (e) { e.preventDefault(); });
    $('sumMake').addEventListener('click', makeSummary);
    $('sumCopy').addEventListener('click', copySummary);
  }

  async function start() {
    bind();
    updateSend();
    await loadState();
  }
  start();
})();
