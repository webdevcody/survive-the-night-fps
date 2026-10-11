// The design doc (issue #292): docs/design.md says who the game is for and its pillars, AGENTS.md and CLAUDE.md link
// to it, and the create-pr skill asks every PR for its pillar line.
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const doc = read('docs/design.md');
for (const h of ["## Who it's for", '## Pillars', '## Not this game', '## Experiments']) {
  check(doc.includes(h), `design doc has "${h}"`);
}
const pillars = (doc.split('## Pillars')[1] || '').split('\n## ')[0].match(/^\d+\. \*\*/gm) || [];
check(pillars.length >= 3 && pillars.length <= 4, `design doc names 3-4 pillars (${pillars.length})`);

for (const f of ['AGENTS.md', 'CLAUDE.md']) check(read(f).includes('(docs/design.md)'), `${f} links docs/design.md`);

const skill = read('.claude/skills/create-pr/SKILL.md');
check(/\*\*Pillar:\*\*/.test(skill.split('## 4. Write the body')[1] || ''), 'create-pr body template has a Pillar line');
check(skill.includes('none, tooling/infra'), 'create-pr allows "none, tooling/infra"');
check(skill.includes('docs/design.md'), 'create-pr links the design doc');

console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
