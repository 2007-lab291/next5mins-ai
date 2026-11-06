// 設計図(バカの性格の決まり)の読み書きと確かめ(1章)。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReply, cpLen } from './schema.mjs';

export const BLUEPRINT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'blueprints');

const REF_RE = /^(official:v\d{3}|draft:d\d{3})$/;
export const refOk = ref => typeof ref === 'string' && REF_RE.test(ref);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = msg => { throw new Error('設計図がだめです: ' + msg); };

export function onlyKeys(o, keys, where) {
  if (!isObj(o)) fail(`${where} は、{ } の形でなければいけません`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${where} に、知らないキー「${k}」があります`);
  for (const k of keys) if (!Object.hasOwn(o, k)) fail(`${where} に、キー「${k}」がありません`);
}
export function text(v, min, max, where) {
  if (typeof v !== 'string') fail(`${where} は、文字でなければいけません`);
  const n = cpLen(v);
  if (min > 0 && v.trim() === '') fail(`${where} が空です`);
  if (n < min || n > max) fail(`${where} の長さは ${min}〜${max} 文字にしてください(いま ${n} 文字)`);
  return v;
}
export function list(v, min, max, where) {
  if (!Array.isArray(v)) fail(`${where} は、並び([ ])でなければいけません`);
  if (v.length < min || v.length > max) fail(`${where} は ${min}〜${max} 個にしてください(いま ${v.length} 個)`);
  return v;
}
export function textList(v, max, where) {
  return list(v, 0, 30, where).map((s, i) => text(s, 1, max, `${where}[${i}]`));
}
export function intIn(v, min, max, where) {
  if (!Number.isInteger(v)) fail(`${where} は、整数でなければいけません`);
  if (v < min || v > max) fail(`${where} は ${min}〜${max} にしてください(いま ${v})`);
  return v;
}

export const VARIETY_KEYS = ['stages', 'characters', 'styles'];
const TOP = ['format', 'version', 'title', 'made', 'based_on', 'note', 'persona', 'core_rule', 'neta_types',
  'rules', 'banned', 'conversation_rules', 'item_rules', 'shout_line', 'length', 'language_notes', 'examples'];

// 指示文の区切りの札に見える文字(< >)と、``` は、どの文にも使えない(指示文に入るため)。
// 全角・似た形のかっこ(＜＞〈〉‹›⟨⟩ など)も、全角を半角にそろえた写しで見て断る。
// 見えない書式の文字(文字の向きを変える文字・タグ文字など)と、改行・タブ以外の制御文字も断る。
const LOOKS_LIKE_TAG = /[<>\u2039\u203a\u2329\u232a\u27e8\u27e9\u3008\u3009\ufe64\ufe65]/;
const HIDDEN = /[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
export function noMarkup(v, where) {
  if (typeof v === 'string') {
    const n = v.normalize('NFKC');
    if (LOOKS_LIKE_TAG.test(v) || LOOKS_LIKE_TAG.test(n) || v.includes('```') || n.includes('```')) {
      fail(`${where} に「<」「>」(全角や似た形のかっこも)「\`\`\`」は使えません`);
    }
    if (HIDDEN.test(v.replace(/\u200d|\ufe0f/g, ''))) fail(`${where} に見えない文字(書式の文字・制御文字)は使えません`);
  } else if (Array.isArray(v)) v.forEach((x, i) => noMarkup(x, `${where}[${i}]`));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) noMarkup(x, where ? `${where}.${k}` : k);
}

export function checkBlueprint(obj) {
  if (!isObj(obj)) fail('全体が { } の形ではありません');
  if (Buffer.byteLength(JSON.stringify(obj), 'utf8') > 100 * 1024) fail('ファイルが大きすぎます(100KB まで)');
  // variety(毎回ちがう答えにするための種の一覧)は、無くてもよい。あれば下で検査する(2026-11-06。社長の指示「毎回違うことを言ってきたほうがいいからバリエーションを増やして」)
  // always_action(毎回、答え=行動カードを出す)も、無くてもよい(社長の指示 2026-11-06「無限に会話が続くよね。毎回答えを出すようにして。そのあと続けていいから」)
  const { variety: _variety, always_action: _always, ...withoutVariety } = obj;
  onlyKeys(withoutVariety, TOP, '設計図');
  noMarkup(obj, '設計図');
  if (obj.format !== 'next5mins-idiot-blueprint/1') fail('format は "next5mins-idiot-blueprint/1" にしてください');
  if (typeof obj.version !== 'string' || !/^[vd]\d{3}$/.test(obj.version)) fail('version は v001 や d001 の形にしてください');
  const made = text(obj.made, 10, 10, 'made');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(made) || Number.isNaN(Date.parse(made + 'T00:00:00Z'))
    || new Date(made + 'T00:00:00Z').toISOString().slice(0, 10) !== made) fail('made は YYYY-MM-DD の日付にしてください');
  if (obj.based_on !== null && !refOk(obj.based_on)) fail('based_on は null か、official:v001 のような参照にしてください');

  const bp = {
    format: obj.format,
    version: obj.version,
    title: text(obj.title, 1, 60, 'title'),
    made,
    based_on: obj.based_on,
    note: text(obj.note, 0, 1000, 'note'),
    persona: text(obj.persona, 1, 2000, 'persona'),
    core_rule: text(obj.core_rule, 1, 1000, 'core_rule'),
  };

  const seen = new Set();
  bp.neta_types = list(obj.neta_types, 1, 60, 'neta_types').map((n, i) => {
    const w = `neta_types[${i}]`;
    onlyKeys(n, ['id', 'name', 'how'], w);
    if (typeof n.id !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(n.id)) fail(`${w}.id は、英小文字で始まる英小文字・数字・_ の 2〜31 文字にしてください`);
    if (seen.has(n.id)) fail(`${w}.id「${n.id}」が、ほかと重なっています`);
    seen.add(n.id);
    const name = text(n.name, 1, 30, `${w}.name`);
    const how = text(n.how, 1, 600, `${w}.how`);
    // 指示文にそのまま入るので、1行だけ・< > なし(偽の区切りを書けないように。安全点検 2026-11-06)
    for (const [t, k] of [[name, 'name'], [how, 'how']]) if (/[\r\n\t\u0085\u2028\u2029<>]/.test(t)) fail(`${w}.${k} は1行で書いてください(改行・タブ・< > は使えません)`);
    return { id: n.id, name, how };
  });
  const howTotal = bp.neta_types.reduce((s, n) => s + cpLen(n.how), 0);
  if (howTotal > 12000) fail(`neta_types の how の合計は 12000 文字までにしてください(いま ${howTotal} 文字)`);

  bp.rules = textList(obj.rules, 400, 'rules');
  bp.banned = textList(obj.banned, 400, 'banned');
  bp.conversation_rules = textList(obj.conversation_rules, 400, 'conversation_rules');
  bp.item_rules = textList(obj.item_rules, 400, 'item_rules');

  onlyKeys(obj.shout_line, ['ja', 'en'], 'shout_line');
  bp.shout_line = { ja: text(obj.shout_line.ja, 1, 80, 'shout_line.ja'), en: text(obj.shout_line.en, 1, 80, 'shout_line.en') };

  onlyKeys(obj.length, ['ja', 'en'], 'length');
  bp.length = {};
  for (const [lg, lo, hi] of [['ja', 10, 400], ['en', 5, 120]]) {
    const L = obj.length[lg];
    onlyKeys(L, ['say', 'instruction', 'why_it_works'], `length.${lg}`);
    bp.length[lg] = {
      say: intIn(L.say, lo, hi, `length.${lg}.say`),
      instruction: intIn(L.instruction, lo, hi, `length.${lg}.instruction`),
      why_it_works: intIn(L.why_it_works, lo, hi, `length.${lg}.why_it_works`),
    };
  }

  onlyKeys(obj.language_notes, ['ja', 'en'], 'language_notes');
  bp.language_notes = {
    ja: text(obj.language_notes.ja, 0, 1000, 'language_notes.ja'),
    en: text(obj.language_notes.en, 0, 1000, 'language_notes.en'),
  };

  if (Object.hasOwn(obj, 'always_action')) {
    if (typeof obj.always_action !== 'boolean') fail('always_action は true か false にしてください');
    bp.always_action = obj.always_action;
  }
  if (Object.hasOwn(obj, 'variety')) {
    onlyKeys(obj.variety, VARIETY_KEYS, 'variety');
    bp.variety = {};
    for (const k of VARIETY_KEYS) bp.variety[k] = list(obj.variety[k], 0, 80, `variety.${k}`).map((s, i) => {
      const t = text(s, 1, 120, `variety.${k}[${i}]`);
      if (/[\r\n\t\u0085\u2028\u2029]/.test(t)) fail(`variety.${k}[${i}] は1行で書いてください(改行・タブは使えません)`);
      return t;
    });
  }

  bp.examples = list(obj.examples, 0, 12, 'examples').map((ex, i) => {
    const w = `examples[${i}]`;
    onlyKeys(ex, ['lang', 'label', 'turns'], w);
    if (ex.lang !== 'ja' && ex.lang !== 'en') fail(`${w}.lang は "ja" か "en" にしてください`);
    const label = text(ex.label, 1, 60, `${w}.label`);
    const turns = list(ex.turns, 1, 4, `${w}.turns`).map((t, j) => {
      const tw = `${w}.turns[${j}]`;
      onlyKeys(t, ['user', 'reply'], tw);
      const user = text(t.user, 1, 400, `${tw}.user`);
      if (isObj(t.reply) && t.reply.mode !== 'normal') fail(`${tw}.reply.mode は "normal" だけにしてください`);
      const checked = checkReply(t.reply, { lang: ex.lang, first: j === 0, blueprint: bp });
      if (!checked) fail(`${tw}.reply が、バカの答えの形になっていません`);
      if (checked.problems.length) fail(`${tw}.reply に問題があります(${checked.problems.join('、')})`);
      return { user, reply: checked.reply };
    });
    return { lang: ex.lang, label, turns };
  });

  return bp;
}

export function loadOfficial(version) {
  if (typeof version !== 'string' || !/^v\d{3}$/.test(version)) throw new Error('公式の版は v001 の形で指定してください');
  let raw;
  try { raw = readFileSync(join(BLUEPRINT_DIR, version + '.json'), 'utf8'); }
  catch { throw new Error(`公式の設計図 ${version} が見つかりません`); }
  let obj;
  try { obj = JSON.parse(raw); } catch { throw new Error(`公式の設計図 ${version} の JSON が読めません`); }
  const bp = checkBlueprint(obj);
  if (bp.version !== version) throw new Error(`公式の設計図 ${version} の version が合っていません`);
  return bp;
}

export function listOfficial() {
  let names;
  try { names = readdirSync(BLUEPRINT_DIR); } catch { return []; }
  return names
    .map(n => /^(v\d{3})\.json$/.exec(n)?.[1])
    .filter(Boolean)
    .sort()
    .map(v => {
      const bp = loadOfficial(v);
      return { ref: 'official:' + v, version: v, title: bp.title, made: bp.made, note: bp.note };
    });
}
