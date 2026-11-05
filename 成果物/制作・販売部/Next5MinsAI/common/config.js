// Next5Mins AI の設定(社長が直す所)。意味は parts/CONTRACT.md の 3。
window.N5_CONFIG = {
  amazonTag: { en: '', ja: '' },   // Amazon アソシエイトの印。空なら印なし
  throwTiming: 'timer',            // 'timer' = タイマーが始まったとき / 'cards' = カードが出たとき(設計書 M-2。社長が決めるまで timer)
  allowFake: true,                 // サーバーがないとき、にせの答え(samples.js)で動かす
  adSlotHtml: ''                   // 広告の枠の中身(空なら枠のしるしだけ)
};
