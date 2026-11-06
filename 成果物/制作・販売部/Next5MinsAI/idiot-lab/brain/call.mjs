// AIの呼び出し(3-2)と費用の目安(3-3)。本物のAIは社長が動かす。テストは、にせの fetchImpl を渡す。
import { safeFetch, redact } from '../lab/mamori.mjs';
import { REPLY_SCHEMA, checkReply } from './schema.mjs';

const API_URL = 'https://api.anthropic.com/v1/messages';
const HOSTS = ['api.anthropic.com'];

const ADAPTIVE = { type: 'adaptive', display: 'summarized' };
export const THINK_LEVELS = Object.freeze({
  none: Object.freeze({ label: '考えない(速い)', thinking: Object.freeze({ type: 'disabled' }), effort: 'low' }),
  low: Object.freeze({ label: '少し考える', thinking: ADAPTIVE, effort: 'low' }),
  medium: Object.freeze({ label: 'ふつうに考える', thinking: ADAPTIVE, effort: 'medium' }),
  high: Object.freeze({ label: 'しっかり考える', thinking: ADAPTIVE, effort: 'high' }),
});

// ドル/100万トークン。2026-11 時点の仮置き。社長が Anthropic の料金ページで確かめる。
export const PRICES = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costUsd(usage, model) {
  const p = PRICES[model];
  if (!p) return null;
  const n = k => Number(usage?.[k]) || 0;
  return (n('input_tokens') * p.input + n('output_tokens') * p.output
    + n('cache_read_input_tokens') * p.cacheRead + n('cache_creation_input_tokens') * p.cacheWrite) / 1_000_000;
}

function stripThinking(messages) {
  return messages.map(m => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return m;
    return { ...m, content: m.content.filter(b => b?.type !== 'thinking' && b?.type !== 'redacted_thinking') };
  });
}

// ``` で囲まれていたら外して、JSON として読む。読めなければ null
function readJsonText(s) {
  let t = String(s ?? '').trim();
  const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(t);
  if (m) t = m[1].trim();
  try { return JSON.parse(t); } catch { return null; }
}

export async function askIdiot(opts = {}) {
  const { key, model, system, messages, think, lang, first, blueprint, variation } = opts;
  const fetchImpl = opts.fetchImpl || safeFetch;
  const lv = THINK_LEVELS[think];
  const clean = s => redact(String(s ?? ''), { secrets: [key] });
  // 返事が届いた呼び出しは、失敗でも、お金がかかる。かかった分の usage を足していく
  const paid = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let paidAny = false;
  const addUsage = d => {
    const u = d?.usage;
    if (!u || typeof u !== 'object') return;
    paidAny = true;
    for (const k of Object.keys(paid)) paid[k] += Number(u[k]) || 0;
  };
  const fail = (error, message) => {
    const out = { ok: false, error, message: clean(message) };
    if (paidAny) out.usage = { ...paid };
    return out;
  };
  if (!lv) return fail('api', '考える量の指定がおかしいです。');
  if (typeof key !== 'string' || !key) return fail('auth', 'APIの鍵がありません。');

  let msgs = messages;
  let stripped = false;
  let tries = 0;

  for (;;) {
    const body = {
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }, ...(typeof variation === 'string' && variation ? [{ type: 'text', text: variation }] : [])],
      messages: msgs,
      thinking: { ...lv.thinking },
      output_config: { effort: lv.effort, format: { type: 'json_schema', schema: REPLY_SCHEMA } },
    };
    let res;
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        hosts: HOSTS,
        timeoutMs: 60_000,
      });
    } catch {
      return fail('unreachable', 'Anthropic につながりませんでした(ネットワークか、時間切れ)。');
    }

    const status = res.status;
    if (!res.ok) {
      const bodyText = String(res.text ?? '');
      if (status === 400 && !stripped && bodyText.includes('bound to a different conversation')) {
        stripped = true;
        msgs = stripThinking(msgs);
        continue;
      }
      if (status === 401 || status === 403) return fail('auth', 'APIの鍵が受けつけられませんでした。鍵が切れた・取り消したときは「バカ工房 鍵を貼り直す.bat」で貼り直してください。');
      if (status === 404 || (status === 400 && /model/i.test(bodyText))) return fail('model', 'モデルの名前が見つかりません。モデルの指定を確かめてください。');
      if (status === 429 || status === 529) return fail('busy', 'いま混んでいます。少し待ってからやり直してください。');
      return fail('api', `AIの呼び出しに失敗しました(状態 ${status})。`);
    }

    let data = null;
    try { data = JSON.parse(res.text); } catch { data = null; }
    addUsage(data);
    if (data && data.stop_reason === 'refusal') return fail('refusal', 'AIが安全のしくみで、答えるのを断りました。文を変えてみてください。');
    if (data && data.stop_reason === 'max_tokens') return fail('too_long', '答えが長すぎて、途中で切れました。');

    tries += 1;
    let checked = null;
    const content = Array.isArray(data?.content) ? data.content : null;
    if (content) {
      const textOut = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
      const parsed = readJsonText(textOut);
      if (parsed !== null) checked = checkReply(parsed, { lang, first, blueprint });
    }
    // always_action の設計図では、ふつうの答えに必ず行動カード(答え)がいる。無ければ1回だけ頼み直す(社長の指示 2026-11-06「無限に会話が続くよね。毎回答えを出すようにして。そのあと続けていいから」)
    if (checked && blueprint?.always_action && checked.reply.mode === 'normal' && !checked.reply.action && tries < 2) continue;
    if (checked) {
      const thinking = content.filter(b => b?.type === 'thinking' && typeof b.thinking === 'string').map(b => b.thinking).join('\n');
      const out = {
        ok: true,
        reply: checked.reply,
        problems: checked.problems,
        content,
        thinking,
        usage: { ...paid }, // 頼み直しの分も足した、かかった分ぜんぶ
        stopReason: data.stop_reason ?? null,
        tries,
      };
      if (stripped) out.strippedThinking = true;
      return out;
    }
    if (tries >= 2) return fail('bad_shape', 'AIの答えの形がおかしく、2回試しても直りませんでした。');
  }
}
