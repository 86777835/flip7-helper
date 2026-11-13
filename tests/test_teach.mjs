// Teach page, both versions: entry on the landing page, every term opens its note with a card picture, the 「问」 buttons
// ask the rules assistant that exact question (with the version in front), 注意事项, the card guide, phone width.
// /api/chat is mocked, so this never asks a real model.
// Usage: node tests/test_teach.mjs <base-url> <shots-dir>   (safe against the live site too: it writes nothing)
import { chromium } from 'playwright-core';
const [base, out] = process.argv.slice(2);
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const b = await chromium.launch({ channel: 'chrome' });
const page = await (await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const asked = [];
await page.route('**/api/chat', async r => {
  const q = JSON.parse(r.request().postData()).messages.at(-1).content; asked.push(q);
  await r.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: `答：${q}` } }] })}\n\ndata: [DONE]\n\n` });
});

const MUST = {
  base: ['数字牌', '七连翻', '要牌', '停止', '爆牌', '修正牌', '×2', '不许动', '连翻三张', '卷土重来', '200', '左手边'],
  veng: ['数字牌', '七连翻', '停止', '爆牌', '零号牌', '厄运 7', '幸运 13', '÷2', '再来一张', '交换', '窃取', '弃置', '连翻四张', '残酷模式', '200']
};
const TAG = { base: '（版本：原版）', veng: '（版本：冤家路窄）' };

await page.goto(base); await page.waitForSelector('.teachgo');
eq('landing shows the teach entry', await page.textContent('.teachgo b'), '第一次玩？2 分钟讲规则');
await page.click('.teachgo'); await page.waitForSelector('.tpart');
eq('teach page opened', new URL(page.url()).pathname, '/teach');

for (const ver of ['base', 'veng']) {
  if (ver === 'veng') { await page.click('.tver [data-v=veng]'); await page.waitForFunction(() => location.search === '?v=veng'); }
  console.log(`— ${ver}`);
  eq(`${ver}: five parts plus 注意事项`, await page.$$eval('.tpart', l => l.length), 6);
  const read = await page.$$eval('.tline', l => l.map(p => p.textContent).join(''));
  const min = await page.textContent('#ttl');
  console.log(`  script: ${read.length} characters, title ${min}`);
  eq(`${ver}: title matches the reading time (~260 characters a minute read aloud)`, min, `${Math.round(read.length / 260)} 分钟讲规则`);
  const missing = MUST[ver].filter(w => !read.includes(w));
  eq(`${ver}: script names every important element`, missing, []);
  await page.screenshot({ path: `${out}/teach_${ver}_top.png` });

  const ids = await page.$$eval('[data-t]', l => [...new Set(l.map(x => x.dataset.t))]);
  const bad = [];
  for (const id of ids) {
    await page.evaluate(id => document.querySelector(`[data-t="${id}"]`).click(), id);
    const n = await page.$eval('.tsheet', s => ({ open: !s.classList.contains('hidden'), name: s.querySelector('.tshd b')?.textContent, ps: [...s.querySelectorAll('p')].map(p => p.textContent.length) }));
    if (!n.open || !n.name || n.ps.length !== 2 || n.ps.some(x => x < 8)) bad.push([id, n]);
    await page.click('.tsx');
  }
  console.log(`  ${ids.length} terms checked`);
  eq(`${ver}: every term opens a note with text`, bad, []);

  // a 「问」 button sends its question, with the version in front
  const q = await page.$eval('#p2 .tq', x => x.dataset.q);
  const n0 = await page.$$eval('.cm.a', l => l.length);
  await page.locator('#p2 .tq').first().click();
  await page.waitForFunction(n => document.querySelectorAll('.cm.a').length > n && !document.querySelector('.cm.a:last-child .cdots'), n0);
  eq(`${ver}: 「问」 sends its question with the version`, asked.at(-1), TAG[ver] + q);
  await page.screenshot({ path: `${out}/teach_${ver}_ask.png` });
  await page.click('.cx');

  const notes = await page.$$eval('.tni', l => l.map(d => ({ t: d.querySelector('summary').textContent, a: d.querySelector('p').textContent.length, q: d.querySelector('.tq').dataset.q, open: d.open })));
  console.log(`  ${notes.length} notes`);
  eq(`${ver}: at least 14 notes, each with an answer, all closed at first`, [notes.length >= 14, notes.filter(n => n.a < 20 || !n.q || n.open)], [true, []]);
  const n1 = page.locator('.tni').first();
  await n1.locator('summary').click();
  eq(`${ver}: a note opens on tap`, await n1.evaluate(d => d.open && d.querySelector('p').offsetHeight > 0), true);
  await page.screenshot({ path: `${out}/teach_${ver}_notes.png` });

  await page.evaluate(() => Promise.all([...document.querySelectorAll('.tic img, .term img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
  const tiles = await page.$$eval('.tic', l => l.map(t => [t.querySelector('span').textContent, t.querySelector('img')?.naturalWidth > 0]));
  eq(`${ver}: card guide: every picture loads`, tiles.filter(t => !t[1]), []);
  console.log(`  card guide: ${tiles.length} cards`);
  await page.locator('#deck').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/teach_${ver}_deck.png` });
  eq(`${ver}: no sideways scrolling at 375 px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  eq(`${ver}: 「去建房间」 keeps the version`, await page.getAttribute('.tgo', 'href'), `/?v=${ver}`);
}
eq('no button inside a button', await page.$$eval('button button', l => l.length), 0);
eq('no page errors', errs, []);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
