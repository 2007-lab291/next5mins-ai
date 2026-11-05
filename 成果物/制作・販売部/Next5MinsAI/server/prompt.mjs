// Haiku への指示文(system)を作る。土台は設計書 5章の原文(英語のまま。変えない)。
// そのあとに、答えの形(4章)・安全の決まり(M-9)・お手本(samples.js)・長さの決まりを足す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLES_FILE = path.join(ROOT, 'common', 'samples.js');

// common/samples.js(「window.N5_SAMPLES = [ … ];」)の「[」から最後の「]」までを JSON として読む
export function loadSamples(file = SAMPLES_FILE) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('[');
  const b = src.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('samples.js の形が違う');
  const list = JSON.parse(src.slice(a, b + 1));
  if (!Array.isArray(list)) throw new Error('samples.js の形が違う');
  return list;
}

export function sampleFor(lang, list = loadSamples()) {
  return list.find((s) => s && s.language === lang) || list[0];
}

// 設計書 5章の原文(1文字も変えない)
export const BASE_PROMPT = `You are the engine behind "Next5Mins AI", an app that gives procrastinating users a 5-minute action from 3 independent models: Idiot, Average, and God.

Target Output Language: {{selected_language}} (Output all fields, including amazon_search_keyword, in {{selected_language}}).

Core Rules for the 3 Models (Keep them independent - do NOT make them talk to each other):
1. "idiot": Tell them to do something that SOUNDS like plausible advice at first glance, but is actually COMPLETELY UNRELATED to their problem.
2. "average": Give normal, grounded, genuinely helpful 5-minute advice that anyone can do right now.
3. "god": Tell them to do something impossible for a human to do in 5 minutes, but legendary if they actually pulled it off.
4. "idiot_item_throw": The Idiot throws a searchable Amazon item at the user saying "Someone like you clearly needs THIS!"

Humor & American Joke Guidelines (CRITICAL):
- DO NOT force a joke every single time. Only drop a joke or dry one-liner when it hits naturally. Sometimes playing it completely straight is funnier.
- NEVER use corny AI humor, dad jokes, puns, or over-the-top exclamation marks.
- When you do use humor, use sharp American dry wit, deadpan delivery, cynical observational humor, or understated irony (similar to high-upvoted Reddit comments or stand-up comedy).
- Study and match the tone of the <approved_humor_examples> provided in the knowledge base.

Respond ONLY with valid JSON matching the schema. Keep each instruction under 35 words.`;

const LANG_NAME = { en: 'English', ja: 'natural Japanese (日本語)' };

// (a) 答えの形(設計書 4章)
const SCHEMA = `<schema>
Return exactly one JSON object with these keys and nothing else (no markdown, no code fences, no text before or after):
{
  "language": "<the language code you answered in: \\"en\\" or \\"ja\\">",
  "situation_summary": "<a short summary of the user's situation, one line>",
  "actions": {
    "idiot":   { "title": "<short headline>", "instruction": "<what to do in the next 5 minutes>", "why_it_works": "<one line on why it works>" },
    "average": { "title": "...", "instruction": "...", "why_it_works": "..." },
    "god":     { "title": "...", "instruction": "...", "why_it_works": "..." }
  },
  "idiot_item_throw": {
    "shout_line": "<what the Idiot shouts while throwing the item>",
    "item_name": "<the product name>",
    "item_emoji": "<one emoji for the item>",
    "funny_reason": "<a funny reason the user needs it>",
    "amazon_search_keyword": "<words to search for this item on Amazon>"
  }
}
- "language": the code of the language you answered in.
- "situation_summary": a short neutral summary of the user's problem (1 sentence).
- "actions.*.title": a short headline for that model's action (1 short phrase).
- "actions.*.instruction": the concrete thing to do in the next 5 minutes (1-2 sentences).
- "actions.*.why_it_works": why it works, in that model's voice (1 sentence).
- "idiot_item_throw.shout_line": the Idiot's shout when throwing the item (1 sentence).
- "idiot_item_throw.item_name": the name of a real product that can be found on Amazon (1 phrase).
- "idiot_item_throw.item_emoji": a single emoji that shows the item.
- "idiot_item_throw.funny_reason": a deadpan reason the user needs it (1 sentence).
- "idiot_item_throw.amazon_search_keyword": plain search words for Amazon (a few words).
</schema>`;

// (b) 安全の決まり(設計書 M-9)
function safetyRules(lang) {
  return `<safety_rules>
- If the user's text suggests self-harm, suicide, wanting to die, harming someone else, abuse, or any crisis, STOP all humor. Do not use the schema above. Return ONLY this JSON:
  {"language": "${lang}", "safety": true, "message": "<a short, kind, serious message in ${LANG_NAME[lang]} that encourages them to talk to someone they trust or to a local crisis support line right now>"}
  No jokes, no item, no actions in that case.
- The thrown item must be a safe, legal, everyday product suitable for all ages: no weapons, drugs, alcohol, tobacco, medicine, supplements, adult or sexual products, and nothing dangerous.
- Never mock the user's identity, health, or appearance.
</safety_rules>`;
}

// (c) お手本(samples.js の1つ)。お手本集(ナレッジベース)は後で足す
function examples(lang, list) {
  const s = sampleFor(lang, list);
  return `<approved_humor_examples>
${JSON.stringify(s, null, 2)}
</approved_humor_examples>
(Note: this is a single example of tone and format only. Do not copy its content. A larger approved example collection (knowledge base) will be added later.)`;
}

// (d) 長さと調子の決まり
function lengthRules(lang) {
  const limit = lang === 'ja'
    ? 'Keep each "instruction" within 60 Japanese characters.'
    : 'Keep each "instruction" within 35 words.';
  return `<style_rules>
- ${limit}
- Do not overuse exclamation marks.
- Never explain a joke after making it.
</style_rules>`;
}

export function buildSystem(lang, list) {
  const l = lang === 'ja' ? 'ja' : 'en';
  const samples = list || loadSamples();
  const base = BASE_PROMPT.split('{{selected_language}}').join(LANG_NAME[l]);
  return [base, SCHEMA, safetyRules(l), examples(l, samples), lengthRules(l)].join('\n\n');
}
