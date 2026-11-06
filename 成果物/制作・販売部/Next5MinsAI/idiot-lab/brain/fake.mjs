// にせのバカ(3-4)。外へつながらない。設計図のお手本から、入力の文に合わせて1つ選んで返す。
import { checkReply } from './schema.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function fakeIdiot({ blueprint, lang, text = '', first = true, turnIndex = 0, delayMs = 400 } = {}) {
  await wait(delayMs);
  const same = blueprint.examples.filter(e => e.lang === lang);
  const pool = same.length ? same : blueprint.examples;
  const sum = Array.from(String(text)).reduce((a, c) => a + c.codePointAt(0), 0);

  let base;
  if (pool.length) {
    const ex = pool[sum % pool.length];
    if (turnIndex >= 1 && ex.turns[turnIndex]) {
      base = structuredClone(ex.turns[turnIndex].reply);
    } else {
      base = structuredClone(ex.turns[0].reply);
      if (turnIndex >= 1) {
        base.say = lang === 'ja' ? '関係ある。落ち着いて、もう一度聞け。' : 'It is relevant. Stay calm and listen again.';
      }
    }
  } else {
    const t = blueprint.neta_types[0];
    base = {
      mode: 'normal', language: lang, neta: t.id,
      say: lang === 'ja' ? 'なるほど。問題は、そこじゃない。' : 'I see. That is not the problem.',
      action: null, item: null,
    };
  }
  base.language = lang;

  const checked = checkReply(base, { lang, first, blueprint });
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
