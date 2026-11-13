// Rules assistant. Usage: node tests/test_chat.mjs <base-url> <shots-dir> [--no-key | --fake-key | --live]
//   --no-key   local `wrangler dev` without DEEPSEEK_API_KEY: panel UI, streamed answer (mocked /api/chat), "not configured" error
//   --fake-key local `wrangler dev --var DEEPSEEK_API_KEY:fake --var CHAT_CF_MODEL:@cf/none/missing`: request checks, upstream error, rate limit
//   --mock-web local `wrangler dev` with the --mock-upstream flags: web search when the notes don't cover a question
//   --live     the deployed site with a real key: one real question
import { chromium } from 'playwright-core';
const [base, out, mode] = process.argv.slice(2);
const api = p => new URL(p, base).href;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const post = body => fetch(api('/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const q = content => ({ messages: [{ role: 'user', content }] });

if (mode === '--fake-key') {
  eq('empty messages rejected', (await post({ messages: [] })).status, 400);
  eq('last message must be the user', (await post({ messages: [{ role: 'assistant', content: 'hi' }] })).status, 400);
  eq('system role rejected', (await post({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }] })).status, 400);
  eq('question over 500 chars rejected', (await post(q('长'.repeat(501)))).status, 400);
  const r = await post(q('×2 怎么算？'));
  const j = await r.json();
  console.log('upstream with fake key:', r.status, j.error);
  eq('upstream failure reported as 502', r.status, 502);
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await post({ messages: [] })).status);
  eq('rate limit kicks in', codes.includes(429), true);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
}

if (mode === '--mock-upstream') {
  // Backup models. Needs: wrangler dev --var DEEPSEEK_API_KEY:fake --var DEEPSEEK_BASE:http://127.0.0.1:8790 --var CHAT_CF_MODEL:@cf/none/missing
  // (DeepSeek is this mock; the Cloudflare model is pointed at a missing one so it always fails fast)
  const { createServer } = await import('node:http');
  let reply = {}, seen = [];   // reply: model → status or 'queue'; seen: models asked, in order
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const { model } = JSON.parse(body); seen.push(model);
      const st = reply[model] ?? 200;
      if (st === 'queue' || st === 'stall') {   // like an overloaded DeepSeek: only keep-alive comments, before or mid-answer
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (st === 'stall') res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${model} 答了一半` } }] })}\n\n`);
        const t = setInterval(() => res.write(': keep-alive\n\n'), 1000);
        return res.on('close', () => clearInterval(t));
      }
      if (st !== 200) { res.writeHead(st, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"mock"}}'); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `${model} 的回答` } }] })}\n\ndata: [DONE]\n\n`);
    });
  }).listen(8790);
  const b = await chromium.launch({ channel: 'chrome' });
  const page = await (await b.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  page.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
  const bodies = []; page.on('request', r => r.url().endsWith('/api/chat') && bodies.push(JSON.parse(r.postData())));
  await page.goto(base); await page.click('.cfab');
  const askOnce = async (q, r) => {
    reply = r; seen = [];
    await page.fill('.cin textarea', q); await page.press('.cin textarea', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.cin button').disabled);
    return page.$$eval('.cm.a', l => [l.at(-1).className.includes('err'), l.at(-1).textContent]);
  };
  eq('flash answers, no note', [await askOnce('一', {}), seen], [[false, 'deepseek-flash 的回答'], ['deepseek-flash']]);
  eq('flash busy, cloudflare fails → v4-pro answers, no model named', [await askOnce('二', { 'deepseek-flash': 503 }), seen],
    [[false, 'deepseek-v4-pro 的回答'], ['deepseek-flash', 'deepseek-v4-pro']]);
  eq('flash 500 → v4-pro', [(await askOnce('三', { 'deepseek-flash': 500 }))[0], seen], [false, ['deepseek-flash', 'deepseek-v4-pro']]);
  eq('note not sent back as history', bodies.at(-1).messages.at(-2).content, 'deepseek-v4-pro 的回答');
  eq('every model fails, none busy → unavailable with each status', [await askOnce('四', { 'deepseek-flash': 401, 'deepseek-v4-pro': 401 }), seen],
    [[true, '规则助手暂时不可用（401/0/401），请稍后再试'], ['deepseek-flash', 'deepseek-v4-pro']]);
  eq('both busy → busy message', [await askOnce('五', { 'deepseek-flash': 503, 'deepseek-v4-pro': 503 }), seen],
    [[true, 'AI 服务器都在忙，请过一两分钟再问'], ['deepseek-flash', 'deepseek-v4-pro']]);
  const t0 = Date.now();
  eq('flash queueing → v4-pro answers after 9 s', [(await askOnce('六', { 'deepseek-flash': 'queue' }))[0], seen], [false, ['deepseek-flash', 'deepseek-v4-pro']]);
  console.log('  took', Date.now() - t0, 'ms');
  const t1 = Date.now();
  eq('both queueing → busy message before the page gives up', [await askOnce('七', { 'deepseek-flash': 'queue', 'deepseek-v4-pro': 'queue' }), seen],
    [[true, 'AI 服务器都在忙，请过一两分钟再问'], ['deepseek-flash', 'deepseek-v4-pro']]);
  console.log('  took', Date.now() - t1, 'ms');
  const t2 = Date.now();
  eq('flash stalls mid-answer → partial dropped, v4-pro answers from the start',
    [await askOnce('八', { 'deepseek-flash': 'stall' }), seen],
    [[false, 'deepseek-v4-pro 的回答'], ['deepseek-flash', 'deepseek-v4-pro']]);
  console.log('  took', Date.now() - t2, 'ms');
  await wait(15000);   // nine questions: stay under the server's 8-per-minute limit
  const [err9, text9] = await askOnce('九', { 'deepseek-flash': 'stall', 'deepseek-v4-pro': 'stall' });
  eq('stalled partial not kept as history', bodies.at(-1).messages.slice(-3).map(m => m.content), ['八', 'deepseek-v4-pro 的回答', '九']);
  eq('every model stalls → partial kept, busy message', [err9, text9, seen], [true, 'deepseek-v4-pro 答了一半AI 服务器都在忙，请过一两分钟再问', ['deepseek-flash', 'deepseek-v4-pro']]);
  await page.screenshot({ path: out + '/chat_fallback.png' });
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
}

if (mode === '--mock-web') {
  // Web search when the tutorial and FAQ don't cover a question. Same wrangler dev flags as --mock-upstream.
  // The mock model asks to search for questions containing 「网上」; the mock search API answers per `search`.
  const { createServer } = await import('node:http');
  let search = 'ok', asked = [];   // search: 'ok' | 'empty' | 'fail'; asked: search queries received
  const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const j = JSON.parse(body);
      if (req.url === '/v1/tools/search') {
        asked.push(j.query);
        if (search === 'fail') { res.writeHead(500); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ results: search === 'empty' ? [] : [
          { title: 'Oil city question <b>', url: 'https://boardgamegeek.com/thread/1', site_name: 'BoardGameGeek', summary: 'Designer: yes, you may.', rerank_score: 2.1, authority: 3 },
          { title: '卷土重来讨论', url: 'https://example.cn/a', site_name: null, snippet: '网友说可以。' }] }));
      }
      const sys = j.messages[0].content, q = j.messages.at(-1).content;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (sys.includes('联网搜索到的网页摘要')) return res.end(sse(`依据网上说法：可以 [1]（摘要条数 ${(sys.match(/^\[\d\] /gm) || []).length}）`));
      if (q.includes('先解释')) {   // the model explains first and asks to search at the end
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '资料里没有提到这一点。' } }] })}\n\n`);
        return setTimeout(() => res.end(sse('\n\n【需联网】Flip 7 river')), 300);
      }
      if (q.includes('网上')) {   // the marker arrives split over two chunks, like a real stream
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '【需' } }] })}\n\n`);
        return setTimeout(() => res.end(sse('联网】Flip 7 oil city')), 200);
      }
      res.end(sse(q.includes('无关') ? '我只解答 7连翻规则。' : '资料里的回答'));
    });
  }).listen(8790);
  const b = await chromium.launch({ channel: 'chrome' });
  const page = await (await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  page.on('pageerror', e => { fails++; console.log('FAIL page error', e.message); });
  const bodies = []; page.on('request', r => r.url().endsWith('/api/chat') && bodies.push(JSON.parse(r.postData())));
  await page.goto(base); await page.click('.cfab');
  const askOnce = async (q, s) => {
    search = s; asked = [];
    await page.fill('.cin textarea', q); await page.press('.cin textarea', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.cin button').disabled);
    return page.$$eval('.cm.a', l => { const a = l.at(-1); return { err: a.className.includes('err'), label: !!a.querySelector('.cweb'),
      text: [...a.childNodes].filter(n => !n.classList?.contains('cweb') && !n.classList?.contains('csrc')).map(n => n.textContent).join(''),
      src: [...a.querySelectorAll('.csrc a')].map(x => [x.textContent, x.getAttribute('href'), x.target]) }; });
  };
  eq('covered by the notes: answered directly, no search', [await askOnce('×2 怎么算？', 'ok'), asked],
    [{ err: false, label: false, text: '资料里的回答', src: [] }, []]);
  eq('not covered: searched with the model\'s words, labelled, sources listed', [await askOnce('网上怎么说卷土重来？', 'ok'), asked],
    [{ err: false, label: true, text: '依据网上说法：可以 [1]（摘要条数 2）',
       src: [['[1] Oil city question <b>BoardGameGeek', 'https://boardgamegeek.com/thread/1', '_blank'], ['[2] 卷土重来讨论example.cn', 'https://example.cn/a', '_blank']] }, ['Flip 7 oil city site:boardgamegeek.com', 'Flip 7 oil city']]);
  await page.screenshot({ path: out + '/chat_web.png' });
  eq('the search request never reaches the page as text', (await page.$$eval('.cm.a', l => l.map(x => x.textContent).join(''))).includes('需联网'), false);
  eq('nothing found: says so, no label, nothing made up', [await askOnce('网上还有啥？', 'empty'), asked.length],
    [{ err: false, label: false, text: '本站资料里没有这一条，网上也没找到可靠的说法。建议翻一下规则书，或者问问桌上的老玩家。', src: [] }, 2]);
  eq('web answer goes back as plain history (no label, no sources)', bodies.at(-1).messages.slice(-3).map(m => m.content),
    ['网上怎么说卷土重来？', '依据网上说法：可以 [1]（摘要条数 2）', '网上还有啥？']);
  eq('search API down: says so', (await askOnce('网上第三问？', 'fail')).text, '本站资料里没有这一条，联网查找也失败了，请过一会儿再问，或者翻一下规则书。');
  eq('off-topic: no search', [(await askOnce('无关的问题', 'ok')).text, asked], ['我只解答 7连翻规则。', []]);
  eq('search asked for at the end of an explanation: explanation dropped, searched', [await askOnce('先解释再查', 'ok'), asked],
    [{ err: false, label: true, text: '依据网上说法：可以 [1]（摘要条数 2）',
       src: [['[1] Oil city question <b>BoardGameGeek', 'https://boardgamegeek.com/thread/1', '_blank'], ['[2] 卷土重来讨论example.cn', 'https://example.cn/a', '_blank']] }, ['Flip 7 river site:boardgamegeek.com', 'Flip 7 river']]);
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
}

const b = await chromium.launch({ channel: 'chrome' });
const page = await (await b.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const lastAnswer = () => page.$$eval('.cm.a', l => l.at(-1).textContent);
await page.goto(base); await page.waitForSelector('.cfab');
eq('button shown bottom right', await page.isVisible('.cfab'), true);
await page.click('.cfab'); await wait(200);
eq('panel opens', await page.isVisible('.cpanel'), true);
eq('button hidden while open', await page.isVisible('.cfab'), false);

if (mode === '--live') {
  await page.fill('.cin textarea', '×2 和加分牌先算哪个？'); await page.press('.cin textarea', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.cin button').disabled, null, { timeout: 60000 });
  const a = await lastAnswer();
  console.log('answer:', a);
  eq('real answer, no error', await page.$('.cm.err'), null);
  eq('answer mentions order by spending', /少|顺序|相对/.test(a), true);
  await page.screenshot({ path: out + '/chat_live.png' });
} else {
  // not configured: the error shows in the chat and the question can be asked again
  await page.click('.csug button'); await page.waitForSelector('.cm.err');
  eq('not-configured error shown', (await page.textContent('.cm.err')).includes('还没有配置好'), true);
  eq('suggestions removed after asking', await page.$('.csug'), null);
  // streamed answer (mocked endpoint): pieces join, **bold** renders, history goes along with the next question
  const bodies = [];
  await page.route('**/api/chat', async route => {
    bodies.push(JSON.parse(route.request().postData()));
    const ev = s => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ev('花得**最少**的') + ev('先行动；\n同额保持') + ev('原相对顺序。') + 'data: [DONE]\n\n' });
  });
  await page.fill('.cin textarea', '×2 怎么算？'); await page.press('.cin textarea', 'Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm.a')].at(-1)?.textContent.includes('原相对顺序'));
  eq('streamed answer joined', await lastAnswer(), '花得最少的先行动；同额保持原相对顺序。');
  eq('bold rendered', await page.$$eval('.cm.a', l => l.at(-1).querySelector('b').textContent), '最少');
  eq('failed question not sent again', bodies[0].messages.length, 1);
  await page.fill('.cin textarea', '那 +15 呢？'); await page.click('.cin button'); await wait(500);
  eq('history sent with next question', bodies[1].messages.map(m => m.role), ['user', 'assistant', 'user']);
  // a long chat: past 10 questions only the last 10 messages go out (the server rejects over 20)
  for (let i = 0; i < 10; i++) {
    const n = bodies.length;
    await page.fill('.cin textarea', `第${i + 3}问`); await page.press('.cin textarea', 'Enter');
    await page.waitForFunction(n => !document.querySelector('.cin button').disabled && document.querySelectorAll('.cm.a').length >= n + 2, n);
  }
  const lastBody = bodies.at(-1).messages;
  eq('12th question sends last 10 messages', [lastBody.length, lastBody.at(-1).content], [10, '第12问']);
  eq('no error in a long chat', await page.$$eval('.cm.err', l => l.length), 1);   // only the not-configured one at the start
  await page.screenshot({ path: out + '/chat_panel.png' });
  // DeepSeek queueing: no text for 30 s → stop waiting with a clear message (clock faked so the test is quick)
  const p2 = await (await b.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  p2.on('pageerror', e => errs.push(e.message));
  await p2.clock.install();
  await p2.route('**/api/chat', () => {});   // never answers
  await p2.goto(base); await p2.click('.cfab'); await p2.click('.csug button');
  await p2.clock.fastForward(29000);
  eq('still waiting at 29 s', [await p2.$('.cm.err'), await p2.isDisabled('.cin button')], [null, true]);
  await p2.clock.fastForward(2000); await p2.waitForSelector('.cm.err');
  eq('gives up at 30 s with busy message', (await p2.textContent('.cm.err')).includes('30 秒还没开始回答'), true);
  eq('can ask again after timeout', await p2.isDisabled('.cin button'), false);
  await p2.close();
  // dropped connection: the raw browser error is shown and reported to the server log
  const p3 = await (await b.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  const logs = []; p3.on('request', r => r.url().endsWith('/api/chat-log') && logs.push(JSON.parse(r.postData())));
  await p3.route('**/api/chat', r => r.abort('failed'));
  await p3.goto(base); await p3.click('.cfab'); await p3.click('.csug button'); await p3.waitForSelector('.cm.err'); await wait(300);
  eq('network error shows the raw error', (await p3.textContent('.cm.err')).startsWith('网络连接失败，请检查网络后再试（TypeError: Failed to fetch）'), true);
  eq('network error reported', logs.map(l => [l.err, l.got]), [['TypeError: Failed to fetch', 0]]);
  await p3.close();
  await page.goto(base); await page.click('.cfab'); await wait(400);
  await page.screenshot({ path: out + '/chat_welcome.png' });
  await page.click('.cx'); await wait(200);
  eq('panel closes', [await page.isVisible('.cpanel'), await page.isVisible('.cfab')], [false, true]);
  await page.goto(api('/teach')); await page.waitForSelector('.cfab');
  eq('button on teach page', await page.isVisible('.cfab'), true);
  await page.goto(api('/history')); await page.waitForSelector('.cfab');
  eq('button on history page', await page.isVisible('.cfab'), true);
}
eq('no page errors', errs, []);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
