// 神の答えの形(8-3)と、その確かめ。バカの schema.mjs の道具(文字数の数え方)を使う。
import { cpLen, wordCount } from '../schema.mjs';
import { endsWithQuestion } from '../average/schema.mjs';

const str = { type: 'string' };

// API に渡す JSON Schema。数の制約(minLength など)は、API が受けつけないので使わない。
export const GOD_REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'language', 'power', 'say', 'action'],
  properties: {
    mode: { type: 'string', enum: ['normal', 'safety'] },
    language: { type: 'string', enum: ['ja', 'en'] },
    power: str,
    say: str,
    action: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'instruction', 'why_it_works'],
          properties: { title: str, instruction: str, why_it_works: str },
        },
        { type: 'null' },
      ],
    },
  },
};

const MAX = { power: 100, say: 400, title: 80, instruction: 400, why_it_works: 300 };
const ACTION_KEYS = ['title', 'instruction', 'why_it_works'];
const TOP_KEYS = ['mode', 'language', 'power', 'say', 'action'];
const LEN_JA = { say: 'せりふ', instruction: 'やること', why_it_works: 'なぜ効くか' };

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (o, keys) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every(x => Object.hasOwn(o, x));
};
const okText = (v, max) => typeof v === 'string' && v.trim() !== '' && cpLen(v) <= max;

// 返すもの: null(形がだめ=やり直し)か { reply, problems }
export function checkGodReply(obj, { lang, first = false, blueprint } = {}) {
  if (!isObj(obj) || !sameKeys(obj, TOP_KEYS)) return null;
  if (obj.mode !== 'normal' && obj.mode !== 'safety') return null;
  if (obj.language !== 'ja' && obj.language !== 'en') return null;
  if (!okText(obj.power, MAX.power) || !okText(obj.say, MAX.say)) return null;

  let action = null;
  if (obj.action !== null) {
    const a = obj.action;
    if (!isObj(a) || !sameKeys(a, ACTION_KEYS)) return null;
    if (!ACTION_KEYS.every(k => okText(a[k], MAX[k]))) return null;
    action = { title: a.title, instruction: a.instruction, why_it_works: a.why_it_works };
  }
  const reply = { mode: obj.mode, language: obj.language, power: obj.power, say: obj.say, action };

  const problems = [];
  if (lang && obj.language !== lang) problems.push('言語がちがう');
  if (obj.mode === 'normal') {
    if (!action) {
      if (first) problems.push('1回目なのに、行動カードが無い');
      else if (blueprint?.always_action) problems.push('答え(行動カード)が無い');
    }
    if (blueprint?.power_types && !blueprint.power_types.some(n => n.id === obj.power)) {
      problems.push(`力の型「${obj.power}」が設計図に無い`);
    }
  }
  const lim = blueprint?.length?.[lang];
  if (lim) {
    const measure = lang === 'en' ? wordCount : cpLen;
    const unit = lang === 'en' ? '語' : '文字';
    const over = (name, t) => {
      if (t != null && lim[name] != null && measure(t) > lim[name]) {
        problems.push(`${LEN_JA[name] || name}が長い(${measure(t)}${unit}。上限 ${lim[name]}${unit})`);
      }
    };
    over('say', reply.say);
    over('instruction', action?.instruction);
    over('why_it_works', action?.why_it_works);
  }
  const rest = [reply.say, action?.title, action?.instruction, action?.why_it_works].filter(Boolean).join('');
  const bangs = (rest.match(/[!！]/g) || []).length;
  if (bangs >= 2) problems.push(`「!」が多い(${bangs}個)`);
  if (obj.mode === 'normal' && endsWithQuestion(reply.say)) problems.push('せりふが問いかけで終わっている');

  return { reply, problems };
}
