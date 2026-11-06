// にせの平凡(8-6)。外へつながらない。設計図のお手本から、入力の文に合わせて1つ選んで返す。
import { checkAverageReply } from './schema.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function fakeAverage({ blueprint, lang, text = '', first = true, turnIndex = 0, delayMs = 400 } = {}) {
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
          ? 'そのことは、さっきの話とつながっている。まず、さっきの一歩を思い出そう。'
          : 'That connects to what we just talked about. Start from the last step.';
      }
    }
  } else {
    const t = blueprint.step_types[0];
    base = {
      mode: 'normal', language: lang, step: t.id,
      say: lang === 'ja' ? 'なるほど。まず、できる範囲の小さな一歩から始めよう。' : 'I see. Start with one small step you can do right now.',
      action: null,
    };
  }
  base.language = lang;
  if ((blueprint.always_action || turnIndex === 0) && base.mode === 'normal' && !base.action) {
    base.action = lang === 'ja'
      ? { title: '1つだけ手をつける', instruction: '目の前の一番小さい作業を1つだけ選んで、手をつける。1つ終われば終わり。', why_it_works: '始めるところがいちばん重いから、そこだけ越える。' }
      : { title: 'Touch just one thing', instruction: 'Pick the smallest task in front of you and do only that. When it is done, you are done.', why_it_works: 'Starting is the heaviest part, so only get past that.' };
  }

  const checked = checkAverageReply(base, { lang, first, blueprint });
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
