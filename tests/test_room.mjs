// Rooms with several phones: join, seats, dealer, every way of entering a round, sync, warnings, ties, undo, fixing a
// past round, the end of the game, the archive, 再来一局, 冤家路窄 with 残酷模式, reconnecting, phone width.
// Plays whole games: run it against a local `wrangler dev` only (it leaves games in the archive).
// Reviews are intercepted, never sent to the hub.  Usage: node tests/test_room.mjs <base-url> <shots-dir>
import { chromium } from 'playwright-core';
const [base, out] = process.argv.slice(2);
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const END_WAIT = 2800;   // the room refuses a second 「本轮结束」 for 2.5 s

const b = await chromium.launch({ channel: 'chrome' });
const reviews = [];
async function phone() {
  const ctx = await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('https://boardgame.leisurecat.cloud/api/reviews', r => { reviews.push(JSON.parse(r.request().postData())); r.fulfill({ json: { ok: true } }); });
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  return p;
}
const A = await phone(), B = await phone();
const board = p => p.$$eval('.pl', l => l.map(x => [x.querySelector('.nm').firstChild.textContent, +x.querySelector('.tt').firstChild.textContent]));
const openRow = (p, name) => p.locator('.pl', { has: p.locator('.nm', { hasText: name }) }).first().click();
async function cards(p, name, nums, mods = [], sps = []) {
  await openRow(p, name); await p.waitForSelector('.sheet');
  for (const n of nums) await p.click(`.sheet [data-kind=n][data-key="${n}"]`);
  for (const s of sps) await p.click(`.sheet [data-kind=s][data-key="${s}"]`);
  for (const m of mods) await p.click(`.sheet [data-kind=m][data-key="${m}"]`);
  const steps = await p.textContent('.calc .steps');
  await p.click('.sheet [data-act=save]'); await p.waitForSelector('.sheet', { state: 'detached' });
  return steps;
}
async function total(p, name, t, f7 = false) {
  await openRow(p, name); await p.waitForSelector('.sheet');
  await p.click('.sheet [data-m=total]');
  await p.fill('[data-tot]', String(t));
  if (f7) await p.check('[data-act=f7chk]');
  await p.click('.sheet [data-act=save]'); await p.waitForSelector('.sheet', { state: 'detached' });
}
async function bust(p, name) { await openRow(p, name); await p.click('.sheet [data-act=bust]'); await p.waitForSelector('.sheet', { state: 'detached' }); }
async function endRound(p) { await p.click('[data-act=end]'); await wait(END_WAIT); }

// ---------- 《7连翻》 ----------
await A.goto(base); await A.click('[data-act=create]'); await A.waitForSelector('#meName');
const code = new URL(A.url()).searchParams.get('r');
await A.fill('#meName', '小明'); await A.click('[data-act=joinme]');
await B.goto(`${base}?r=${code}`); await B.waitForSelector('#meName');
await B.fill('#meName', '小红'); await B.press('#meName', 'Enter');
await B.fill('#otherName', '老王'); await B.click('[data-act=addother]');
await A.waitForFunction(() => document.querySelectorAll('.seat').length === 3);
await B.waitForFunction(() => document.querySelectorAll('.seat').length === 3);
eq('both phones see the same seats', [await A.$$eval('.seat input', l => l.map(i => i.value)), await B.$$eval('.seat input', l => l.map(i => i.value))], [['小明', '小红', '老王'], ['小明', '小红', '老王']]);
eq('each phone knows who it is', [await A.textContent('.me b'), await B.textContent('.me b')], ['小明', '小红']);
await A.click('.seat:nth-child(3) [data-act=move][data-d="-1"]');   // 老王 sits between 小明 and 小红
await A.click('.seat:nth-child(2) [data-act=dealer]');              // 老王 deals first
await A.waitForFunction(() => document.querySelector('.seat:nth-child(2) .dl.on'));
await A.screenshot({ path: out + '/setup.png' });
await B.click('[data-act=start]'); await A.waitForSelector('.status');
eq('round 1 dealer', await A.$eval('.status .dl b', x => x.textContent), '老王');

// round 1: rulebook examples, one bust, typed total
eq('cards: 3+11+5+7+10, ×2, +4', await cards(A, '小明', [3, 11, 5, 7, 10], ['x2', '+4']), '数字牌 36→×2 72→+4 76');
await B.waitForFunction(() => document.querySelector('[data-k=mine]') && [...document.querySelectorAll('.rc')].some(x => x.textContent === '+76'));
eq('the other phone sees the entry at once', true, true);
await bust(B, '小红');
await total(B, '老王', 64, true);
eq('end button counts down the missing', await A.textContent('[data-k=endbtn]'), '第 1 轮结束，算总分');
await A.screenshot({ path: out + '/round1.png' });
await endRound(A);
eq('totals after round 1', await B.evaluate(() => [...document.querySelectorAll('.pl')].map(x => +x.querySelector('.tt').firstChild.textContent)), [76, 64, 0]);
eq('dealer moves left', await B.$eval('.status .dl b', x => x.textContent), '小红');

// round 2: a Flip 7 and a second ×2 → warnings
eq('Flip 7 with ×2 doubles only the numbers', await cards(B, '小红', [0, 1, 2, 3, 4, 5, 6], ['x2', '+10']), '数字牌 21→×2 42→+10 52→七连翻 +15 67');
await cards(A, '小明', [12, 11], ['x2']);
await A.waitForSelector('.warn');
eq('warning: one ×2 in the deck', await A.$eval('.warn li', x => x.textContent.startsWith('×2 修正牌：整副牌只有 1 张')), true);
await openRow(A, '小明'); await A.click('.sheet [data-kind=m][data-key=x2]'); await A.click('.sheet [data-act=save]');
await A.waitForFunction(() => !document.querySelector('.warn'));
eq('fixing the entry clears the warning', true, true);
await total(A, '老王', 0);
await endRound(B);
eq('totals after round 2', Object.fromEntries(await A.$$eval('.pl', l => l.map(x => [x.querySelector('.nm').firstChild.textContent, +x.querySelector('.tt').firstChild.textContent]))), { 小明: 99, 小红: 67, 老王: 64 });

// undo round 2, then put it back
A.once('dialog', d => d.accept()); await A.click('[data-act=undo]');
await B.waitForFunction(() => document.querySelector('.status .rd b').textContent === '2');
eq('undo brings the entries back', await B.$$eval('.rc', l => l.map(x => x.textContent).sort()), ['+0', '+23', '七连翻 +67'].sort());
await endRound(A);

// round 3: 小明 and 小红 tie on 210 → everyone plays another round
await total(A, '小明', 111); await total(A, '小红', 143); await total(A, '老王', 100);
await endRound(A);
eq('tie at the top: play on', [await A.isVisible('[data-k=tie]'), await A.$eval('.status .rd b', x => x.textContent)], [true, '4']);
await A.screenshot({ path: out + '/tie.png' });

// fixing round 3 ends the game; fixing it back carries on again
await A.click('summary:has-text("逐轮得分")');
await A.click('.lg tbody tr:nth-child(3) td:nth-child(2) button');   // 小明, round 3
await A.click('.sheet [data-m=total]'); await A.fill('[data-tot]', '120'); await A.click('.sheet [data-act=save]');
await B.waitForSelector('.champ');
eq('a fixed round can end the game', await B.$eval('.champ .nm', x => x.textContent), '小明');
let games = await (await fetch(new URL('/api/games?q=' + code, base))).json();
eq('the finished game is archived', [games.length, games[0]?.players[0]], [1, { name: '小明', place: 1, total: 219, f7: 0, bust: 0, best: 120 }]);
await B.click('.lg tbody tr:nth-child(3) td:nth-child(2) button');
await B.click('.sheet [data-m=total]'); await B.fill('[data-tot]', '111'); await B.click('.sheet [data-act=save]');
await A.waitForSelector('[data-k=tie]');
games = await (await fetch(new URL('/api/games?q=' + code, base))).json();
eq('back to a tie: the game leaves the archive', games.length, 0);

// round 4 decides it
await total(B, '小明', 30); await bust(B, '小红'); await total(B, '老王', 5);
await endRound(B);
await A.waitForSelector('.champ');
eq('winner', [await A.$eval('.champ .nm', x => x.textContent), await A.$eval('.champ .pts', x => x.firstChild.textContent)], ['小明', '240']);
eq('ranking', await A.$$eval('.rkl .pl', l => l.map(x => x.querySelector('.nm').textContent + x.querySelector('.tt').textContent)), ['小明240', '小红210', '老王169']);
await A.screenshot({ path: out + '/results.png', fullPage: true });
eq('no sideways scrolling on the results', await A.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

// long image
await A.click('[data-act=shot]'); await A.waitForSelector('.shotv img', { timeout: 15000 });
const shot = await A.$eval('.shotv img', i => [i.naturalWidth, i.naturalHeight]);
eq('long image made', shot[0] > 600 && shot[1] > 1000, true);
await A.click('.shotv button');

// review
await A.click('.rv-who button:has-text("小明")'); await A.click('[data-act=rv-star][data-n="5"]'); await A.fill('[data-rv]', '好玩'); await A.click('[data-act=rv-send]');
await A.waitForSelector('.rv-done');
eq('review sent with the game key', reviews.at(-1), { game: 'flip7', stars: 5, name: '小明', text: '好玩', room: code });

// 再来一局: same seats, next dealer, the old game stays archived
A.once('dialog', d => d.accept()); await A.click('[data-act=again]');
await B.waitForSelector('.status');
eq('再来一局: scores reset, next player deals', [await B.$$eval('.pl .tt', l => l.map(x => +x.firstChild.textContent)), await B.$eval('.status .dl b', x => x.textContent)], [[0, 0, 0], '小红']);
games = await (await fetch(new URL('/api/games?q=' + code, base))).json();
eq('the finished game stays archived', games.length, 1);

// reconnecting: a reload lands back in the room with the same state
await B.reload(); await B.waitForSelector('.status');
eq('reload keeps the room and who this phone is', [await B.$eval('.status .rd b', x => x.textContent), await B.textContent('[data-k=mine]')], ['1', '录我这一轮的分']);

// ---------- 《冤家路窄》 with 残酷模式 ----------
const C = await phone();
await C.goto(base + '?v=veng'); await C.click('[data-act=create]'); await C.waitForSelector('#meName');
await C.check('[data-act=brutal]'); await C.waitForFunction(() => document.querySelector('.bar .ttl small').textContent === '冤家·残酷');
await C.fill('#meName', '甲'); await C.click('[data-act=joinme]');
for (const n of ['乙', '丙']) { await C.fill('#otherName', n); await C.click('[data-act=addother]'); }
await C.waitForFunction(() => document.querySelectorAll('.seat').length === 3);
await C.click('[data-act=start]'); await C.waitForSelector('.status');
// rulebook p.6 example, then aim the 15 at 乙
await openRow(C, '甲');
for (const n of [3, 11, 5, 7, 10, 8, 4]) await C.click(`.sheet [data-kind=n][data-key="${n}"]`);
for (const m of ['/2', '-4']) await C.click(`.sheet [data-kind=m][data-key="${m}"]`);
eq('冤家路窄 example: 48 ÷2 −4 +15', await C.textContent('.calc .steps'), '数字牌 48→÷2 24→−4 20→七连翻 +15 35');
await C.click('[data-act=hit][data-id]:not([data-id=""])');
eq('残酷模式: the 15 goes off 乙 instead', await C.textContent('.calc .steps'), '数字牌 48→÷2 24→−4 20');
await C.screenshot({ path: out + '/veng_sheet.png' });
await C.click('.sheet [data-act=save]');
eq('the Unlucky 7 replaces a plain 7', await (async () => { await openRow(C, '丙'); await C.click('.sheet [data-kind=n][data-key="7"]'); await C.click('.sheet [data-kind=s][data-key="u7"]'); return C.$$eval('.sheet .cd.on', l => l.length); })(), 1);
await C.click('.sheet [data-kind=s][data-key="z"]');
eq('The Zero: 0 unless Flip 7', (await C.textContent('.calc .res b')), '0');
await C.click('.sheet [data-kind=s][data-key="z"]'); await C.click('.sheet [data-kind=m][data-key="-10"]');
eq('残酷模式: below zero', await C.textContent('.calc .res b'), '-3');
await C.click('.sheet [data-act=save]'); await C.waitForSelector('.sheet', { state: 'detached' });
await bust(C, '乙');
await endRound(C);
eq('残酷模式 totals', Object.fromEntries(await C.$$eval('.pl', l => l.map(x => [x.querySelector('.nm').firstChild.textContent, +x.querySelector('.tt').firstChild.textContent]))), { 甲: 20, 丙: -3, 乙: -15 });

for (const p of [A, B, C]) eq('no page errors', p.errs, []);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
