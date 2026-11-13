// N-minute teach: a script the teacher reads aloud to start a first game, then 注意事项 (easy-to-miss rules with the answers
// written in), then the cards on the table. Two versions: 《7连翻》 and 《7连翻：冤家路窄》, picked with ?v= or the switch,
// remembered on this phone. Terms in {text|id} open a note with the card cut from the official rulebook (img/c/); the
// 「问」 buttons ask the rules assistant (chat.js) straight away, with the version in front of the question.
import { TERMS, PARTS, NOTES, DECK, MINUTES } from './teach-data.js';

const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const qv = new URLSearchParams(location.search).get('v');
let ver = qv === 'veng' || qv === 'base' ? qv : store.get('f7-ver') === 'veng' ? 'veng' : 'base';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = (id, cls = '') => id ? `<img class="ico ${cls}" src="img/c/${id}.webp" alt="">` : '';
const term = (text, id) => `<button type="button" class="term" data-t="${id}">${ICON(TERMS[ver][id].img)}${esc(text)}</button>`;
const line = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\{([^|}]+)\|(\w+)\}/g, (_, t, id) => term(t, id));
// inside a button the terms show their picture but are not buttons themselves
const label = s => esc(s).replace(/\{([^|}]+)\|(\w+)\}/g, (_, t, id) => `<span class="tlab">${ICON(TERMS[ver][id].img)}${esc(t)}</span>`);
const askBtn = (text, q) => `<button type="button" class="tq" data-q="${esc(q)}">问 <span>${label(text)}</span></button>`;
const NAME = { base: '《7连翻》', veng: '《冤家路窄》' };

function render() {
  window.flip7Ver = ver;
  const parts = PARTS[ver], notes = NOTES[ver];
  document.getElementById('ttl').textContent = `${MINUTES[ver]} 分钟讲规则`;
  document.title = `${MINUTES[ver]} 分钟讲规则 · ${ver === 'veng' ? '7连翻：冤家路窄' : '7连翻'}`;
  document.getElementById('teach').innerHTML = `
  <div class="seg tver">${['base', 'veng'].map(v => `<button class="${v === ver ? 'on' : ''}" data-v="${v}">${NAME[v]}<small>${v === 'base' ? '原版' : 'With a Vengeance'}</small></button>`).join('')}</div>
  <p class="tlead">讲的人先照着念主流程（${MINUTES[ver]} 分钟左右），再一条条过注意事项。<b>带下划线的词</b>点一下看卡牌图和解释；有疑问点「问」，规则助手马上回答。</p>
  <nav class="tnav">${parts.map((p, i) => `<a href="#p${i + 1}"><i>${i + 1}</i>${p.title}</a>`).join('')}<a href="#later">注意事项</a><a href="#deck">卡牌速查</a></nav>
  ${parts.map((p, i) => `<section class="card tpart" id="p${i + 1}">
    <h2 class="h"><span><i>${i + 1}</i>${p.title}</span><small>约 ${p.sec} 秒</small></h2>
    ${p.lines.map(s => `<p class="tline">${line(s)}</p>`).join('')}
    <div class="tasks"><em>桌上常见疑问</em>${p.ask.map(q => askBtn(q, q)).join('')}</div>
  </section>`).join('')}
  <section class="card tpart" id="later">
    <h2 class="h"><span><i>✓</i>注意事项</span><small>${notes.length} 条</small></h2>
    <p class="tnote">流程讲完后，一条一条过一遍。都是规则书、官方 FAQ 里写了，但最容易漏掉或吵起来的地方。点开就是答案。</p>
    <div class="tnotes">${notes.map(([t, a, q], i) => `<details class="tni"><summary><i>${i + 1}</i>${esc(t)}</summary><p>${line(a)}</p>${askBtn('还有疑问？问规则助手', q)}</details>`).join('')}</div>
    <p class="tnote">注意事项里没有的，点右下角「规则」问 AI，本站资料查不到会联网找。</p>
  </section>
  <a class="btn tgo" href="/?v=${ver}">讲完了，去建房间记分</a>
  <h2 class="h" id="deck">卡牌速查<small>点卡牌看解释</small></h2>
  ${DECK[ver].map(([g, items]) => `<div class="card tgrid"><h3>${g}</h3><div>${items.map(([im, cap, t]) => `<button type="button" class="tic" ${t ? `data-t="${t}"` : ''}>${ICON(im)}<span>${esc(cap)}</span></button>`).join('')}</div></div>`).join('')}
  <footer>依据 The Op 官方规则书（${ver === 'veng' ? '《Flip 7: With a Vengeance》Ruleset Edition 1' : '《Flip 7》Ruleset Edition 3.1'}）和官方 FAQ（<a href="https://theop.games/pages/${ver === 'veng' ? 'flip-7-wav-faqs' : 'flip-7-faqs'}" target="_blank" rel="noopener">原文</a>）<br>卡牌图片截自官方规则书（<a href="${ver === 'veng' ? 'https://cdn.shopify.com/s/files/1/0611/3958/3198/files/26_FLIP_7_VENGEANCE_RULES_C.pdf' : 'https://cdn.shopify.com/s/files/1/0611/3958/3198/files/25_FLIP_7_TB_RULES_C_Rev_9_2_25_ND.pdf'}" target="_blank" rel="noopener">原文</a>），版权归 USAopoly（The Op）所有${ver === 'veng' ? '<br>冤家路窄的牌名是中文玩家的常用叫法，中文版实物用词可能不同' : ''} · 非官方玩家工具</footer>`;
}

// The note for a term: a sheet from the bottom with the card, where it is and what it means.
const sheet = document.createElement('div');
sheet.className = 'tsheet hidden';
document.body.appendChild(sheet);
const close = () => sheet.classList.add('hidden');
function show(id) {
  const t = TERMS[ver][id];
  sheet.innerHTML = `<div class="tsbg"></div><div class="tsbox" role="dialog" aria-label="${esc(t.name)}">
    <div class="tshd">${ICON(t.img, 'big')}<b>${esc(t.name)}</b><button type="button" class="tsx" aria-label="关闭">×</button></div>
    <p><em>在哪儿看到</em>${esc(t.where)}</p><p><em>什么意思</em>${esc(t.what)}</p>
    <button type="button" class="btn navy tsask" data-q="${esc(`「${t.name}」是什么，怎么用？`)}">还不懂？问规则助手</button></div>`;
  sheet.classList.remove('hidden');
}
const ask = q => { close(); window.askRules?.(q); };
document.addEventListener('click', e => {
  const v = e.target.closest('.tver [data-v]');
  if (v) { ver = v.dataset.v; store.set('f7-ver', ver); history.replaceState(null, '', `?v=${ver}${location.hash}`); render(); return; }
  const t = e.target.closest('[data-t]');
  if (t) return show(t.dataset.t);
  const q = e.target.closest('[data-q]');
  if (q) return ask(q.dataset.q);
  if (e.target.closest('.tsx,.tsbg')) close();
});
addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
render();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
