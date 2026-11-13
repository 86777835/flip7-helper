// Scoring and room rules, checked against the rulebook examples. Run: node tests/test_logic.mjs
import assert from 'node:assert/strict';
import { initialState, reduce, entryScore, roundScores, roundWarnings, standing, results, cleanEntry } from '../public/logic.js';

const base = { ...initialState(), ver: 'base' };
const veng = { ...initialState(), ver: 'veng' };
const brutal = { ...veng, brutal: true };
const pts = (S, e) => entryScore(S, cleanEntry(S, e)).pts;

// 《7连翻》 rulebook p.10–11: 3+11+5+7+10 = 36, ×2 = 72, +10 = 46; Flip 7 with 9 and 4 = 64
assert.equal(pts(base, { m: 'cards', n: [3, 5, 7, 10, 11], mod: [] }), 36);
assert.equal(pts(base, { m: 'cards', n: [3, 5, 7, 10, 11], mod: ['x2'] }), 72);
assert.equal(pts(base, { m: 'cards', n: [3, 5, 7, 10, 11], mod: ['+10'] }), 46);
assert.equal(pts(base, { m: 'cards', n: [3, 4, 5, 7, 9, 10, 11], mod: [] }), 64);
// p.5: 11+5+12 = 28, with +4 = 32
assert.equal(pts(base, { m: 'cards', n: [5, 11, 12], mod: ['+4'] }), 32);
// FAQ: ×2 doubles only the number cards, not the + cards or the 15
assert.equal(pts(base, { m: 'cards', n: [0, 1, 2, 3, 4, 5, 6], mod: ['x2', '+10'] }), 21 * 2 + 10 + 15);
// p.8: modifier cards alone still score, except a ×2
assert.equal(pts(base, { m: 'cards', n: [], mod: ['+6', 'x2'] }), 6);
assert.equal(pts(base, { m: 'bust' }), 0);
// at most 7 number cards; no duplicates
assert.equal(cleanEntry(base, { m: 'cards', n: [0, 1, 2, 3, 4, 5, 6, 7], mod: [] }), null);
assert.equal(cleanEntry(base, { m: 'cards', n: [3, 3], mod: [] }), null);
assert.equal(cleanEntry(base, { m: 'cards', n: [13], mod: [] }), null);

// 冤家路窄 rulebook p.6 example: 48 → ÷2 = 24 → −4 = 20 → Flip 7 = 35
assert.equal(pts(veng, { m: 'cards', n: [3, 4, 5, 7, 8, 10, 11], mod: ['/2', '-4'] }), 35);
assert.equal(pts(veng, { m: 'cards', n: [3], mod: ['/2'] }), 1);                 // rounds down
assert.equal(pts(veng, { m: 'cards', n: [3], mod: ['-10'] }), 0);                // not below zero
assert.equal(pts(brutal, { m: 'cards', n: [3], mod: ['-10'] }), -7);             // 残酷模式 can go below zero
assert.equal(pts(veng, { m: 'cards', n: [5, 9], sp: ['z'], mod: [] }), 0);       // The Zero
assert.equal(pts(veng, { m: 'cards', n: [1, 2, 3, 4, 5, 6], sp: ['z'], mod: [] }), 21 + 15);
assert.equal(pts(veng, { m: 'cards', n: [12, 13], sp: ['l13'], mod: [] }), 38);  // Lucky 13 + 13 both score
assert.equal(cleanEntry(veng, { m: 'cards', n: [7], sp: ['u7'], mod: [] }), null);
assert.equal(cleanEntry(veng, { m: 'cards', n: [0], mod: [] }), null);           // no plain 0 in 冤家路窄
assert.equal(cleanEntry(base, { m: 'total', t: -3 }), null);
assert.equal(cleanEntry(brutal, { m: 'total', t: -3 }).t, -3);

// room flow
let S = initialState();
const go = a => { const n = reduce(S, a); assert.ok(n, JSON.stringify(a)); S = n; };
const no = a => assert.equal(reduce(S, a), null, JSON.stringify(a));
go({ t: 'add', id: 'aaaa', name: '小明' }); go({ t: 'add', id: 'bbbb', name: '小红' }); go({ t: 'add', id: 'cccc', name: '老王' });
no({ t: 'add', id: 'aaaa', name: '重复' });
go({ t: 'dealer', id: 'bbbb' }); go({ t: 'start' });
assert.equal(S.dealer0, 'bbbb');
no({ t: 'end', r: 0 });
go({ t: 'entry', r: 0, id: 'aaaa', e: { m: 'total', t: 120 } });
go({ t: 'entry', r: 0, id: 'bbbb', e: { m: 'bust' } });
no({ t: 'entry', r: 1, id: 'cccc', e: { m: 'bust' } });
go({ t: 'entry', r: 0, id: 'cccc', e: { m: 'cards', n: [12, 11], mod: ['x2'] } });
go({ t: 'end', r: 0 });
assert.equal(S.rounds.length, 1); assert.equal(S.stage, 'play');
S.endedAt = 0;
for (const [id, t] of [['aaaa', 90], ['bbbb', 10], ['cccc', 156]]) go({ t: 'entry', r: 1, id, e: { m: 'total', t } });
go({ t: 'end', r: 1 });
// 210 vs 202: the game ends
assert.equal(S.stage, 'over'); assert.deepEqual(standing(S).top, ['aaaa']);
// fixing round 2 to a tie at 210 puts the game back in play: everyone plays another round
go({ t: 'fix', r: 1, id: 'cccc', e: { m: 'total', t: 164 } });
assert.equal(S.stage, 'play'); assert.ok(standing(S).tie);
go({ t: 'undo' }); assert.equal(S.rounds.length, 1); assert.equal(S.cur.cccc.t, 164);

// warnings: one ×2 in the deck
const w = roundWarnings({ ...base, players: [{ id: 'a' }, { id: 'b' }] }, { a: { m: 'cards', n: [1], mod: ['x2'] }, b: { m: 'cards', n: [1, 2], mod: ['x2'] } });
assert.deepEqual(w.map(x => x.k).sort(), ['mx2', 'n1']);

// 残酷模式: a Flip 7 taking 15 from another player
const B = { ...brutal, players: [{ id: 'a' }, { id: 'b' }] };
const e7 = cleanEntry(B, { m: 'cards', n: [1, 2, 3, 4, 5, 6, 8], mod: [], hit: 'b' });
const rs = roundScores(B, { a: e7, b: { m: 'cards', n: [10], mod: [] } });
assert.equal(rs.a.total, 29); assert.equal(rs.b.total, -5);

console.log('logic ok', results(S).rows.map(r => `${r.name} ${r.total}`).join(' / '));
