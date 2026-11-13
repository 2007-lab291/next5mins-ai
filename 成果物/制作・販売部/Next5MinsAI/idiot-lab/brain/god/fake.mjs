// にせの神(8-6)。外へつながらない。設計図のお手本から、入力の文に合わせて1つ選んで返す。
import { checkGodReply } from './schema.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function fakeGod({ blueprint, lang, text = '', first = true, turnIndex = 0, delayMs = 400 } = {}) {
  await wait(delayMs);
  const same = blueprint.examples.filter(e => e.lang === lang);
  const pool = same.length ? same : blueprint.examples;
  const sum = Array.from(String(text)).reduce((a, c) => a + c.codePointAt(0), 0);

  let base;
  if (pool.length) {
    const ex = pool[sum % pool.length];
    if (turnIndex >= 1 && ex.turns[turnIndex]) {
      base = structuredClone(ex.turns[turnIndex].reply);
      if (blueprint.always_action && !base.action) base.action = structuredClone(ex.turns[0].reply.action);
    } else {
      base = structuredClone(ex.turns[0].reply);
      if (turnIndex >= 1) {
        base.say = lang === 'ja'
          ? 'さっきの続きだな。\nお前なら、まだいける。\n次も一気に片づけよ。'
          : 'This is the sequel.\nYou still have plenty left.\nFinish this one in one go too.';
      }
    }
  } else {
    const t = blueprint.power_types[0];
    base = {
      mode: 'normal', language: lang, power: t.id,
      say: lang === 'ja' ? 'その程度なら、お前は一瞬で終わらせられる。\n机の上の物を、全部いったん下ろせ。\n使う物だけを戻して、残りは箱へ入れよ。' : 'You can finish this in an instant.\nClear everything off the desk.\nPut back only what you use, box the rest.',
      action: null,
    };
  }
  base.language = lang;
  if ((blueprint.always_action || turnIndex === 0) && base.mode === 'normal' && !base.action) {
    base.action = lang === 'ja'
      ? { title: '机を作り直す', instruction: '机の上の物を全部いったん下ろし、使う物だけを種類ごとに並べて戻す。残りは箱へ。', why_it_works: '一度ぜんぶ空にすれば、迷う物が一つも残らない。' }
      : { title: 'Rebuild the desk', instruction: 'Take everything off the desk, put back only what you use, sorted by kind. Box the rest.', why_it_works: 'Once it is empty, nothing is left to hesitate over.' };
  }

  const checked = checkGodReply(base, { lang, first, blueprint });
  const problems = checked ? checked.problems : [];
  const reply = { ...base, say: '【予行】' + base.say };
  const json = JSON.stringify(reply);
  return {
    ok: true,
    reply,
    problems,
    content: [{ type: 'text', text: json }],
    thinking: '(予行なので、考えていません)',
    usage: {
      input_tokens: 800 + Math.ceil(String(text).length * 1.5),
      output_tokens: Math.ceil(json.length / 2),
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    stopReason: 'end_turn',
    tries: 1,
  };
}
