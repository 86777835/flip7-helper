import { MINUTES } from './teach-data.js';
import { TARGET, END_COOLDOWN_MS, BRUTAL_HIT, VERSIONS, SPECIAL, modText, cleanEntry, entryScore, roundScores, runningTotals, totals, dealerOf, standing, roundWarnings, results } from './logic.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const newId = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');
const VER_PARAM = new URLSearchParams(location.search).get('v');   // the hub links /?v=base or /?v=veng

let code = cleanCode(new URLSearchParams(location.search).get('r'));
let S = null, noRoom = false, online = false, ws = null, queue = [], retry = 0;
const ui = { ver: VERSIONS[VER_PARAM] ? VER_PARAM : store.get('f7-ver') || 'base', sheet: null, err: '', busy: false, rooms: null, saving: false, rv: null, ended: 0 };

// Card pictures cut from the official rulebooks (img/c/). Number n, modifier m, special number s.
const IMG = {
  base: { n: n => `b${n}`, m: m => m === 'x2' ? 'bx2' : 'bm' + m.slice(1) },
  veng: { n: n => `v${n}`, m: m => m === '/2' ? 'vd2' : 'vm' + m.slice(1), s: s => 'v' + s }
};
const img = (id, cls = '') => `<img class="${cls}" src="img/c/${id}.webp" alt="" loading="lazy">`;

// Rooms this phone has been in, newest first.
function mine() { try { const v = JSON.parse(store.get('f7-mine')); if (Array.isArray(v)) return v; } catch {} return []; }
const remember = c => store.set('f7-mine', JSON.stringify([c, ...mine().filter(x => x !== c)].slice(0, 8)));
const forget = c => store.set('f7-mine', JSON.stringify(mine().filter(x => x !== c)));
const meId = () => { const id = store.get('f7-me-' + code); return S && S.players.some(p => p.id === id) ? id : null; };
function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 1440)} 天前`;
}
function cleanCode(v) { const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); return c.length === 4 ? c : null; }

async function loadRooms() {
  if (code) return;
  try { const r = await fetch('/api/rooms'); if (r.ok) { ui.rooms = await r.json(); render(); } } catch {}
}
setInterval(() => { if (!code && !document.hidden) loadRooms(); }, 8000);

/* ---------- connection ---------- */
function connect() {
  if (!code) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/room/${code}/ws`);
  ws.onopen = () => { retry = 0; online = true; queue.splice(0).forEach(m => ws.send(m)); render(); };
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data);
    if (m.type === 'state') {
      const before = S;
      S = m.state; window.flip7Ver = S.ver; remember(code);
      if (before && S.rounds.length > before.rounds.length) {   // a round just ended: lock 「本轮结束」 a moment on every phone
        ui.ended = Date.now(); clearTimeout(ui.lockTimer); ui.lockTimer = setTimeout(render, END_COOLDOWN_MS + 50);
        if (ui.sheet?.kind === 'entry' && ui.sheet.r === before.rounds.length) ui.sheet = null;
        toast(S.stage === 'over' ? '游戏结束！' : `第 ${S.rounds.length} 轮已结束，第 ${S.rounds.length + 1} 轮开始`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      render();
    } else if (m.type === 'error' && m.error === 'noroom') { noRoom = true; forget(code); ws.close(); render(); }
  };
  ws.onclose = () => { online = false; render(); if (!noRoom && code) setTimeout(connect, Math.min(5000, 400 * 2 ** retry++)); };
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 25000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && code && !noRoom && (!ws || ws.readyState > 1)) { retry = 0; connect(); }
});
function send(action) {
  const m = JSON.stringify({ action });
  if (ws && ws.readyState === 1) ws.send(m); else queue.push(m);
}
const pending = new Map();   // debounced name edits: key -> { timer, flush }
function debounced(key, fn, delay = 400) {
  const old = pending.get(key); if (old) clearTimeout(old.timer);
  const entry = { flush() { clearTimeout(entry.timer); pending.delete(key); fn(); } };
  entry.timer = setTimeout(entry.flush, delay);
  pending.set(key, entry);
}
const flushAll = () => [...pending.values()].forEach(p => p.flush());

/* ---------- helpers ---------- */
const P = id => S.players.find(p => p.id === id);
const pname = id => P(id)?.name ?? '';
const verName = v => VERSIONS[v].full;
function toast(t) { const el = $('#toast'); el.innerHTML = `<div class="toast">${esc(t)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => el.innerHTML = '', 2000); }

/* ---------- render (DOM morph keeps focus and typed text) ---------- */
function morph(a, b) {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  bc.forEach((y, i) => {
    const x = ac[i];
    if (!x) { a.appendChild(y); return; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.getAttribute('data-k') !== y.getAttribute('data-k'))) { a.replaceChild(y, x); return; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if (x.tagName === 'INPUT') {
      if (x.type === 'checkbox') { x.checked = y.hasAttribute('checked'); return; }
      const v = y.getAttribute('value') ?? '';
      if (x !== document.activeElement && !pending.has(x.dataset.pk) && x.value !== v) x.value = v;
      return;
    }
    if (x.tagName === 'DETAILS') { morph(x, y); return; }   // keep it open or shut as the user left it
    if ('disabled' in x) x.disabled = y.hasAttribute('disabled');
    morph(x, y);
  });
  while (a.childNodes.length > bc.length) a.removeChild(a.lastChild);
}
function render() {
  const t = document.createElement('div');
  t.innerHTML = view();
  morph($('#app'), t);
  const s = document.createElement('div');
  s.innerHTML = ui.sheet && S ? sheetView() : '';
  morph($('#sheet'), s);
}

function view() {
  if (!code) return landing();
  if (noRoom) return `${bar()}<div class="wrap"><h2 class="h">房间 ${code} 不存在</h2><p class="note">房间码可能输错了，或者房间已失效。</p><button class="btn" data-act="leave">返回首页</button></div>`;
  if (!S) return `${bar()}<div class="wrap"><h2 class="h">正在连接房间 ${code}…</h2><p class="note">网络慢时要等几秒；一直连不上，可以退出后重新输入房间码。</p></div>`;
  return bar() + `<div class="wrap" data-k="st-${S.stage}">` + (S.stage === 'setup' ? setupView() : S.stage === 'over' ? overView() : playView()) + '</div>';
}
const bar = () => `<div class="bar" data-k="bar"><button class="back" data-act="leave" data-html2canvas-ignore>‹ 首页</button>
  <span class="ttl">7连翻${S ? `<small>${S.ver === 'veng' ? (S.brutal ? '冤家·残酷' : '冤家路窄') : '原版'}</small>` : ''}</span>
  <button class="room" data-act="share"><small>房间</small>${code}<small>邀请</small></button><span class="conn ${online ? 'on' : ''}" title="${online ? '已连接' : '重新连接中'}"></span></div>`;

/* ---------- landing ---------- */
function landing() {
  const rooms = ui.rooms, my = mine();
  const stageText = r => r.stage === 'setup' ? '准备中' : r.stage === 'over' ? '已结束' : `第 ${r.round} 轮`;
  const listed = rooms && rooms.slice().sort((a, b) => my.includes(b.code) - my.includes(a.code));
  const unlisted = rooms ? my.filter(c => !rooms.some(r => r.code === c)) : [];
  const roomList = rooms === null ? '<div class="empty">加载中…</div>' : listed.length + unlisted.length ? listed.map(r => `
      <button class="card lobby" data-act="rejoin" data-code="${r.code}" data-k="lb-${r.code}">
        <span class="lc">${r.code}${my.includes(r.code) ? '<em>我的</em>' : ''}</span>
        <span class="lp">${esc(r.players.join('、')) || '还没有玩家'}<small>${r.ver === 'veng' ? '冤家路窄' : '原版'} · ${r.players.length} 人</small></span>
        <span class="ls"><b>${stageText(r)}</b>${r.online ? `<i class="od"></i>${r.online} 人在线` : ago(r.updated)}</span>
      </button>`).join('') + unlisted.map(c => `
      <button class="card lobby" data-act="rejoin" data-code="${c}" data-k="lb-${c}"><span class="lc">${c}<em>我的</em></span><span class="lp"></span><span class="ls">点击进入</span></button>`).join('')
    : '<div class="empty">暂无进行中的房间</div>';
  const back = encodeURIComponent(location.href);
  return `<div class="hero" data-k="hero"><a class="nav l" href="https://boardgame.leisurecat.cloud">‹ 全部游戏</a><a class="nav r" href="https://boardgame.leisurecat.cloud/?rate=${VERSIONS[ui.ver].game}&back=${back}">★ 写评价</a>
      <div class="fan">${img('b0')}${img('b7')}${img('b12')}</div>
      <h1><b>7</b>连翻助手</h1><div class="sub">点牌算分 · 累计到 200 不烧心</div></div><div class="rainbow"></div>
    <div class="wrap" data-k="landing">
    <div class="card start">
      <div class="lbl">玩哪一版？</div>
      <div class="seg">${['base', 'veng'].map(v => `<button class="${ui.ver === v ? 'on' : ''}" data-act="pickver" data-v="${v}">${v === 'base' ? '《7连翻》<small>原版</small>' : '《冤家路窄》<small>With a Vengeance</small>'}</button>`).join('')}</div>
      <button class="btn" data-act="create" ${ui.busy ? 'disabled' : ''}>创建新房间</button>
      <div class="or">或输入房间码加入</div>
      <div class="field"><input id="joinCode" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="房间码"><button class="btn navy" data-act="join">加入</button></div>
      ${ui.err ? `<div class="err">${esc(ui.err)}</div>` : ''}
    </div>
    <a class="card teachgo" href="teach?v=${ui.ver}"><span class="tg">讲</span><span><b>第一次玩？${MINUTES[ui.ver]} 分钟讲规则</b><span>照着念就能开局，不懂的牌点一下看图</span></span><i>›</i></a>
    <div class="tiles">
      <a class="card tile" href="teach?v=${ui.ver}#later"><span class="ti">?</span><span><b>注意事项</b><small>易错规则写好答案</small></span></a>
      <a class="card tile" href="history"><span class="ti">录</span><span><b>往期对局</b><small>战绩查询</small></span></a>
    </div>
    <h2 class="h">房间<small>${rooms && rooms.length ? `${rooms.length} 个` : ''}</small></h2>
    <div class="list">${roomList}</div>
    <footer>非官方玩家工具 · 卡牌图片截自 The Op 官方规则书，版权归 USAopoly 所有</footer></div>`;
}

/* ---------- setup ---------- */
function setupView() {
  const me = meId(), n = S.players.length;
  const meCard = me
    ? `<div class="card me" data-k="me"><div class="who">这台手机是 <b>${esc(pname(me))}</b><span class="note" style="margin:0">（下面可以改名）</span></div></div>`
    : `<div class="card me" data-k="me-join"><div class="note" style="margin:0 0 8px">先把自己加进来：之后每轮在自己手机上录分。</div>
        <div class="field"><input id="meName" maxlength="12" placeholder="你的名字" enterkeyhint="done"><button class="btn" data-act="joinme">加入</button></div></div>`;
  return `
    <h2 class="h">版本</h2>
    <div class="seg">${['base', 'veng'].map(v => `<button class="${S.ver === v ? 'on' : ''}" data-act="ver" data-v="${v}">${v === 'base' ? '《7连翻》<small>原版</small>' : '《冤家路窄》<small>With a Vengeance</small>'}</button>`).join('')}</div>
    ${S.ver === 'veng' ? `<label class="card toggle"><input type="checkbox" data-act="brutal" ${S.brutal ? 'checked' : ''}><span><b>残酷模式</b>（规则书第 7 页）：本轮得分可以是负数；修正牌也能给已爆的人；七连翻的人可以不拿 15 分，改成扣别人 15 分。</span></label>` : ''}
    <h2 class="h">我是</h2>${meCard}
    <h2 class="h">玩家<small>按座位顺时针排 · ${n} 人</small></h2>
    <div class="list">${S.players.map((p, i) => `
      <div class="card seat" data-k="seat-${p.id}">
        <span class="no">${i + 1}</span>
        <input data-pk="ren-${p.id}" data-ren="${p.id}" value="${esc(p.name)}" maxlength="12" enterkeyhint="done" aria-label="玩家名">
        ${p.id === me ? '<span class="tag">我</span>' : ''}
        <button class="dl ${S.dealer0 === p.id ? 'on' : ''}" data-act="dealer" data-id="${p.id}">${S.dealer0 === p.id ? '先发牌' : '设为发牌'}</button>
        <button class="ib" data-act="move" data-id="${p.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
        <button class="ib" data-act="move" data-id="${p.id}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        <button class="ib" data-act="remove" data-id="${p.id}" aria-label="移除">×</button>
      </div>`).join('') || '<div class="empty">还没有玩家。每人用自己手机扫码进房间加入，或者在下面代加。</div>'}</div>
    <div class="field" style="margin-top:10px"><input id="otherName" maxlength="12" placeholder="代加没带手机的人" enterkeyhint="done"><button class="btn navy" data-act="addother">代加</button></div>
    <button class="btn ghost" data-act="order" ${n ? '' : 'disabled'}>手指轮盘 / 抽签定谁先发牌 ›</button>
    <p class="note">定好后回到这里，点那个人的「设为发牌」。发牌人从自己左手边开始、顺时针给每人发一张（最后发给自己）；之后每轮轮到左手边的人发牌，本站会自动轮换。</p>
    ${n && n < 3 ? '<p class="note">官方是 3 人起。1～2 人可以玩规则书最后一页的挑战：看几轮能打到 200 分。</p>' : ''}
    ${n > 18 ? '<p class="note">超过 18 人，规则书建议加一副牌。</p>' : ''}
    <button class="btn" data-act="start" ${n ? '' : 'disabled'}>开始游戏</button>`;
}

/* ---------- in game ---------- */
function rcChip(e, sc) {
  if (!e) return '<span class="rc miss">未录</span>';
  if (e.m === 'bust') return '<span class="rc bust">爆了</span>';
  return `<span class="rc ${sc.f7 ? 'f7' : 'ok'}">${sc.f7 ? '七连翻 ' : ''}${sc.pts >= 0 ? '+' : ''}${sc.pts}</span>`;
}
function playView() {
  const r = S.rounds.length, dealer = dealerOf(S, r), me = meId();
  const T = totals(S), st = standing(S), max = Math.max(...Object.values(T));
  const order = S.players.map((p, i) => ({ id: p.id, i })).sort((a, b) => T[b.id] - T[a.id] || a.i - b.i);
  const place = id => 1 + S.players.filter(p => T[p.id] > T[id]).length;
  const missing = S.players.filter(p => !S.cur[p.id]);
  const warns = roundWarnings(S, S.cur);
  const locked = Date.now() - ui.ended < END_COOLDOWN_MS;
  const curSc = roundScores(S, S.cur);
  const myE = me && S.cur[me];
  return `
    <div class="card status" data-k="status"><div class="rd">第<b>${r + 1}</b>轮</div>
      <div class="dl">发牌人 <b>${esc(pname(dealer))}</b><small>从他左手边开始发牌 · <a href="#" data-act="dealerSheet">换人</a></small></div>
      <div class="tg">目标<b>${TARGET}</b></div></div>
    ${st.tie ? `<div class="banner" data-k="tie"><b>最高分并列</b>：${st.top.map(id => esc(pname(id))).join('、')} 都是 ${st.max} 分。按官方 FAQ，<b>全员</b>加赛一轮，直到只有一个最高分。</div>`
      : max >= TARGET * 0.8 && r ? `<div class="banner" data-k="near">快到了：一轮结束时有人到 ${TARGET} 分、并且最高分只有一人，游戏就结束。<b>不是先到 ${TARGET} 就赢</b>，看这一轮结束时谁最高。</div>` : ''}
    ${me ? `<button class="btn mine" data-act="entry" data-id="${me}" data-r="${r}" data-k="mine">${myE ? `我这轮：${myE.m === 'bust' ? '爆了' : (curSc[me].f7 ? '七连翻 ' : '') + curSc[me].pts + ' 分'} · 改` : '录我这一轮的分'}</button>` : '<p class="note" data-k="nome">这台手机还没有绑定玩家：点下面自己的名字就能录分。</p>'}
    <h2 class="h">总分<small>点名字替他录分</small></h2>
    <div class="board">${order.map(({ id }) => {
      const e = S.cur[id], pct = Math.max(0, Math.min(100, T[id] / TARGET * 100));
      return `<button class="card pl ${id === me ? 'me' : ''} ${T[id] === max && max > 0 ? 'lead' : ''}" data-act="entry" data-id="${id}" data-r="${r}" data-k="pl-${id}">
        <span class="rk">${place(id)}</span>
        <span class="nm">${esc(pname(id))}${id === me ? '<em>我</em>' : ''}${id === dealer ? '<i>发牌</i>' : ''}</span>
        <span class="tt">${T[id]}<small>${T[id] >= TARGET ? '已过 200' : `还差 ${TARGET - T[id]}`}</small></span>
        <span><span class="bar2" style="display:block"><i style="width:${pct}%"></i></span><span class="meta">本轮 ${rcChip(e, curSc[id])}${curSc[id].hitBy.length ? `<span>被扣 ${curSc[id].hitBy.length * BRUTAL_HIT}</span>` : ''}</span></span>
      </button>`;
    }).join('')}</div>
    ${warns.length ? `<div class="warn" data-k="warn"><b>核对一下</b><ul>${warns.map(w => `<li>${esc(w.text)}（${w.who.map(id => esc(pname(id))).join('、')}）</li>`).join('')}</ul>${S.players.length > 18 ? '' : '<span class="note">只是提醒：录错了点名字改；确实没错（比如用了两副牌）可以直接结束本轮。</span>'}</div>` : ''}
    ${locked ? `<button class="btn" disabled data-k="endbtn">第 ${r} 轮刚刚结束</button>`
      : `<button class="btn" data-act="end" data-k="endbtn" ${missing.length ? 'disabled' : ''}>${missing.length ? `还差 ${missing.length} 人没录：${missing.slice(0, 4).map(p => esc(p.name)).join('、')}${missing.length > 4 ? '…' : ''}` : `第 ${r + 1} 轮结束，算总分`}</button>`}
    ${logCard()}
    <div class="btns"><button class="btn ghost" data-act="undo" ${r ? '' : 'disabled'}>撤销上一轮</button><button class="btn ghost" data-act="reset">重新开局</button></div>`;
}

// Every round's scores; tap a cell to change it.
function logCard(open = false, plain = false) {
  if (!S.rounds.length) return '';
  const run = runningTotals(S);
  const table = `<div class="lgw"><table class="lg"><thead><tr><th>轮</th>${S.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${S.rounds.map((R, k) => { const sc = roundScores(S, R.e); return `<tr><th>${k + 1}<div class="dlr">${esc(pname(R.dealer))}发</div></th>${S.players.map(p => {
      const x = sc[p.id], e = R.e[p.id];
      const txt = !e ? '—' : x.bust && !x.hitBy.length ? '爆' : `${x.total}${x.f7 ? '★' : ''}`;
      return `<td><button class="${x.bust ? 'b' : x.f7 ? 'f' : ''}" data-act="entry" data-id="${p.id}" data-r="${k}">${txt}</button></td>`;
    }).join('')}</tr>`; }).join('')}</tbody>
    <tfoot><tr><td>总分</td>${S.players.map(p => `<td>${run.at(-1)[p.id]}</td>`).join('')}</tr></tfoot></table></div>`;
  if (plain) return `<h2 class="h">逐轮得分<small data-html2canvas-ignore>★ 七连翻 · 点分数可以改</small></h2><div class="card" style="padding-top:8px">${table}</div>`;
  return `<details class="card log" data-k="log" ${open ? 'open' : ''}><summary>逐轮得分（${S.rounds.length} 轮）· 点分数可以改</summary>${table}</details>`;
}

/* ---------- results ---------- */
function overView() {
  const R = results(S), top = R.rows.filter(r => r.place === 1), champ = top[0];
  const solo = S.players.length <= 2;
  return `<div id="shot">
    <div class="card champ" data-k="champ"><div class="cr">${solo ? '挑 战 完 成' : '冠 军'}</div>
      <div class="nm">${top.map(r => esc(r.name)).join(' · ')}</div>
      <div class="pts">${champ.total}<small>分</small></div>
      <div class="sub">${solo ? `用了 ${R.rounds} 轮打到 ${TARGET} 分` : `第 ${R.rounds} 轮结束时过 ${TARGET} 分且最高`} · ${verName(S.ver)}${S.brutal ? '残酷模式' : ''}</div></div>
    <h2 class="h">排名</h2>
    <div class="board rkl">${R.rows.map(r => `<div class="card pl ${r.place === 1 ? 'lead' : ''}" data-k="rk-${r.id}"><span class="rk">${r.place}</span>
      <span class="nm">${esc(r.name)}</span><span class="tt">${r.total}</span>
      <span class="stats"><span>七连翻 <b>${r.f7}</b></span><span>爆牌 <b>${r.bust}</b></span><span>单轮最高 <b>${r.best}</b></span>${r.hits ? `<span>扣人 <b>${r.hits}</b></span>` : ''}</span></div>`).join('')}</div>
    ${R.ach.length ? `<h2 class="h">成就</h2><div class="achs">${R.ach.map(a => `<div class="card ach" data-k="ach-${a.k}"><span class="md">${a.ch}</span><div style="min-width:0"><div class="an">${a.name}</div><div class="ad">${a.desc}</div><div class="aw">${a.who.map(id => esc(pname(id))).join('、')}</div></div></div>`).join('')}</div>` : ''}
    ${logCard(true, true)}
    </div>
    <div class="btns" data-k="ovb"><button class="btn navy" data-act="shot" ${ui.saving ? 'disabled' : ''}>${ui.saving ? '正在生成…' : '保存结算长图'}</button><button class="btn" data-act="again">再来一局</button></div>
    <div class="btns"><button class="btn ghost" data-act="undo">撤销最后一轮</button><button class="btn ghost" data-act="reset">重新开局</button></div>
    <p class="note">「再来一局」保留同一批人和座位，由下一位玩家先发牌。</p>
    ${reviewCard()}`;
}

/* ---------- rating this game (stars + comment), shown on the hub boardgame.leisurecat.cloud ---------- */
const REVIEW_API = 'https://boardgame.leisurecat.cloud/api/reviews';
const STAR_TXT = ['点星星打分', '不推荐', '一般', '还行', '好玩', '超好玩'];
const rvKey = () => `f7-rv-${code}-${S.gid}`;
const savedReview = () => { try { return JSON.parse(store.get(rvKey())) || {}; } catch { return {}; } };
function reviewCard() {
  if (ui.rv?.key !== rvKey()) ui.rv = { who: meId(), stars: 0, text: '', state: '', err: '', ...savedReview(), key: rvKey() };
  const rv = ui.rv;
  if (rv.state === 'sent') return `<div class="card rv" data-k="rv"><div class="rv-done">${'★'.repeat(rv.stars)}${'☆'.repeat(5 - rv.stars)}</div>
    <p>谢谢 ${esc(pname(rv.who))} 的评价！</p><div class="btns"><button class="btn ghost" data-act="rv-edit">修改评价</button><a class="btn navy" href="https://boardgame.leisurecat.cloud">看大家的评价</a></div></div>`;
  return `<h2 class="h">给${verName(S.ver)}打个分</h2><div class="card rv" data-k="rv">
    <div class="rv-l">我是</div><div class="rv-who">${S.players.map(p => `<button class="${rv.who === p.id ? 'on' : ''}" data-act="rv-who" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="rv-st">${[1, 2, 3, 4, 5].map(n => `<button class="${n <= rv.stars ? 'on' : ''}" data-act="rv-star" data-n="${n}" aria-label="${n} 星">★</button>`).join('')}<span>${STAR_TXT[rv.stars]}</span></div>
    <textarea data-rv placeholder="说说这局的感受（可不填）" maxlength="300">${esc(rv.text)}</textarea>
    <button class="btn" data-act="rv-send" ${!rv.who || !rv.stars || rv.state === 'sending' ? 'disabled' : ''}>${rv.state === 'sending' ? '提交中…' : '提交评价'}</button>
    ${rv.err ? `<p class="err">${esc(rv.err)}</p>` : ''}
    <p class="note">评价和玩家名会显示在「桌游小助手」首页，并计入这款游戏的整体评分。同一局再次提交会覆盖之前的评价。</p></div>`;
}
async function sendReview() {
  const rv = ui.rv;
  rv.state = 'sending'; rv.err = ''; render();
  try {
    const r = await fetch(REVIEW_API, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: VERSIONS[S.ver].game, stars: rv.stars, name: pname(rv.who), text: rv.text, room: code }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `提交失败（${r.status}）`);
    rv.state = 'sent';
    store.set(rvKey(), JSON.stringify({ who: rv.who, stars: rv.stars, text: rv.text, state: 'sent' }));
  } catch (e) {
    rv.state = ''; rv.err = e.message === 'Failed to fetch' || e.message === 'Load failed' ? '网络连接失败，请稍后再试' : e.message;
  }
  render();
}

/* ---------- results as one long image ---------- */
const loadScript = src => new Promise((ok, fail) => {
  if (window.html2canvas) return ok();
  const el = document.createElement('script');
  el.src = src; el.onload = ok; el.onerror = () => fail(new Error('截图组件加载失败'));
  document.head.appendChild(el);
});
async function saveImage() {
  ui.saving = true; render();
  try {
    await loadScript('vendor/html2canvas.min.js');
    const canvas = await window.html2canvas($('#shot'), {
      scale: Math.max(2, window.devicePixelRatio || 1), backgroundColor: '#fdf6dc',
      onclone: doc => {
        const c = doc.getElementById('shot');
        c.style.cssText = 'margin:0 -14px;padding:18px 14px 14px';
        c.insertAdjacentHTML('afterbegin', `<div style="text-align:center;padding-bottom:4px"><div style="font:900 22px var(--sans);color:var(--navy);letter-spacing:3px">${verName(S.ver)}</div>
          <div style="font:500 12px var(--sans);color:var(--ink2);margin-top:4px">终局结算 · 房间 ${code} · ${new Date().toLocaleDateString('zh-CN')}</div></div>`);
        c.insertAdjacentHTML('beforeend', '<div style="text-align:center;font:500 11px var(--sans);color:var(--ink2);margin-top:16px">7连翻助手 · flip7.leisurecat.cloud</div>');
      }
    });
    showImage(canvas.toDataURL('image/jpeg', 0.9));
  } catch (e) { toast('生成长图失败：' + e.message); }
  ui.saving = false; render();
}
function showImage(url) {
  const el = document.createElement('div');
  el.className = 'shotv';
  el.innerHTML = `<div class="sv-top"><span>长按图片保存到相册</span><a href="${url}" download="7连翻结算-${code}.jpg">下载</a><button type="button">关闭</button></div><img src="${url}" alt="结算长图">`;
  el.querySelector('button').onclick = () => el.remove();
  document.body.appendChild(el);
}

/* ---------- sheets ---------- */
function sheetView() {
  const s = ui.sheet;
  if (s.kind === 'dealer') return `<div class="mask" data-act="close"></div><div class="sheet"><div class="sh"><h3>这一轮谁发牌？</h3><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <p class="note">选错了可以在这里改，之后每轮照样轮到左手边的人。</p>
    <div class="chips">${S.players.map(p => `<button class="chip ${dealerOf(S, S.rounds.length) === p.id ? 'on' : ''}" data-act="setdealer" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`;
  if (s.kind === 'entry') return entrySheet(s);
  return '';
}

// The entry being edited, in the shape the room takes.
const draftEntry = s => s.mode === 'total'
  ? { m: 'total', t: s.t === '' || s.t === '-' ? NaN : Number(s.t), f7: s.f7, hit: s.hit }
  : { m: 'cards', n: s.n, mod: s.mod, sp: s.sp, hit: s.hit };

function entrySheet(s) {
  const V = VERSIONS[S.ver], im = IMG[S.ver], cur = s.r === S.rounds.length;
  const e = cleanEntry(S, draftEntry(s)), sc = e && entryScore(S, e);
  const count = s.n.length + s.sp.length, f7 = s.mode === 'cards' ? count === 7 : s.f7;
  const brutalF7 = S.ver === 'veng' && S.brutal && f7;
  const others = S.players.filter(p => p.id !== s.id);
  const hitPick = brutalF7 ? `<div class="hitw"><div class="grp">残酷模式：七连翻的 15 分怎么用？</div><div class="chips">
      <button class="chip ${!s.hit ? 'on' : ''}" data-act="hit" data-id="">自己 +15</button>${others.map(p => `<button class="chip ${s.hit === p.id ? 'on' : ''}" data-act="hit" data-id="${p.id}">扣 ${esc(p.name)} 15 分</button>`).join('')}</div></div>` : '';
  const head = `<div class="sh"><h3>${esc(pname(s.id))}<small>${cur ? `第 ${s.r + 1} 轮` : `改第 ${s.r + 1} 轮`}</small></h3><button class="x" data-act="close" aria-label="关闭">×</button></div>
    <div class="seg">${[['cards', '点牌算分'], ['total', '直接填总分']].map(([m, t]) => `<button class="${s.mode === m ? 'on' : ''}" data-act="mode" data-m="${m}">${t}</button>`).join('')}</div>
    <button class="bustbtn ${s.wasBust ? 'on' : ''}" data-act="bust">${s.wasBust ? '已记为爆了（本轮 0 分）' : '爆了（本轮 0 分）'}</button>`;
  let body;
  if (s.mode === 'cards') {
    const cd = (kind, key, on, id, label = '', dis = false) => `<button class="cd ${on ? 'on' : ''}" data-act="card" data-kind="${kind}" data-key="${key}" ${dis ? 'disabled' : ''} aria-label="${esc(label || key)}">${img(id)}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
    const full = count >= 7;
    body = `<div class="grp">数字牌 <small>点选他面前的牌 · 已选 ${count}/7</small></div>
      <div class="cards">${V.nums.map(n => cd('n', n, s.n.includes(n), im.n(n), '', full && !s.n.includes(n))).join('')}</div>
      ${S.ver === 'veng' ? `<div class="grp">特殊数字牌</div><div class="cards sps">${V.specials.map(k => cd('s', k, s.sp.includes(k), im.s(k), SPECIAL[k].name, full && !s.sp.includes(k))).join('')}</div>` : ''}
      <div class="grp">修正牌 <small>${S.ver === 'veng' ? '先 ÷2（向下取整）再减；不会因修正牌爆' : '先 ×2（只翻倍数字牌）再加；不会因修正牌爆'}</small></div>
      <div class="cards mods">${V.mods.map(m => cd('m', m, s.mod.includes(m), im.m(m))).join('')}</div>
      ${f7 ? `<div class="f7b">七连翻！7 张不同的数字牌，本轮立刻结束${brutalF7 && s.hit ? `，扣 ${esc(pname(s.hit))} 15 分` : '，额外 +15 分'}。</div>` : ''}
      ${hitPick}
      ${sc ? `<div class="card calc"><div class="steps">${sc.steps.map(([l, v], i) => `${i ? '<i>→</i>' : ''}${esc(l)} <b>${v}</b>`).join('')}</div>
        <div class="res">${esc(pname(s.id))}本轮<b>${sc.pts}</b></div></div>` : ''}`;
  } else {
    body = `<div class="grp" style="margin-top:14px">本轮得分 <small>${S.brutal ? '残酷模式可以填负数' : '自己算好的分数'}</small></div>
      <div class="total">${S.brutal ? '<button class="ib" data-act="neg" aria-label="正负">±</button>' : ''}<input type="text" inputmode="numeric" pattern="-?[0-9]*" data-pk="tot" data-tot value="${esc(s.t)}" placeholder="0" maxlength="4"></div>
      <label class="chk"><input type="checkbox" data-act="f7chk" ${s.f7 ? 'checked' : ''}>本轮七连翻了（只记次数${brutalF7 ? '' : '，15 分请自己算进总分'}）</label>
      ${hitPick}
      ${brutalF7 && s.hit ? `<p class="note">选了扣别人 15 分：上面只填你自己本轮的分，不含 15。</p>` : ''}`;
  }
  const can = !!e;
  return `<div class="mask" data-act="close"></div><div class="sheet" data-k="es-${s.id}-${s.r}">${head}${body}
    ${ui.err ? `<div class="err">${esc(ui.err)}</div>` : ''}
    <div class="btns">${cur && S.cur[s.id] ? '<button class="btn ghost" data-act="clear">清掉这一格</button>' : ''}<button class="btn" data-act="save" ${can ? '' : 'disabled'}>${can ? `确定 · ${sc.pts} 分` : '先填分数'}</button></div></div>`;
}

function openEntry(id, r) {
  const R = r === S.rounds.length ? S.cur : S.rounds[r]?.e;
  if (!R) return;
  const e = R[id];
  ui.err = '';
  ui.sheet = { kind: 'entry', id, r, mode: e?.m === 'total' ? 'total' : 'cards', wasBust: e?.m === 'bust',
    n: e?.m === 'cards' ? [...e.n] : [], mod: e?.m === 'cards' ? [...e.mod] : [], sp: e?.m === 'cards' ? [...(e.sp || [])] : [],
    t: e?.m === 'total' ? String(e.t) : '', f7: e?.m === 'total' ? e.f7 : false, hit: e?.hit || null };
  render();
}
function saveEntry(e) {
  const s = ui.sheet;
  if (!cleanEntry(S, e)) { ui.err = '这一手牌不成立，请核对'; render(); return; }
  send(s.r === S.rounds.length ? { t: 'entry', r: s.r, id: s.id, e } : { t: 'fix', r: s.r, id: s.id, e });
  ui.sheet = null; ui.err = ''; render();
}
function toggleCard(kind, key) {
  const s = ui.sheet;
  const list = kind === 'n' ? s.n : kind === 'm' ? s.mod : s.sp;
  const k = kind === 'n' ? Number(key) : key;
  const i = list.indexOf(k);
  if (i >= 0) list.splice(i, 1);
  else {
    if (kind !== 'm' && s.n.length + s.sp.length >= 7) { toast('最多 7 张数字牌：凑满 7 张本轮就结束了'); return; }
    // the Unlucky 7 is a 7: a plain 7 next to it would be a bust
    if (kind === 'n' && k === 7 && s.sp.includes('u7')) { s.sp.splice(s.sp.indexOf('u7'), 1); toast('厄运 7 也是 7，换成了普通 7'); }
    if (kind === 's' && k === 'u7' && s.n.includes(7)) { s.n.splice(s.n.indexOf(7), 1); toast('厄运 7 也是 7，换掉了普通 7'); }
    list.push(k);
  }
  if (s.n.length + s.sp.length < 7) s.hit = null;
  s.wasBust = false; ui.err = '';
  render();
}

/* ---------- events ---------- */
const orderUrl = n => `https://boardgame.leisurecat.cloud/?order=${n}&back=${encodeURIComponent(location.href)}`;
async function createRoom() {
  ui.busy = true; ui.err = ''; render();
  try {
    const r = await fetch('/api/room', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '创建失败');
    enterRoom(j.code);
    send({ t: 'ver', ver: ui.ver, brutal: false });
  } catch (e) { ui.err = '创建房间失败：' + (e.message === 'Failed to fetch' || e.message === 'Load failed' ? '网络连接失败，请稍后再试' : e.message); }
  ui.busy = false; render();
}
function enterRoom(c) {
  code = c; noRoom = false; S = null; ui.err = ''; ui.sheet = null;
  history.replaceState(null, '', '/?r=' + c);
  connect(); render();
}
function leave() {
  code = null; S = null; noRoom = false; ui.sheet = null; window.flip7Ver = undefined;
  if (ws) { ws.onclose = null; ws.close(); }
  history.replaceState(null, '', '/'); ui.rooms = null; render(); loadRooms();
}
async function share() {
  const url = `${location.origin}/?r=${code}`;
  const text = `7连翻助手｜点牌算分，累计到 200 不烧心\n邀请你加入${S ? verName(S.ver) : '7连翻'}房间 ${code}，点开链接就能一起记分（无需下载）：`;
  if (navigator.share) { try { await navigator.share({ title: '7连翻 · 房间 ' + code, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('邀请已复制，发给朋友即可'); } catch { toast('房间码 ' + code); }
}
function addPlayer(inputId, isMe) {
  const el = $('#' + inputId), name = el.value.trim();
  if (!name) { toast('先填名字'); el.focus(); return; }
  const id = newId();
  if (isMe) store.set('f7-me-' + code, id);
  send({ t: 'add', id, name });
  el.value = '';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
  const d = t.dataset;
  if (t.tagName === 'A') e.preventDefault();
  switch (d.act) {
    case 'pickver': ui.ver = d.v; store.set('f7-ver', d.v); render(); break;
    case 'create': createRoom(); break;
    case 'join': { const c = cleanCode($('#joinCode').value); if (c) enterRoom(c); else { ui.err = '请输入 4 位房间码'; render(); } break; }
    case 'rejoin': enterRoom(d.code); break;
    case 'leave': leave(); break;
    case 'share': share(); break;
    case 'ver': send({ t: 'ver', ver: d.v, brutal: false }); break;
    case 'brutal': send({ t: 'ver', ver: 'veng', brutal: t.checked }); break;
    case 'joinme': addPlayer('meName', true); break;
    case 'addother': addPlayer('otherName', false); break;
    case 'dealer': send({ t: 'dealer', id: d.id }); break;
    case 'move': flushAll(); send({ t: 'move', id: d.id, d: +d.d }); break;
    case 'remove': if (confirm(`移除 ${pname(d.id)}？`)) send({ t: 'remove', id: d.id }); break;
    case 'order': flushAll(); setTimeout(() => { location.href = orderUrl(S.players.length); }, 150); break;
    case 'start': flushAll(); send({ t: 'start' }); break;
    case 'dealerSheet': ui.sheet = { kind: 'dealer' }; render(); break;
    case 'setdealer': send({ t: 'dealer', id: d.id }); ui.sheet = null; render(); break;
    case 'entry': openEntry(d.id, +d.r); break;
    case 'mode': ui.sheet.mode = d.m; ui.err = ''; render(); break;
    case 'card': toggleCard(d.kind, d.key); break;
    case 'hit': ui.sheet.hit = d.id || null; render(); break;
    case 'neg': { const s = ui.sheet; s.t = s.t.startsWith('-') ? s.t.slice(1) : '-' + s.t; render(); break; }
    case 'f7chk': ui.sheet.f7 = t.checked; if (!t.checked) ui.sheet.hit = null; render(); break;
    case 'bust': saveEntry({ m: 'bust' }); break;
    case 'save': saveEntry(draftEntry(ui.sheet)); break;
    case 'clear': send({ t: 'entry', r: ui.sheet.r, id: ui.sheet.id, e: null }); ui.sheet = null; render(); break;
    case 'close': ui.sheet = null; ui.err = ''; render(); break;
    case 'end': send({ t: 'end', r: S.rounds.length }); break;
    case 'undo': {
      const n = Object.keys(S.cur).length;
      if (confirm(`撤销第 ${S.rounds.length} 轮？这一轮的分数退回到录分状态${n ? `，第 ${S.rounds.length + 1} 轮已录的 ${n} 人会被覆盖` : ''}。`)) send({ t: 'undo' });
      break;
    }
    case 'again': if (confirm('再来一局？同一批人重新从 0 分开始，这一局已存进往期对局。')) send({ t: 'again' }); break;
    case 'reset': if (confirm('重新开局？回到准备阶段，本局分数全部清空，所有人同步。')) send({ t: 'reset' }); break;
    case 'shot': if (!ui.saving) saveImage(); break;
    case 'rv-who': ui.rv.who = d.id; render(); break;
    case 'rv-star': ui.rv.stars = +d.n; render(); break;
    case 'rv-send': sendReview(); break;
    case 'rv-edit': ui.rv.state = ''; render(); break;
  }
});

document.addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  if (d.rv !== undefined) ui.rv.text = el.value;
  else if (d.ren) debounced(d.pk, () => { if (el.value.trim()) send({ t: 'rename', id: d.ren, name: el.value }); });
  else if (d.tot !== undefined) {
    const v = el.value.replace(S.brutal ? /[^0-9-]/g : /[^0-9]/g, '').replace(/(?!^)-/g, '');
    if (v !== el.value) el.value = v;
    ui.sheet.t = v; ui.err = ''; render();
  }
});
document.addEventListener('focusout', e => { const k = e.target.dataset?.pk; if (k) pending.get(k)?.flush(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const id = e.target.id;
  if (id === 'joinCode') $('[data-act="join"]').click();
  else if (id === 'meName') addPlayer('meName', true);
  else if (id === 'otherName') addPlayer('otherName', false);
  else if (e.target.dataset?.pk) e.target.blur();
});

render();
connect();
loadRooms();
