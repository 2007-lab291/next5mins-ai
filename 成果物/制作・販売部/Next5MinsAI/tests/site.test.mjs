// サイト全体(全パーツをつなげた画面)のテスト。予行(--dry)のサーバーだけ。本物のAI・外への通信は使わない。
// 動かし方: node --test tests/site.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', 'server', 'server.mjs');
const SHOTS = process.env.N5_SHOT_DIR || '/tmp/claude-0/-home-user--/6698f42e-4310-51b2-b4e7-bce92db22dde/scratchpad';

let child, base, browser;

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [SERVER, '--dry', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
});

for (const width of [1024, 375]) {
  for (const lang of ['en', 'ja']) {
    test(`全パーツの通し(幅${width}・言語${lang})`, async () => {
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
      const shot = (name) => page.screenshot({ path: path.join(SHOTS, `integ-${width}-${lang}-${name}.png`) });
      const noOverflow = async (when) => {
        const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        assert.ok(w.sw <= w.iw, `${when}: 横にはみ出している scrollWidth=${w.sw} innerWidth=${w.iw}`);
      };

      // (a)
      await page.goto(base);
      await page.locator('.n5-p1-decide').waitFor();
      await noOverflow('最初');
      await shot('1-top');

      // (b) 日本語に切り替える
      await page.selectOption('.n5-p1-lang', 'ja');
      assert.equal(await page.locator('.n5-p1-title').textContent(), 'いま、何を先延ばしにしていますか?');
      assert.equal(await page.locator('.n5-p1-decide').textContent(), '5分後の行動を決める >>');
      assert.equal(await page.locator('.n5-p1-login').textContent(), 'ログイン');
      if (lang === 'en') {
        await page.selectOption('.n5-p1-lang', 'en');
        assert.equal(await page.locator('.n5-p1-title').textContent(), 'What are you procrastinating on right now?');
        assert.equal(await page.locator('.n5-p1-decide').textContent(), 'Decide My Next 5 Mins >>');
      }
      const L = (en, ja) => (lang === 'ja' ? ja : en);

      // (c)
      await page.fill('.n5-p1-textarea', L('I keep scrolling my phone instead of studying.', 'テスト勉強をしないでスマホを見ている。'));
      await page.click('.n5-p1-decide');
      await page.locator('#n5-part2:not([hidden])').waitFor({ timeout: 5000 });
      const cards = page.locator('.n5-p2-card');
      await cards.nth(2).waitFor({ timeout: 5000 });
      assert.equal(await cards.count(), 3);
      const cardText = await page.locator('#n5-part2').textContent();
      for (const e of ['🤪', '😐', '⚡']) assert.ok(cardText.includes(e), `カードに ${e} が無い`);
      await noOverflow('カード');
      await shot('2-cards');

      // (d)
      await page.locator('.n5-p2-pick').first().click();
      await page.locator('#n5-part3:not([hidden])').waitFor({ timeout: 3000 });
      assert.match(await page.locator('.n5-p3-clock').textContent(), /^\d{1,2}:\d{2}$/);
      assert.equal((await page.locator('.n5-p3-ad-label').textContent()).trim(), L('Ad', '広告'));
      await noOverflow('タイマー');
      await shot('3-timer');

      // (e) throwTiming は timer
      assert.equal(await page.evaluate(() => window.N5.config.throwTiming), 'timer');
      const item = page.locator('.n5-p4-item').first();
      await item.waitFor({ state: 'visible', timeout: 4000 });
      await shot('4-item');
      await item.dispatchEvent('click');
      const dialog = page.locator('.n5-p4-dialog');
      await dialog.waitFor({ state: 'visible', timeout: 3000 });
      const href = await page.locator('.n5-p4-link').getAttribute('href');
      assert.ok(href.startsWith(L('https://www.amazon.com/s?k=', 'https://www.amazon.co.jp/s?k=')), 'Amazon のリンクが違う: ' + href);
      assert.equal((await page.locator('.n5-p4-ad').textContent()).trim(), L('Ad・PR', '広告・PR'));
      await noOverflow('小窓');
      await shot('5-modal');

      // (f)
      await page.locator('.n5-p4-close').click();
      await dialog.waitFor({ state: 'hidden', timeout: 3000 });
      await page.getByRole('button', { name: L('Done early', 'もう終わった') }).click();
      await page.getByText(L('Done!', 'できた!')).first().waitFor({ state: 'visible', timeout: 3000 });
      await shot('6-done');
      await page.getByRole('button', { name: L('Back to start', '最初に戻る') }).click();
      await page.locator('#n5-part2').waitFor({ state: 'hidden', timeout: 3000 });
      await page.locator('#n5-part3').waitFor({ state: 'hidden', timeout: 3000 });
      await noOverflow('最初に戻る');

      // (g)
      const foot = await page.locator('#n5-part5').textContent();
      assert.ok(foot.includes(L('affiliate links (Amazon Associates)', 'アフィリエイトのリンク(Amazonアソシエイト)')), 'フッターに断りが無い');
      await shot('7-footer');

      assert.deepEqual(problems, [], 'console/pageerror/CSP: ' + problems.join(' | '));
      await ctx.close();
    });
  }
}
