// バカの答えの形(2章)と、その確かめ(2-1)。外の部品は使わない。

const str = { type: 'string' };

// API に渡す JSON Schema。数の制約(minLength など)は、API が受けつけないので使わない。
export const REPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'language', 'neta', 'say', 'action', 'item'],
  properties: {
    mode: { type: 'string', enum: ['normal', 'safety'] },
    language: { type: 'string', enum: ['ja', 'en'] },
    neta: str,
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
    item: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['shout_line', 'item_name', 'item_emoji', 'funny_reason', 'amazon_search_keyword'],
          properties: {
            shout_line: str, item_name: str, item_emoji: str, funny_reason: str, amazon_search_keyword: str,
          },
        },
        { type: 'null' },
      ],
    },
  },
};

// 形がだめになる上限(コードポイントの数)
const MAX = {
  say: 400, title: 80, instruction: 400, why_it_works: 300,
  shout_line: 120, item_name: 80, item_emoji: 16, funny_reason: 300, amazon_search_keyword: 100,
};

const ACTION_KEYS = ['title', 'instruction', 'why_it_works'];
const ITEM_KEYS = ['shout_line', 'item_name', 'item_emoji', 'funny_reason', 'amazon_search_keyword'];
const TOP_KEYS = ['mode', 'language', 'neta', 'say', 'action', 'item'];

export const cpLen = s => Array.from(s).length;
export const wordCount = s => String(s).split(/\s+/).filter(Boolean).length;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameKeys = (o, keys) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every(x => Object.hasOwn(o, x));
};
// 空でない文字で、上限以内か
const okText = (v, max) => typeof v === 'string' && v.trim() !== '' && cpLen(v) <= max;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
// 絵文字1つに見えるか(厳密でなくてよい)
export function looksLikeOneEmoji(s) {
  if (typeof s !== 'string' || s.trim() === '') return false;
  if (/[\x00-\x7F]/.test(s)) return false;
  return Array.from(segmenter.segment(s)).length === 1;
}

const LEN_JA = { say: 'せりふ', instruction: 'やること', why_it_works: 'なぜ効くか' };

// 返すもの: null(形がだめ=やり直し)か { reply, problems }
export function checkReply(obj, { lang, first = false, blueprint } = {}) {
  if (!isObj(obj) || !sameKeys(obj, TOP_KEYS)) return null;
  if (obj.mode !== 'normal' && obj.mode !== 'safety') return null;
  if (obj.language !== 'ja' && obj.language !== 'en') return null;
  if (!okText(obj.neta, 100) || !okText(obj.say, MAX.say)) return null;

  let action = null;
  if (obj.action !== null) {
    const a = obj.action;
    if (!isObj(a) || !sameKeys(a, ACTION_KEYS)) return null;
    if (!ACTION_KEYS.every(k => okText(a[k], MAX[k]))) return null;
    action = { title: a.title, instruction: a.instruction, why_it_works: a.why_it_works };
  }
  let item = null;
  if (obj.item !== null) {
    const it = obj.item;
    if (!isObj(it) || !sameKeys(it, ITEM_KEYS)) return null;
    if (!ITEM_KEYS.every(k => okText(it[k], MAX[k]))) return null;
    item = {
      shout_line: it.shout_line, item_name: it.item_name, item_emoji: it.item_emoji,
      funny_reason: it.funny_reason, amazon_search_keyword: it.amazon_search_keyword,
    };
  }
  const reply = { mode: obj.mode, language: obj.language, neta: obj.neta, say: obj.say, action, item };

  const problems = [];
  if (lang && obj.language !== lang) problems.push('言語がちがう');
  if (obj.mode === 'normal') {
    if (first && (!action || !item)) problems.push('1回目なのに、行動カードか品物が無い');
    if (blueprint?.neta_types && !blueprint.neta_types.some(n => n.id === obj.neta)) {
      problems.push(`ネタの型「${obj.neta}」が設計図に無い`);
    }
  }
  const lim = blueprint?.length?.[lang];
  if (lim) {
    const measure = lang === 'en' ? wordCount : cpLen;
    const unit = lang === 'en' ? '語' : '文字';
    const over = (name, text) => {
      if (text != null && lim[name] != null && measure(text) > lim[name]) {
        problems.push(`${LEN_JA[name] || name}が長い(${measure(text)}${unit}。上限 ${lim[name]}${unit})`);
      }
    };
    over('say', reply.say);
    over('instruction', action?.instruction);
    over('why_it_works', action?.why_it_works);
  }
  // 「!」は shout_line のほかでは1つまで
  const rest = [reply.say, action?.title, action?.instruction, action?.why_it_works,
    item?.item_name, item?.funny_reason, item?.amazon_search_keyword].filter(Boolean).join('');
  const bangs = (rest.match(/[!！]/g) || []).length;
  if (bangs >= 2) problems.push(`「!」が多い(${bangs}個)`);
  if (item && !looksLikeOneEmoji(item.item_emoji)) problems.push('品物の絵文字が1つに見えない');

  return { reply, problems };
}
