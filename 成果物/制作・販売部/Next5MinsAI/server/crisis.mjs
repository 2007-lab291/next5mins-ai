// つらい入力の前の絞り込み(比べ表 X-9・設計書 M-9)。
// AI に送る前に、サーバーで言葉を見る。当たったら AI を呼ばずに、ジョークなしの短い文を返す。
// AI が safety を返さなかったときの守り(AI まかせにしない)。
// 言葉は、取りこぼすより、余分に当たるほうを選ぶ(当たっても、静かな文が出るだけ)。
// 言葉・文・相談先は、後から足し引きできる(ここだけ直せばよい)。

// 当たりの言葉(小文字・全角半角をそろえてから比べる)
const WORDS = {
  en: [
    /\bsuicid(e|al)\b/, /\bkill(ing)?\s+my\s*self\b/, /\bkms\b/, /\bend(ing)?\s+(it\s+all|my\s+life)\b/,
    /\b(want|wanna|going)\s+(to\s+)?die\b/, /\bself[\s-]?harm/, /\b(hurt|cut)(ting)?\s+my\s*self\b/,
    /\bno\s+reason\s+to\s+live\b/, /\bkill\s+(him|her|them|someone|somebody|my\s+\w+)\b/,
    /\babus(e|ed|ing|ive)\b/, /\boverdose\b/
  ],
  ja: [
    /死にたい/, /しにたい/, /自殺/, /消えたい/, /自傷/, /リスカ/, /リストカット/, /首を(吊|つ)/,
    /生きて(いたく|たく)ない/, /生きるのが(つらい|辛い)/, /殺したい/, /ころしたい/, /殺され/, /虐待/, /暴力を(受け|ふる)/,
    /飛び降り/, /\bod\b/, /オーバードーズ/
  ]
};

// 相談先(国ごとの具体名・番号)。【空欄】事実確認(出典と日付)が済んでから入れる。
// 例: { en: 'In the US, call or text 988.', ja: '…' } の形で、文のあとに足される。
export const CRISIS_LINES = { en: '', ja: '' };

const MESSAGE = {
  en: "That sounds really heavy. This app is for small jokes, so it won't joke about this. Please talk to someone you trust, or a local crisis support line, right now. You don't have to carry this alone.",
  ja: 'とてもつらい状況のようです。このアプリは冗談のためのものなので、ここでは冗談を言いません。いま、信頼できる人か、お住まいの地域の相談窓口に話してみてください。ひとりで抱えなくて大丈夫です。'
};

function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase();
}

// どちらの言語で書かれていても当たるように、両方の言葉で見る
export function isCrisis(text) {
  const t = normalize(text);
  return [...WORDS.en, ...WORDS.ja].some((re) => re.test(t));
}

// CONTRACT 4 の「つらい入力」の形で返す
export function crisisAnswer(lang) {
  const l = lang === 'ja' ? 'ja' : 'en';
  const extra = CRISIS_LINES[l] ? (l === 'ja' ? '' : ' ') + CRISIS_LINES[l] : '';
  return { language: l, safety: true, message: MESSAGE[l] + extra };
}
