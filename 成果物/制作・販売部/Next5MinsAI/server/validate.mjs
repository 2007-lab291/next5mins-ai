// AIの答えの形を確かめる(parts/CONTRACT.md の 4・設計書 4章・M-9)。
// よければ「決めたキーだけ」のきれいな形を返す。だめなら null。
// 文字の数は、絵文字も1文字と数える(コードポイントの数)。前後の空白だけの文字は、空とみなす。

function str(v, min, max) {
  if (typeof v !== 'string') return null;
  if (v.trim() === '') return min > 0 ? null : v;
  const n = Array.from(v).length;
  return n >= min && n <= max ? v : null;
}

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

// AI が返した language を、頼んだ言語(lang)と照らす(X-6)。
// 「en」「en-US」「English」などは同じとみなす。違う言語なら null(形がだめと同じ。1回頼み直し、だめなら 502)。
const LANG_ALIASES = {
  en: ['en', 'en-us', 'en-gb', 'english'],
  ja: ['ja', 'ja-jp', 'jp', 'japanese', '日本語']
};
function sameLang(v, want) {
  return typeof v === 'string' && LANG_ALIASES[want].includes(v.trim().toLowerCase());
}

const ACTION_KEYS = ['idiot', 'average', 'god'];

function action(v) {
  const a = obj(v);
  if (!a) return null;
  const title = str(a.title, 1, 80);
  const instruction = str(a.instruction, 1, 400);
  const why = str(a.why_it_works, 1, 300);
  if (title === null || instruction === null || why === null) return null;
  return { title, instruction, why_it_works: why };
}

export function validateResult(input, lang) {
  const o = obj(input);
  if (!o) return null;
  const want = lang === 'ja' ? 'ja' : 'en';

  // つらい入力のとき(設計書 M-9): ジョークなしの短い文だけ
  if (o.safety === true) {
    const message = str(o.message, 1, 400);
    if (message === null) return null;
    return { language: want, safety: true, message };
  }

  if (!sameLang(o.language, want)) return null;
  const language = want; // 返すときは「en」「ja」にそろえる
  const summary = str(o.situation_summary, 1, 200);
  if (summary === null) return null;

  const acts = obj(o.actions);
  if (!acts) return null;
  const actions = {};
  for (const k of ACTION_KEYS) {
    const a = action(acts[k]);
    if (!a) return null;
    actions[k] = a;
  }

  const it = obj(o.idiot_item_throw);
  if (!it) return null;
  const item = {
    shout_line: str(it.shout_line, 1, 120),
    item_name: str(it.item_name, 1, 80),
    item_emoji: str(it.item_emoji, 1, 16),
    funny_reason: str(it.funny_reason, 1, 300),
    amazon_search_keyword: str(it.amazon_search_keyword, 1, 100)
  };
  if (Object.values(item).some((v) => v === null)) return null;

  return { language, situation_summary: summary, actions, idiot_item_throw: item };
}
