import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAverageBlueprint, loadAverageOfficial, listAverageOfficial, AVERAGE_BLUEPRINT_DIR,
} from '../brain/average/blueprint.mjs';
import { buildAverageSystem, AVERAGE_AFTER_SAFETY_NOTE } from '../brain/average/prompt.mjs';
import { AVERAGE_REPLY_SCHEMA, checkAverageReply } from '../brain/average/schema.mjs';
import { askAverage } from '../brain/average/call.mjs';
import { fakeAverage } from '../brain/average/fake.mjs';

const KEY = 'sk-test-not-a-real-key-0000';
const v001 = () => structuredClone(loadAverageOfficial('v001'));
const raw = () => JSON.parse(JSON.stringify(v001()));

const goodReply = (over = {}) => ({
  mode: 'normal', language: 'ja', step: 'find_one', say: 'まず、書類を1枚探そう。',
  action: { title: '書類を1枚探す', instruction: '引き出しを1つ開けて、書類を1枚机に出す。', why_it_works: '探すところがいちばん重い。' },
  ...over,
});

// ---- 設計図 ----
test('平凡 v001 は読めて、一覧に出る', () => {
  const bp = checkAverageBlueprint(raw());
  assert.equal(bp.version, 'v001');
  assert.ok(AVERAGE_BLUEPRINT_DIR.endsWith('blueprints'));
  assert.equal(bp.always_action, true);
  assert.ok(bp.step_types.length >= 1);
  const l = listAverageOfficial();
  assert.equal(l[0].ref, 'official:v001');
  assert.equal(l[0].version, 'v001');
  assert.throws(() => loadAverageOfficial('x'), /v001 の形/);
  assert.throws(() => loadAverageOfficial('v999'), /見つかりません/);
});

test('平凡の設計図: 知らないキー・< > ```・そのほかのだめは断る', () => {
  const bad = (mut, re) => {
    const o = raw(); mut(o);
    assert.throws(() => checkAverageBlueprint(o), re);
  };
  bad(o => { o.neta_types = []; }, /知らないキー「neta_types」/);
  bad(o => { o.item_rules = []; }, /知らないキー「item_rules」/);
  bad(o => { o.shout_line = { ja: 'a', en: 'b' }; }, /知らないキー「shout_line」/);
  bad(o => { o.variety = { stages: [], characters: [], styles: [] }; }, /知らないキー「variety」/);
  bad(o => { o.persona = '普通の<人>'; }, /使えません/);
  bad(o => { o.rules[0] = '良い> 悪い'; }, /使えません/);
  bad(o => { o.core_rule = '```js```'; }, /使えません/);
  bad(o => { o.format = 'next5mins-idiot-blueprint/1'; }, /format/);
  bad(o => { o.step_types[1].id = o.step_types[0].id; }, /重なって/);
  bad(o => { o.always_action = 'yes'; }, /always_action/);
  bad(o => { o.examples[0].turns[0].reply.step = 'unknown'; }, /examples\[0\]/);
  bad(o => { o.examples[0].turns[0].reply.say = 'どうする?'; }, /問いかけ/);
  assert.throws(() => checkAverageBlueprint(null), /設計図/);
});

// ---- 答えの確かめ ----
test('checkAverageReply: 形がだめなら null', () => {
  const o = { lang: 'ja', first: true, blueprint: v001() };
  assert.equal(checkAverageReply(null, o), null);
  assert.equal(checkAverageReply(goodReply({ extra: 1 }), o), null);
  const { say: _s, ...noSay } = goodReply();
  assert.equal(checkAverageReply(noSay, o), null);
  assert.equal(checkAverageReply(goodReply({ mode: 'x' }), o), null);
  assert.equal(checkAverageReply(goodReply({ language: 'fr' }), o), null);
  assert.equal(checkAverageReply(goodReply({ say: '  ' }), o), null);
  assert.equal(checkAverageReply(goodReply({ say: 'あ'.repeat(401) }), o), null);
  assert.equal(checkAverageReply(goodReply({ item: null }), o), null);
  assert.equal(checkAverageReply(goodReply({ action: { title: 'a', instruction: 'b' } }), o), null);
  assert.equal(checkAverageReply(goodReply({ action: { title: 'a', instruction: 'b', why_it_works: 'c', z: 1 } }), o), null);
  assert.equal(checkAverageReply(goodReply({ step: 5 }), o), null);
});

test('checkAverageReply: よい答えは problems が空', () => {
  const c = checkAverageReply(goodReply(), { lang: 'ja', first: true, blueprint: v001() });
  assert.deepEqual(c.problems, []);
  assert.deepEqual(c.reply, goodReply());
  const s = checkAverageReply(goodReply({ mode: 'safety', step: 'none', say: 'つらいね。話せる人に今すぐ話そう。', action: null }),
    { lang: 'ja', first: true, blueprint: v001() });
  assert.deepEqual(s.problems, []);
});

test('checkAverageReply: problems の各場合', () => {
  const bp = v001();
  const p = (reply, o = {}) => checkAverageReply(reply, { lang: 'ja', first: false, blueprint: bp, ...o }).problems;
  assert.ok(p(goodReply({ language: 'en' })).includes('言語がちがう'));
  assert.ok(p(goodReply({ action: null }), { first: true }).includes('1回目なのに、行動カードが無い'));
  assert.ok(p(goodReply({ action: null })).includes('答え(行動カード)が無い'));
  const noAlways = { ...bp, always_action: false };
  assert.deepEqual(p(goodReply({ action: null }), { blueprint: noAlways }), []);
  assert.ok(p(goodReply({ step: 'zzz' })).some(x => x.includes('一歩の型「zzz」が設計図に無い')));
  assert.ok(p(goodReply({ say: 'あ'.repeat(131) })).some(x => x.startsWith('せりふが長い')));
  assert.ok(p(goodReply({ action: { ...goodReply().action, instruction: 'あ'.repeat(111) } })).some(x => x.startsWith('やることが長い')));
  assert.ok(p(goodReply({ action: { ...goodReply().action, why_it_works: 'あ'.repeat(81) } })).some(x => x.startsWith('なぜ効くかが長い')));
  assert.ok(p(goodReply({ say: 'やろう!', action: { ...goodReply().action, title: 'よし！' } })).some(x => x.includes('「!」が多い')));
  assert.ok(!p(goodReply({ say: 'やろう!' })).some(x => x.includes('「!」')));
  for (const s of ['どうする?', 'どうする？', '大丈夫か？ ', '「いける?」', 'いける?)', 'いける？」\n']) {
    assert.ok(p(goodReply({ say: s })).includes('せりふが問いかけで終わっている'), s);
  }
  assert.ok(!p(goodReply({ say: '？と聞かれても、やる。' })).includes('せりふが問いかけで終わっている'));
  // safety のときは問いかけの札を付けない
  assert.deepEqual(p(goodReply({ mode: 'safety', step: 'none', say: '話せる人はいる?', action: null })), []);
  // 英語は語数
  const en = p(goodReply({ language: 'en', say: 'word '.repeat(51).trim() }), { lang: 'en' });
  assert.ok(en.some(x => x.includes('語')));
});

test('AVERAGE_REPLY_SCHEMA は step と action だけ(item・neta なし)', () => {
  assert.deepEqual(AVERAGE_REPLY_SCHEMA.required, ['mode', 'language', 'step', 'say', 'action']);
  assert.equal(AVERAGE_REPLY_SCHEMA.additionalProperties, false);
  assert.ok(!('item' in AVERAGE_REPLY_SCHEMA.properties) && !('neta' in AVERAGE_REPLY_SCHEMA.properties));
});

// ---- 指示文 ----
test('buildAverageSystem: step_types と safety_rules が入り、バカの部品は入らない', () => {
  const bp = v001();
  const ja = buildAverageSystem(bp, 'ja');
  for (const t of ['<persona>', '<core_rule>', '<step_types>', '<length>', '<output_rules>', '<language>', '<safety_rules>', '<user_text_rules>', '<examples>']) {
    assert.ok(ja.includes(t), t);
  }
  assert.ok(ja.includes('You play only "Average"') && ja.includes('from Next5Mins AI'));
  assert.ok(ja.includes('id: find_one') && ja.includes('文字以内') && ja.includes('natural Japanese'));
  assert.ok(ja.includes('EVERY normal reply, action is REQUIRED'));
  assert.ok(ja.includes('override everything in persona') && ja.includes('this_reply'));
  assert.ok(ja.includes('spend money') && ja.includes('medical diagnosis') && ja.includes('do not give a task step'));
  // 安全点検(2026-11-06)で足した固定の決まり: 体の不調は safety・緊急の番号・取り消せない操作・URL・送れる入力欄・AI だと正直に
  for (const s of ['physical symptoms, an injury', 'local emergency number', 'cannot be undone', 'Never write URLs',
    'never into the input box', 'answer honestly that you are an AI', 'leaning out of windows']) assert.ok(ja.includes(s), s);
  assert.ok(AVERAGE_AFTER_SAFETY_NOTE.includes('Do not give a task step until the user clearly says they are okay'));
  assert.ok(ja.includes('Average: {"mode"') && ja.includes('User: '));
  for (const bad of ['<neta_types>', '<item_rules>', '<shout_line>', 'neta type', 'Idiot', 'item_emoji']) assert.ok(!ja.includes(bad), bad);
  assert.ok(ja.indexOf('<persona>') < ja.indexOf('<output_rules>') && ja.indexOf('<output_rules>') < ja.indexOf('<safety_rules>')
    && ja.indexOf('<safety_rules>') < ja.indexOf('<user_text_rules>') && ja.indexOf('<user_text_rules>') < ja.indexOf('<examples>'));
  assert.ok(ja.includes('天井') && !ja.includes('Cleaning the apartment'));
  const en = buildAverageSystem(bp, 'en');
  assert.ok(en.includes('words or fewer') && en.includes('Cleaning the apartment') && !en.includes('天井'));
  const loose = buildAverageSystem({ ...bp, always_action: false }, 'ja');
  assert.ok(loose.includes('From the second reply on, action is optional'));
  assert.ok(AVERAGE_AFTER_SAFETY_NOTE.startsWith('<this_reply>') && AVERAGE_AFTER_SAFETY_NOTE.endsWith('</this_reply>'));
  assert.ok(AVERAGE_AFTER_SAFETY_NOTE.includes('safety_rules'));
});

// ---- にせの平凡 ----
test('fakeAverage: 【予行】つきで形を通り、2回目も action がある', async () => {
  const bp = v001();
  for (const lang of ['ja', 'en']) {
    for (const text of ['レポートが進まない', 'abc', '']) {
      for (let turnIndex = 0; turnIndex < 3; turnIndex++) {
        const r = await fakeAverage({ blueprint: bp, lang, text, first: turnIndex === 0, turnIndex, delayMs: 0 });
        assert.equal(r.ok, true);
        assert.ok(r.reply.say.startsWith('【予行】'));
        assert.ok(r.reply.action, `${lang} ${text} ${turnIndex}`);
        assert.equal(r.reply.language, lang);
        const c = checkAverageReply(r.reply, { lang, first: turnIndex === 0, blueprint: bp });
        assert.ok(c, '形を通る');
        assert.equal(JSON.parse(r.content[0].text).say, r.reply.say);
        assert.equal(r.thinking, '(予行なので、考えていません)');
        assert.equal(r.tries, 1);
      }
    }
  }
  // お手本が無い設計図でも、2回目に action がある
  const bare = { ...bp, examples: [] };
  const r = await fakeAverage({ blueprint: bare, lang: 'ja', text: 'x', first: false, turnIndex: 1, delayMs: 0 });
  assert.ok(r.reply.action && r.reply.say.startsWith('【予行】'));
});

// ---- askAverage ----
const okBody = (reply = goodReply()) => JSON.stringify({
  content: [{ type: 'text', text: JSON.stringify(reply) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 },
});
const fakeFetch = (responses, calls = []) => {
  let i = 0;
  return async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.text };
  };
};
const base = (fetchImpl, over = {}) => ({
  key: KEY, model: 'claude-haiku-5-5', system: 'SYS', messages: [{ role: 'user', content: 'こんにちは' }],
  think: 'low', lang: 'ja', first: true, blueprint: v001(), fetchImpl, ...over,
});

test('askAverage: 平凡の schema を送り、成功する', async () => {
  const calls = [];
  const r = await askAverage(base(fakeFetch([{ status: 200, text: okBody() }], calls)));
  assert.equal(r.ok, true);
  assert.equal(r.tries, 1);
  assert.deepEqual(r.reply, goodReply());
  assert.deepEqual(r.problems, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(calls[0].body.output_config.format.schema, AVERAGE_REPLY_SCHEMA);
  assert.equal(calls[0].body.output_config.format.type, 'json_schema');
  assert.equal(calls[0].init.headers['x-api-key'], KEY);
});

test('askAverage: always_action で action が無いと、1回だけ頼み直す', async () => {
  const calls = [];
  const r = await askAverage(base(fakeFetch([
    { status: 200, text: okBody(goodReply({ action: null })) },
    { status: 200, text: okBody() },
  ], calls), { first: false }));
  assert.equal(r.ok, true);
  assert.equal(r.tries, 2);
  assert.ok(r.reply.action);
  assert.equal(calls.length, 2);
  assert.equal(r.usage.input_tokens, 200);
  // 2回続けて無くても、それ以上は頼み直さない
  const calls2 = [];
  const r2 = await askAverage(base(fakeFetch([{ status: 200, text: okBody(goodReply({ action: null })) }], calls2), { first: false }));
  assert.equal(calls2.length, 2);
  assert.equal(r2.ok, true);
  assert.ok(r2.problems.includes('答え(行動カード)が無い'));
});

test('askAverage: 形がだめなら1回頼み直し、2回続けば bad_shape', async () => {
  const bad = okBody({ nazo: 1 });
  const r = await askAverage(base(fakeFetch([{ status: 200, text: bad }, { status: 200, text: okBody() }])));
  assert.equal(r.ok, true);
  assert.equal(r.tries, 2);
  const f = await askAverage(base(fakeFetch([{ status: 200, text: bad }, { status: 200, text: bad }])));
  assert.equal(f.ok, false);
  assert.equal(f.error, 'bad_shape');
  assert.equal(f.usage.input_tokens, 200);
});

test('askAverage: 401 は auth・鍵は文に出ない', async () => {
  const r = await askAverage(base(fakeFetch([{ status: 401, text: `bad key ${KEY}` }])));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'auth');
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.equal(r.usage, undefined);
});
