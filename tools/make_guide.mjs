// Builds what the rules assistant reads from the teach page's data, so the two never disagree:
//   tools/讲解稿.md  the read-aloud script of both versions, plus every card note
//   tools/faq.json   注意事项 (with the questions the teach page asks) + tools/faq_extra.json
// Run after editing public/teach-data.js or tools/faq_extra.json:  node tools/make_guide.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { TERMS, PARTS, NOTES } from '../public/teach-data.js';

const plain = s => s.replace(/\{([^|}]+)\|\w+\}/g, '$1').replace(/\*\*/g, '');
const NAME = { base: '《7连翻》（原版，Flip 7）', veng: '《7连翻：冤家路窄》（Flip 7: With a Vengeance）' };
let md = '';
for (const v of ['base', 'veng']) {
  md += `# ${NAME[v]} 讲解稿\n\n`;
  for (const p of PARTS[v]) md += `## ${p.title}\n\n${p.lines.map(plain).join('\n')}\n\n`;
  md += `## 牌和术语\n\n${Object.values(TERMS[v]).map(t => `- ${t.name}：${t.where}${t.what}`).join('\n')}\n\n`;
}
writeFileSync(new URL('./讲解稿.md', import.meta.url), md);

const VER = { base: '原版', veng: '冤家路窄' };
const faq = [
  ...['base', 'veng'].flatMap(v => NOTES[v].map(([t, a, q]) => ({ cat: `${VER[v]}·${t}`, q, a: plain(a), src: '规则书 / 官方 FAQ（出处见答案）' }))),
  ...JSON.parse(readFileSync(new URL('./faq_extra.json', import.meta.url)))
];
writeFileSync(new URL('./faq.json', import.meta.url), JSON.stringify(faq, null, 0).replace(/\},\{/g, '},\n{'));
console.log(`讲解稿 ${md.length} 字，常见问题 ${faq.length} 条`);
