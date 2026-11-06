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
          ? 'その悩みは、さっきの話の続きにすぎない。宇宙は、まだ覚えている。'
          : 'That worry is only a sequel to the last one. The universe still remembers.';
      }
    }
  } else {
    const t = blueprint.power_types[0];
    base = {
      mode: 'normal', language: lang, power: t.id,
      say: lang === 'ja' ? 'その悩みは、宇宙から見れば点にもならない。時間を止めてしまえばよい。' : 'Your worry is not even a dot from the universe. Simply stop time.',
      action: null,
    };
  }
  base.language = lang;
  if ((blueprint.always_action || turnIndex === 0) && base.mode === 'normal' && !base.action) {
    base.action = lang === 'ja'
      ? { title: '時間を止めて、終わらせる', instruction: '指を一度鳴らして、世界の時間を止める。止まっている間に、悩みを最後まで片づけよ。', why_it_works: '時間が止まれば、締め切りは一歩も近づけない。' }
      : { title: 'Stop time and finish it', instruction: 'Snap your fingers once and stop the world. While it is stopped, finish the whole thing.', why_it_works: 'With time stopped, the deadline cannot move closer.' };
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
