const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = t => new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function game(g) {
  const ps = g.players;
  return `<details class="card game">
    <summary><div class="gh"><b>${esc(g.code)}</b><span>${when(g.ended)} · ${ps.length} 人 · ${g.rounds} 轮</span><em>${g.ver === 'veng' ? '冤家路窄' + (g.brutal ? '·残酷' : '') : '原版'}</em></div>
      <div class="gp">${ps.map(p => `<span class="${p.place === 1 ? 'win' : ''}">${esc(p.name)}<em>${p.total}</em></span>`).join('')}</div></summary>
    <div class="gd">${ps.map(p => `<div><b>${p.place}</b><span>${esc(p.name)}<br><i>七连翻 ${p.f7} · 爆牌 ${p.bust} · 单轮最高 ${p.best}</i></span><em>${p.total}</em></div>`).join('')}</div>
  </details>`;
}

async function load(q) {
  const box = document.getElementById('games');
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await fetch('/api/games' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    box.innerHTML = list.length ? list.map(game).join('') : `<div class="empty">${q ? '没有找到相关对局' : '暂无记录'}</div>`;
  } catch {
    box.innerHTML = '<div class="empty">加载失败，请稍后重试</div>';
  }
}

document.getElementById('search').addEventListener('submit', e => { e.preventDefault(); load(document.getElementById('q').value.trim()); });
load('');
