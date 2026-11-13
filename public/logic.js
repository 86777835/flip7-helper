// Rules shared by the room server (Durable Object) and the page.
// 《7连翻》: official rulebook, Ruleset Edition 3.1, and The Op's FAQ (theop.games/pages/flip-7-faqs).
// 《7连翻：冤家路窄》 (Flip 7: With a Vengeance): official rulebook, Ruleset Edition 1, and its FAQ.

export const TARGET = 200;                 // a round that ends with someone at 200+ ends the game (both versions)
export const END_COOLDOWN_MS = 2500;       // a second tap right after a round ends must not end the next (empty) round
export const MAX_PLAYERS = 24;             // 3–18 on the box; past 18 the rulebook suggests a second deck
export const BRUTAL_HIT = 15;              // 残酷模式: a Flip 7 may take 15 points from another player instead of scoring 15

// Copies of each card in one deck (rulebook card lists). Number keys are the card's value.
export const VERSIONS = {
  base: {
    name: '7连翻', full: '《7连翻》',
    nums: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    count: n => n === 0 ? 1 : n,           // twelve 12s … one 1, and one 0
    mods: ['+2', '+4', '+6', '+8', '+10', 'x2'],
    specials: []
  },
  veng: {
    name: '冤家路窄', full: '《7连翻：冤家路窄》',
    nums: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    count: n => ({ 13: 12, 7: 6 })[n] ?? n, // plus the Lucky 13 and the Unlucky 7 make thirteen 13s and seven 7s
    mods: ['-2', '-4', '-6', '-8', '-10', '/2'],
    specials: ['z', 'u7', 'l13']
  }
};
// Special Number cards of 冤家路窄: value, name. Each is one card.
export const SPECIAL = {
  z: { v: 0, name: '零号牌', en: 'The Zero' },
  u7: { v: 7, name: '厄运 7', en: 'Unlucky 7' },
  l13: { v: 13, name: '幸运 13', en: 'Lucky 13' }
};
export const MOD_TEXT = { x2: '×2', '/2': '÷2' };
export const modText = m => MOD_TEXT[m] || m.replace('-', '−');

export function initialState() {
  return { v: 0, stage: 'setup', ver: 'base', brutal: false, players: [], dealer0: null, rounds: [], cur: {}, gid: null };
}

const clone = o => JSON.parse(JSON.stringify(o));
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const isId = v => typeof v === 'string' && /^[a-z0-9]{4,10}$/.test(v);
const ids = S => S.players.map(p => p.id);

// The entry a phone sent, checked and stripped to what the version allows. Null when it can't be a real line of cards.
//   { m: 'cards', n: [numbers], mod: [...], sp: [...], hit?: id }  cards in front of the player at the end of the round
//   { m: 'total', t: points, f7: bool, hit?: id }                   the round score typed in
//   { m: 'bust' }
export function cleanEntry(S, e) {
  if (!e || typeof e !== 'object') return null;
  const V = VERSIONS[S.ver];
  const hit = S.ver === 'veng' && S.brutal && ids(S).includes(e.hit) ? { hit: e.hit } : {};
  if (e.m === 'bust') return { m: 'bust' };
  if (e.m === 'total') {
    const t = Number(e.t);
    if (!Number.isInteger(t) || t > 999 || t < (S.brutal ? -999 : 0)) return null;
    return { m: 'total', t, f7: !!e.f7, ...(e.f7 ? hit : {}) };
  }
  if (e.m !== 'cards') return null;
  const list = (a, ok) => Array.isArray(a) && a.length <= 13 && a.every(ok) && new Set(a).size === a.length;
  if (!list(e.n, x => V.nums.includes(x)) || !list(e.mod || [], x => V.mods.includes(x)) || !list(e.sp || [], x => V.specials.includes(x))) return null;
  const sp = e.sp || [];
  if (sp.includes('u7') && e.n.includes(7)) return null;   // a second 7 busts: the Unlucky 7 doesn't allow it
  if (e.n.length + sp.length > 7) return null;            // the seventh card ends the round
  const n = e.n.slice().sort((a, b) => a - b), mod = V.mods.filter(m => (e.mod || []).includes(m));
  const out = { m: 'cards', n, mod };
  if (S.ver === 'veng') out.sp = V.specials.filter(x => sp.includes(x));
  return n.length + sp.length === 7 ? { ...out, ...hit } : out;
}

// One player's own score for the round, with the steps shown under the cards.
// Returns { pts, f7, bust, steps: [[label, running total]], note }.
export function entryScore(S, e) {
  if (!e) return null;
  if (e.m === 'bust') return { pts: 0, f7: false, bust: true, steps: [] };
  const brutalHit = S.ver === 'veng' && S.brutal && !!e.hit;
  if (e.m === 'total') return { pts: e.t, f7: e.f7, bust: false, steps: [], hit: brutalHit ? e.hit : null };
  const sp = e.sp || [];
  const f7 = e.n.length + sp.length === 7;
  const steps = [];
  let x = e.n.reduce((a, b) => a + b, 0) + sp.reduce((a, k) => a + SPECIAL[k].v, 0);
  steps.push(['数字牌', x]);
  if (S.ver === 'base') {
    // Number cards, then ×2, then the + cards, then +15 (FAQ: the ×2 doubles only the number cards).
    if (e.mod.includes('x2')) steps.push(['×2', x *= 2]);
    for (const m of e.mod.filter(m => m !== 'x2')) steps.push([m, x += Number(m)]);
  } else {
    // Number cards, ÷2 rounded down, then the − cards; the round score can't go below 0 except in 残酷模式.
    if (e.mod.includes('/2')) steps.push(['÷2', x = Math.floor(x / 2)]);
    for (const m of e.mod.filter(m => m !== '/2')) steps.push([modText(m), x += Number(m)]);
    if (x < 0 && !S.brutal) steps.push(['不低于 0', x = 0]);
    // The Zero: the round scores zero unless the player Flip 7s.
    if (sp.includes('z') && !f7) return { pts: 0, f7, bust: false, steps: [...steps, ['零号牌：本轮 0 分', 0]], hit: null };
  }
  if (f7 && !brutalHit) steps.push(['七连翻 +15', x += 15]);
  return { pts: x, f7, bust: false, steps, hit: f7 && brutalHit ? e.hit : null };
}

// Everyone's score for one round: own score, less 15 for each 残酷模式 Flip 7 aimed at them.
export function roundScores(S, entries) {
  const out = {};
  for (const id of ids(S)) {
    const r = entryScore(S, entries[id]);
    out[id] = { ...(r || { pts: 0, f7: false, bust: false, steps: [], missing: true }), hitBy: [], total: r ? r.pts : 0 };
  }
  for (const [id, r] of Object.entries(out)) {
    if (r.hit && out[r.hit]) { out[r.hit].hitBy.push(id); out[r.hit].total -= BRUTAL_HIT; }
  }
  return out;
}

// Running totals after every round: [{ id: total }], one object per round.
export function runningTotals(S) {
  const t = Object.fromEntries(ids(S).map(id => [id, 0]));
  return S.rounds.map(r => {
    const sc = roundScores(S, r.e);
    for (const id of ids(S)) t[id] += sc[id].total;
    return { ...t };
  });
}
export const totals = S => runningTotals(S).at(-1) || Object.fromEntries(ids(S).map(id => [id, 0]));

// Who deals round k (0-based): the first dealer, then the next player to the left (seating order is clockwise).
export function dealerOf(S, k) {
  const n = S.players.length;
  if (!n) return null;
  const i0 = Math.max(0, ids(S).indexOf(S.dealer0));
  return S.players[(i0 + k) % n].id;
}

// End of the game: checked when a round ends. Someone at 200+ and the highest score held by one player.
// With two or more tied on top, everyone plays another round (FAQ).
export function standing(S) {
  const T = totals(S);
  const max = Math.max(...Object.values(T));
  const top = ids(S).filter(id => T[id] === max);
  const reached = S.rounds.length > 0 && max >= TARGET;
  return { T, max, top, reached, over: reached && top.length === 1, tie: reached && top.length > 1 };
}

// Things to check before ending the round: more copies of a card on the table than the deck has, or two Flip 7s.
// Only hints: a second deck (past 18 players) or a mistyped card are for the table to sort out.
export function roundWarnings(S, entries) {
  const V = VERSIONS[S.ver], used = {}, add = (k, id) => (used[k] ||= []).push(id);
  const sevens = [];
  for (const id of ids(S)) {
    const e = entries[id];
    if (!e || e.m === 'bust') continue;
    if (e.m === 'total') { if (e.f7) sevens.push(id); continue; }
    e.n.forEach(v => add('n' + v, id)); e.mod.forEach(m => add('m' + m, id)); (e.sp || []).forEach(x => add('s' + x, id));
    if (e.n.length + (e.sp || []).length === 7) sevens.push(id);
  }
  const decks = S.players.length > 18 ? 2 : 1;
  const out = [];
  for (const [k, who] of Object.entries(used)) {
    const have = k[0] === 'n' ? V.count(+k.slice(1)) : 1;
    if (who.length <= have * decks) continue;
    const label = k[0] === 'n' ? `数字 ${k.slice(1)}` : k[0] === 'm' ? `${modText(k.slice(1))} 修正牌` : SPECIAL[k.slice(1)].name;
    out.push({ k, who, text: `${label}：整副牌只有 ${have} 张，却录了 ${who.length} 张` });
  }
  if (sevens.length > 1) out.push({ k: 'f7', who: sevens, text: `${sevens.length} 人都录了七连翻：有人凑满 7 张时本轮立刻结束，一轮只会有一个` });
  return out;
}

// Applies one action. Returns the new state, or null when the action is invalid or stale.
export function reduce(s, a) {
  if (!a || typeof a !== 'object') return null;
  const S = clone(s);
  const done = () => { S.v = s.v + 1; return S; };
  const P = id => S.players.find(p => p.id === id);
  const setup = S.stage === 'setup';

  switch (a.t) {
    case 'ver':
      if (!setup || !VERSIONS[a.ver]) return null;
      S.ver = a.ver; S.brutal = a.ver === 'veng' && !!a.brutal;
      return done();

    case 'add': {   // the phone picks the id, so a resent add can't make a second player
      const name = cleanText(a.name, 12);
      if (!isId(a.id) || !name || P(a.id) || S.players.length >= MAX_PLAYERS || S.stage === 'over') return null;
      if (!setup && S.rounds.length) return null;   // players join before the first round ends
      S.players.push({ id: a.id, name });
      S.dealer0 ||= a.id;
      return done();
    }

    case 'rename': {
      const p = P(a.id), name = cleanText(a.name, 12);
      if (!p || !name) return null;
      p.name = name; return done();
    }

    case 'remove': {
      const i = ids(S).indexOf(a.id);
      if (i < 0 || !setup) return null;
      S.players.splice(i, 1);
      if (S.dealer0 === a.id) S.dealer0 = S.players[i % Math.max(1, S.players.length)]?.id ?? null;
      return done();
    }

    case 'move': {   // seats are clockwise; d = −1 moves up the list, +1 down
      const i = ids(S).indexOf(a.id), j = i + a.d;
      if (!setup || i < 0 || ![-1, 1].includes(a.d) || j < 0 || j >= S.players.length) return null;
      [S.players[i], S.players[j]] = [S.players[j], S.players[i]];
      return done();
    }

    case 'dealer': {   // who deals now: before the start the first dealer, later this round's dealer
      if (!P(a.id) || S.stage === 'over') return null;
      const n = S.players.length, k = setup ? 0 : S.rounds.length;
      S.dealer0 = S.players[((ids(S).indexOf(a.id) - k) % n + n) % n].id;
      return done();
    }

    case 'start':
      if (!setup || !S.players.length) return null;
      Object.assign(S, { stage: 'play', rounds: [], cur: {}, endedAt: 0,
        gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });   // names this game in the archive
      S.dealer0 ||= S.players[0].id;
      return done();

    case 'entry': {   // r: the round the phone was looking at, so a late entry can't land in the next round
      if (S.stage !== 'play' || a.r !== S.rounds.length || !P(a.id)) return null;
      if (a.e === null) { delete S.cur[a.id]; return done(); }
      const e = cleanEntry(S, a.e);
      if (!e || (e.hit && e.hit === a.id)) return null;
      S.cur[a.id] = e;
      return done();
    }

    case 'end': {
      if (S.stage !== 'play' || a.r !== S.rounds.length || !S.players.every(p => S.cur[p.id])) return null;
      if (s.endedAt && Date.now() - s.endedAt < END_COOLDOWN_MS) return null;
      S.rounds.push({ dealer: dealerOf(S, S.rounds.length), e: S.cur });
      S.cur = {}; S.endedAt = Date.now();
      if (standing(S).over) S.stage = 'over';
      return done();
    }

    case 'fix': {   // change an entry of a round already played; the game may end or carry on again
      const R = S.rounds[a.r];
      if (!R || !P(a.id) || S.stage === 'setup') return null;
      const e = cleanEntry(S, a.e);
      if (!e || (e.hit && e.hit === a.id)) return null;
      R.e[a.id] = e;
      S.stage = standing(S).over ? 'over' : 'play';
      return done();
    }

    case 'undo': {   // the last round goes back to being entered, as it was
      if (S.stage === 'setup' || !S.rounds.length) return null;
      S.cur = S.rounds.pop().e;
      S.stage = 'play'; S.endedAt = 0;
      return done();
    }

    case 'again':    // same players, new game; the next player to the left deals first
      if (S.stage !== 'over') return null;
      S.dealer0 = dealerOf(S, S.rounds.length);
      Object.assign(S, { stage: 'play', rounds: [], cur: {}, endedAt: 0,
        gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
      return done();

    case 'reset':
      Object.assign(S, { stage: 'setup', rounds: [], cur: {}, gid: null, endedAt: 0 });
      return done();
  }
  return null;
}

// Final standings, per-player numbers and achievements.
export function results(S) {
  const run = runningTotals(S), T = totals(S);
  const rows = S.players.map(p => {
    const sc = S.rounds.map(r => roundScores(S, r.e)[p.id]);
    return {
      id: p.id, name: p.name, total: T[p.id],
      f7: sc.filter(x => x.f7).length, bust: sc.filter(x => x.bust).length,
      best: sc.length ? Math.max(...sc.map(x => x.total)) : 0,
      hits: sc.filter(x => x.hit).length,                     // 残酷模式: Flip 7s used to take 15 from someone
      worst: 1                                                 // lowest place held at the end of any round (filled below)
    };
  });
  const placeIn = (t, id) => 1 + Object.values(t).filter(v => v > t[id]).length;
  for (const r of rows) r.worst = Math.max(1, ...run.map(t => placeIn(t, r.id)));
  const sorted = rows.slice().sort((a, b) => b.total - a.total);
  sorted.forEach(r => { r.place = placeIn(T, r.id); r.rise = r.worst - r.place; });

  const best = (val, min = 0) => {
    const vs = rows.map(val), max = Math.max(...vs);
    if (!(max > min) || (rows.length > 1 && vs.every(v => v === max))) return [];
    return rows.filter((r, i) => vs[i] === max).map(r => r.id);
  };
  const ach = [
    { k: 'win', ch: '冠', name: '冠军', desc: `一轮结束时率先过 ${TARGET} 分且分数最高`, who: sorted.filter(r => r.place === 1).map(r => r.id) },
    { k: 'f7', ch: '七', name: '七连翻达人', desc: '七连翻次数最多', who: best(r => r.f7) },
    { k: 'best', ch: '高', name: '单轮最高', desc: '一轮拿到的分数最高', who: best(r => r.best) },
    { k: 'bust', ch: '爆', name: '爆牌王', desc: '爆牌次数最多', who: best(r => r.bust) },
    { k: 'safe', ch: '稳', name: '稳如老狗', desc: '爆牌次数最少', who: S.rounds.length > 1 ? best(r => -r.bust, -Infinity) : [] },
    { k: 'rise', ch: '逆', name: '后来居上', desc: '名次比最落后时提升最多', who: best(r => r.rise) },
    { k: 'hit', ch: '狠', name: '冤家路窄', desc: '七连翻后扣别人 15 分的次数最多', who: best(r => r.hits) }
  ].filter(a => a.who.length);
  return { rows: sorted, ach, rounds: S.rounds.length };
}

// What the archive keeps for a finished game.
export function gameRecord(S) {
  const R = results(S);
  return { gid: S.gid, ver: S.ver, brutal: S.brutal, rounds: R.rounds,
    players: R.rows.map(r => ({ name: r.name, place: r.place, total: r.total, f7: r.f7, bust: r.bust, best: r.best })) };
}
