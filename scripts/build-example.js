#!/usr/bin/env node
/*
  Writes docs/examples/tableview-builder-file.md from public/examples.js.

    node scripts/build-example.js           # write the file
    node scripts/build-example.js --check   # exit 1 if the file on disk is stale

  The output is a real Builder file: the same layout exportBuilderFile in
  public/app.js writes, so ⚙ Settings → Upload Builder file loads it into an
  account as a finished run through the MVP worksheet. Everything after the
  importable body sits under a top-level heading that matches no worksheet,
  which parseBuilderFile skips, so the appendix can't leak into an answer.

  Output is deterministic (no timestamps from the clock), which is what lets
  the test suite and --check compare it byte for byte.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const WORKSHEETS = require('../content.js');
const CURRICULUM = require('../curriculum.js');
const EXAMPLES = require('../public/examples.js');

const OUT = path.join(__dirname, '..', 'docs', 'examples', 'tableview-builder-file.md');

// The example's pitch deck, published separately (see the README's worked-example note).
const DECK_URL = 'https://claude.ai/artifact/V7B8rLkXrCFwyrZ5QWhJ5y';

// Sections the example covers. §5 Go-live is about the student's own accounts,
// so a worked answer would be someone else's GitHub link — it's left out.
const SECTIONS = ['problem-statement', 'user-needs', 'product-features', 'mvp-plan', 'pitch'];

const fmtClock = sec => Math.floor(sec / 60) + ':' + String(Math.round(sec) % 60).padStart(2, '0');

function build() {
  const ws = WORKSHEETS.find(w => w.id === 'mvp');
  const body = [];
  let xp = 0;

  for (const section of ws.sections) {
    if (!SECTIONS.includes(section.id)) continue;
    body.push(`## ${section.num}. ${section.title}`);
    const art = section.steps.find(s => s.isArtifact);
    if (art) {
      const ex = EXAMPLES.steps[section.id + '/' + art.id];
      const text = EXAMPLES.answerText(art, ex.answer);
      body.push('', `> **${section.artifactLabel}**`, '>', ...text.split('\n').map(l => '> ' + l), '');
      xp += CURRICULUM.bonusOfSection(section.id);
    }
    for (const step of section.steps) {
      const key = section.id + '/' + step.id;
      xp += CURRICULUM.xpOfStep(key);
      body.push(`### ${step.title}`, '');
      if (step.type === 'video') {
        body.push(`_Watched segment ${fmtClock(step.video.start)}–${fmtClock(step.video.end)} of youtube.com/watch?v=${step.video.youtubeId}_`, '');
        continue;
      }
      const ex = EXAMPLES.steps[key];
      if (!ex) throw new Error(`No example for ${key} — every non-video step in a covered section needs one`);
      body.push(`**Task:** ${step.prompt}`, '', EXAMPLES.answerText(step, ex.answer), '');
      if (ex.attempts) body.push(`_Accepted by Builders AI after ${ex.attempts} attempt${ex.attempts === 1 ? '' : 's'}._`, '');
    }
    body.push('');
  }

  const lines = [
    '# Builders Club — Builder File',
    '',
    `_Exported (worked example) · ${xp} XP · 9-day streak_`,
    '',
    `**Worked example: ${EXAMPLES.title} — ${EXAMPLES.tagline}.** Written as ${EXAMPLES.builder}.`,
    'Every answer below was written against the real prompt and rubric for its step. The interviews are SIMULATED for this example and labeled as such. Your project needs real conversations.',
    '',
    'Read it here, open any single step\'s answer with the 💡 Example button inside the worksheets, or load the whole thing into a test account with ⚙ Settings → Upload Builder file. §5 Ship It is left out because it\'s about your own accounts.',
    '',
    `# ${ws.title}`,
    '',
    ...body,
    ...appendix(ws),
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function appendix(ws) {
  const out = [
    '# Appendix — notes on the example (not part of the Builder file)',
    '',
    '## The people in the research (simulated)',
    '',
    '- **Priya**: lead tutor at a learning center, runs 7 kids in grades 5–7 three evenings a week.',
    '- **Marcus**: a volunteer who runs an after-school math club of 8 at a middle school.',
    '- **Ms. Alvarez**: a 7th-grade math teacher with 31 students seated in pods of 4. She is the "does this scale?" voice.',
    '- **Jordan**, 12: the quiet kid in Sam\'s Tuesday group, seen in the pitch scene.',
    '',
    '## Choosing the hardware',
    '',
    'This fed the feasibility reasons on the §3 Must cards. The constraints were no professional installation, nothing per student to charge, and almost no desk space.',
    '',
    '| Option | Good | Bad |',
    '|---|---|---|',
    '| Ceiling cameras, drilled in | Nothing on desks | Purchase plus install cost, facilities sign-off, and they film faces |',
    '| A document camera on every desk | The sharpest image | 8–30 devices to wire or charge, cable clutter, ~$70–100 each |',
    '| Student phone or Chromebook camera | Already owned | Takes desk space, fiddly angles, phone bans, devices vary |',
    '| Smart pens (dot-paper digitizers) | Perfect strokes and replay, no camera | Special paper, charging, $100+ a pen, pens get lost |',
    '| **One 4K webcam on a boom stand over the table** | One device, USB to the tutor\'s laptop, ~$150, set up in 5 minutes | Reads about 6–8 papers at most; hands and heads block the view |',
    '| One clamp or boom camera per desk pod (to scale to 30) | ~$150 a pod, no drilling, wall or USB power | Needs a small hub or PC per room |',
    '',
    'The MVP uses the boom camera. The class-of-30 version is pod mode (a Should). Smart pens are a Could.',
    '',
    '## Why each answer works',
    '',
  ];
  for (const section of ws.sections) {
    if (!SECTIONS.includes(section.id)) continue;
    for (const step of section.steps) {
      const ex = EXAMPLES.steps[section.id + '/' + step.id];
      if (ex && ex.why) out.push(`- **${section.num}. ${step.title}**: ${ex.why}`);
    }
  }
  out.push('', '## The pitch deck', '');
  out.push(DECK_URL
    ? `The deck built from the pitch outline (the five pitch slides, a cover, and a class-of-30 slide), with the I SAY lines as speaker notes: ${DECK_URL}. The link is private until a mentor shares it from the deck’s Share menu.`
    : 'The five-slide deck follows the pitch outline in §6 above, one slide per ON SCREEN / I SAY pair.');
  out.push('');
  return out;
}

if (require.main === module) {
  const text = build();
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (onDisk !== text) {
      console.error('docs/examples/tableview-builder-file.md is stale. Run: node scripts/build-example.js');
      process.exit(1);
    }
    console.log('Example Builder file is up to date.');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log('Wrote ' + path.relative(process.cwd(), OUT));
  }
}

module.exports = { build, OUT, SECTIONS };
