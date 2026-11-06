// バカ工房の画面の通しテスト。予行(--dry)のサーバーだけ。本物のAI・外への通信は使わない。
// 動かし方: node --test tests/web.test.mjs
// 写真は、環境変数 IDIOT_SHOT_DIR があるときだけ、そこに撮る。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', 'lab', 'server.mjs');
const SHOT_DIR = process.env.IDIOT_SHOT_DIR || '';

let child, base, browser, dataDir;

before(async () => {
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idiot-web-'));
  await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [SERVER, '--dry', '--port', '0', '--data', dataDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error('サーバーが起動しない')), 10_000);
    child.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(timer); base = m[0]; resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('サーバーが止まった ' + code)); });
  });
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (child) { child.removeAllListeners('exit'); child.kill(); }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

for (const width of [1024, 375]) {
  for (const lang of ['ja', 'en']) {
    test(`画面の通し(幅${width}・言語${lang})`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      const problems = [];
      page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.error('CSP違反: ' + e.violatedDirective + ' ' + e.blockedURI);
        });
      });
      const shot = async (name) => {
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `idiot-${width}-${lang}-${name}.png`), fullPage: true });
      };
      const noOverflow = async (when) => {
        const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        assert.ok(w.sw <= w.iw, `${when}: 横にはみ出している scrollWidth=${w.sw} innerWidth=${w.iw}`);
      };
      const sendText = async (text, nth) => {
        await page.fill('#chatText', text);
        await page.click('#sendBtn');
        await page.waitForFunction((n) => document.querySelectorAll('.bot-row').length >= n && document.getElementById('thinkingRow').hidden, nth, { timeout: 10_000 });
      };

      // 開く・予行の帯
      await page.goto(base);
      await page.waitForFunction(() => document.getElementById('modeBadge').textContent === '予行');
      assert.equal(await page.locator('#dryBand').isVisible(), true);
      assert.match(await page.locator('#dryBand').textContent(), /予行/);
      await noOverflow('最初');
      await shot('1-top');

      // 会話
      if (lang === 'en') await page.selectOption('#chatLang', 'en');
      const t1 = lang === 'en' ? 'I keep scrolling my phone instead of studying.' : 'テスト勉強をしないでスマホを見ている。';
      const t2 = lang === 'en' ? 'But I am too tired to start.' : 'でも疲れていて始められない。';
      await sendText(t1, 1);
      const bot1 = page.locator('.bot-row').first();
      assert.ok((await bot1.locator('.say').textContent()).length > 0, 'say が出ていない');
      assert.match(await bot1.locator('.say').textContent(), /予行/);
      assert.equal(await bot1.locator('.action-card').count(), 1, '行動カード');
      assert.equal(await bot1.locator('.item-box').count(), 1, '品物');
      await noOverflow('1回目のあと');
      await shot('2-first');

      await sendText(t2, 2);
      assert.equal(await page.locator('.bot-row').count(), 2);
      assert.equal(await page.locator('.user-bubble').count(), 2);
      await noOverflow('2回目のあと');

      // 言い直し
      const before2 = await page.locator('.bot-row').last().locator('.say').textContent();
      await page.click('.regen-btn');
      await page.waitForFunction(() => document.getElementById('thinkingRow').hidden);
      await page.waitForFunction(() => !!document.querySelector('.regen-btn') && !document.querySelector('.regen-btn').disabled);
      assert.equal(await page.locator('.bot-row').count(), 2, '言い直しで行が増えた');
      assert.ok((await page.locator('.bot-row').last().locator('.say').textContent()).length > 0);
      void before2;

      // 評価とメモ
      const last = page.locator('.bot-row').last();
      await last.locator('.rate-btn', { hasText: '👎 だめ' }).click();
      await last.locator('.memo-area textarea').waitFor({ state: 'visible' });
      await last.locator('.memo-area textarea').fill('もっと短く');
      await last.locator('.memo-area .btn', { hasText: 'メモを保存' }).click();
      await page.waitForFunction(() => /メモを保存しました/.test(document.querySelector('.bot-row:last-of-type .msg-inline')?.textContent || ''));
      await shot('3-rated');

      // 設計図タブ
      await page.click('#tab-bp');
      await page.waitForFunction(() => document.getElementById('bp-title').value !== '');
      await noOverflow('設計図タブ');
      const newTitle = `テストの下書き${width}${lang}`;
      await page.fill('#bp-title', newTitle);
      await page.click('#bpSave');
      await page.waitForFunction(() => /として保存しました/.test(document.getElementById('bpMsg').textContent));
      const savedRef = 'draft:' + (await page.locator('#bpMsg').textContent()).match(/d\d{3}/)[0];
      assert.ok(savedRef);
      await page.click('#bpSystem');
      await page.waitForFunction(() => !document.getElementById('sysWrap').hidden && document.getElementById('sysPre').textContent.length > 50);
      assert.match(await page.locator('#sysPre').textContent(), /safety/);
      await shot('4-blueprint');

      // 会話タブで下書きを選んで新しい会話
      await page.click('#tab-chat');
      await page.click('#newConv');
      assert.equal(await page.locator('#chatRef').isDisabled(), false);
      await page.selectOption('#chatRef', savedRef);
      assert.equal(await page.locator('.bot-row').count(), 0);
      await sendText(t1, 1);
      assert.equal(await page.locator('#chatRef').inputValue(), savedRef);
      await shot('5-draft-chat');

      // 記録とまとめ
      await page.click('#tab-sum');
      await page.selectOption('#sumDraft', savedRef);
      await page.click('#sumMake');
      await page.waitForFunction(() => !document.getElementById('sumOut').hidden && document.getElementById('sumText').value.length > 0);
      const md = await page.locator('#sumText').inputValue();
      assert.match(md, /※このまとめには/, '注意の1行');
      assert.match(md, /評価/, '評価');
      assert.match(md, /だめ/, 'だめの評価');
      assert.ok(md.includes(savedRef), '下書きの設計図');
      await noOverflow('まとめ');
      await shot('6-summary');

      assert.deepEqual(problems, [], problems.join('\n'));
      await ctx.close();
    });
  }
}
