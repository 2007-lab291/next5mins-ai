// 神の設計図の読み書きと確かめ(8-2)。確かめの道具はバカのものを使う(noMarkup は1つだけ)。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onlyKeys, text, list, textList, intIn, noMarkup } from '../blueprint.mjs';
import { cpLen } from '../schema.mjs';
import { checkGodReply } from './schema.mjs';

export const GOD_BLUEPRINT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'blueprints');

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = msg => { throw new Error('設計図がだめです: ' + msg); };
const REF_RE = /^(official:v\d{3}|draft:d\d{3})$/;

const TOP = ['format', 'version', 'title', 'made', 'based_on', 'note', 'persona', 'core_rule', 'power_types',
  'rules', 'banned', 'conversation_rules', 'length', 'language_notes', 'examples'];

export function checkGodBlueprint(obj) {
  if (!isObj(obj)) fail('全体が { } の形ではありません');
  if (Buffer.byteLength(JSON.stringify(obj), 'utf8') > 100 * 1024) fail('ファイルが大きすぎます(100KB まで)');
  const { always_action: _always, ...without } = obj;
  onlyKeys(without, TOP, '設計図');
  noMarkup(obj, '設計図');
  if (obj.format !== 'next5mins-god-blueprint/1') fail('format は "next5mins-god-blueprint/1" にしてください');
  if (typeof obj.version !== 'string' || !/^[vd]\d{3}$/.test(obj.version)) fail('version は v001 や d001 の形にしてください');
  const made = text(obj.made, 10, 10, 'made');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(made) || Number.isNaN(Date.parse(made + 'T00:00:00Z'))
    || new Date(made + 'T00:00:00Z').toISOString().slice(0, 10) !== made) fail('made は YYYY-MM-DD の日付にしてください');
  if (obj.based_on !== null && !(typeof obj.based_on === 'string' && REF_RE.test(obj.based_on))) fail('based_on は null か、official:v001 のような参照にしてください');

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
  bp.power_types = list(obj.power_types, 1, 60, 'power_types').map((n, i) => {
    const w = `power_types[${i}]`;
    onlyKeys(n, ['id', 'name', 'how'], w);
    if (typeof n.id !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(n.id)) fail(`${w}.id は、英小文字で始まる英小文字・数字・_ の 2〜31 文字にしてください`);
    if (seen.has(n.id)) fail(`${w}.id「${n.id}」が、ほかと重なっています`);
    seen.add(n.id);
    const name = text(n.name, 1, 30, `${w}.name`);
    const how = text(n.how, 1, 600, `${w}.how`);
    for (const [t, k] of [[name, 'name'], [how, 'how']]) if (/[\r\n\t\u0085\u2028\u2029<>]/.test(t)) fail(`${w}.${k} は1行で書いてください(改行・タブ・< > は使えません)`);
    return { id: n.id, name, how };
  });
  const howTotal = bp.power_types.reduce((s, n) => s + cpLen(n.how), 0);
  if (howTotal > 12000) fail(`power_types の how の合計は 12000 文字までにしてください(いま ${howTotal} 文字)`);

  bp.rules = textList(obj.rules, 400, 'rules');
  bp.banned = textList(obj.banned, 400, 'banned');
  bp.conversation_rules = textList(obj.conversation_rules, 400, 'conversation_rules');

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
      const checked = checkGodReply(t.reply, { lang: ex.lang, first: j === 0, blueprint: bp });
      if (!checked) fail(`${tw}.reply が、神の答えの形になっていません`);
      if (checked.problems.length) fail(`${tw}.reply に問題があります(${checked.problems.join('、')})`);
      return { user, reply: checked.reply };
    });
    return { lang: ex.lang, label, turns };
  });

  return bp;
}

export function loadGodOfficial(version) {
  if (typeof version !== 'string' || !/^v\d{3}$/.test(version)) throw new Error('公式の版は v001 の形で指定してください');
  let raw;
  try { raw = readFileSync(join(GOD_BLUEPRINT_DIR, version + '.json'), 'utf8'); }
  catch { throw new Error(`神の公式の設計図 ${version} が見つかりません`); }
  let obj;
  try { obj = JSON.parse(raw); } catch { throw new Error(`神の公式の設計図 ${version} の JSON が読めません`); }
  const bp = checkGodBlueprint(obj);
  if (bp.version !== version) throw new Error(`神の公式の設計図 ${version} の version が合っていません`);
  return bp;
}

export function listGodOfficial() {
  let names;
  try { names = readdirSync(GOD_BLUEPRINT_DIR); } catch { return []; }
  return names
    .map(n => /^(v\d{3})\.json$/.exec(n)?.[1])
    .filter(Boolean)
    .sort()
    .map(v => {
      const bp = loadGodOfficial(v);
      return { ref: 'official:' + v, version: v, title: bp.title, made: bp.made, note: bp.note };
    });
}
