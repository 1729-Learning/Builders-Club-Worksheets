/*
  One fully worked example project, answered step by step against the real
  prompts and rubrics in content.js. Students open it inline from any step with
  the 💡 Example button; scripts/build-example.js turns the same data into an
  importable Builder file at docs/examples/tableview-builder-file.md.

  The project is deliberately NOT a student's likely idea, so an example reads
  as a model of the thinking, not an answer to copy.

  Each entry is keyed "sectionId/stepId" (the same key progress uses) and holds:
    answer    the answer in the step's own shape:
                string            text / journal / synthesis steps
                string[]          listAnswer steps — one box per item, one line each
                { fieldId: text } fields steps
                { colId: [cards] } board steps
    why       one or two sentences on what makes it work (shown in the panel)
    attempts  how many submissions the AI review took (exercise/synthesis only)

  The interviews are SIMULATED for this example, and the answers say so. A real
  project needs real conversations; the example only shows what to do with them.

  Pure data plus one pure serializer. Runs in the browser and in Node, like content.js.
*/
'use strict';

var EXAMPLES = (function () {
  const steps = {

    /* ------------------------------------------------ §1 Real Problem Statement */

    'problem-statement/journal-problems': {
      answer: [
        'During Tuesday group, Jordan sat stuck on question 3 for ten minutes and I didn’t notice until I reached his seat.',
        'Two kids finished early and started an eraser-flicking game while I was helping someone else.',
        'The loudest kid at the table gets most of my help because he calls out first.',
        'Worksheets go home in backpacks and never come back, so I can’t see how a kid’s work changed over a month.',
        'I spend 15–20 minutes after group photographing papers on my phone, and then I never look at the photos.',
        'Parents ask “how’s she doing?” at pickup and I have nothing concrete to show them.',
        'My group spans grade 5 to grade 7, so one lesson plan never fits everyone.',
        'Kids forget their login for the online practice site every single week.',
        'The center’s printer jams five minutes before group, every time I need copies.',
        'My bus to the learning center is late about twice a week.',
      ],
      why: 'Ten small, boring, real problems from one week. Most come from watching other people, and nobody is solving anything yet.',
    },

    'problem-statement/pick-top-5': {
      answer: [
        'Not seeing stuck kids — every session, a kid loses ~10 minutes of learning, and it’s the quiet kid who needs it most.',
        'Paper work disappears — I can’t show progress over a month, and I waste 15–20 minutes a week on photos I never use.',
        'Parents have nothing concrete at pickup — they’re paying for tutoring and can’t see what it’s doing.',
      ],
      why: 'Each pick says how often it happens, what it costs and who feels it. The bus and the printer are annoying but they don’t make the cut.',
    },

    'problem-statement/transform-2': {
      answer: [
        'Small-group math tutors running 6–8 kids at one table struggle to see every kid’s paper during independent practice because they can only look at one page at a time, which costs them 5–10 minutes a session where stuck kids sit silently and finished kids drift off-task.',
        'Tutors who want to track a student’s progress across weeks struggle to keep a record of handwritten work because paper worksheets go home and rarely come back, which costs them 15–20 minutes after every session photographing pages and still leaves gaps.',
        'Parents of kids in after-school tutoring struggle to know what their child actually worked on because the only evidence is a crumpled worksheet in a backpack, which costs them a useful conversation at pickup and makes them doubt whether tutoring is worth paying for.',
      ],
      why: 'Each one names a narrow group, a root cause and a cost you could check by asking. None of them mentions a camera or an app. #1 is strongest because its cost is measured in minutes.',
      attempts: 2,
    },

    'problem-statement/problem-hypothesis': {
      answer: 'I believe the tutors who feel this most are the ones running 6–8 kids of MIXED grade levels at a single table during independent practice — the wider the spread, the more kids are stuck on different things at once.\n\nHow often (a guess): every session, several times. At least one kid waits 5+ minutes before the tutor sees their work, and one or two finish early and go idle.\n\nToday they deal with it by walking laps around the table and glancing at each paper, by saying “raise your hand if you’re stuck”, or by moving practice onto iPads with something like Desmos or Classkick so they can watch screens.\n\nWhy that isn’t good enough: a lap reaches each kid maybe every 4–6 minutes and the loud kids pull the tutor over first; quiet kids don’t raise hands; and on screens kids write math worse and drift to other things. The kid who most needs help is still the last one seen.',
      why: 'It covers who, how often, today’s workaround and why that falls short. The guesses are labeled as guesses, so interviews can prove them wrong.',
      attempts: 1,
    },

    'problem-statement/survey-questions': {
      answer: [
        'Tell me about the last session where your group did independent practice — what were you doing, minute by minute?',
        'Tell me about the last time a student got stuck during practice. How did you find out, and how long had it been?',
        'What have you tried for keeping track of who’s working, who’s stuck and who’s done? What happened when you tried it?',
        'SURVEY: In your last session, about how many minutes did your longest-waiting student wait before you looked at their work? (0–2 / 3–5 / 6–10 / 10+ / not sure)',
      ],
      why: 'Every question asks about something that already happened, and none of them hints at a fix. The survey question takes one tap, and “not sure” is a useful answer too.',
      attempts: 2,
    },

    'problem-statement/interview-practice': {
      answer: 'Practice partner: the AI playing “Priya”, a learning-center tutor with 7 kids in grades 5–7 (simulated).\nBest question I asked: “Tell me about the last time a student got stuck” — she described a girl who erased the same line until the paper tore, and Priya only noticed at the end of group.\nWhere I led the witness: I asked “wouldn’t it help to see everyone’s paper at once?” — she just said “sure”, which tells me nothing. The AI flagged it as pitching.\nOne follow-up I should have asked: when she does spot a stuck kid, what does she do in the first 30 seconds?\nSurprise: she already tried red/green cups for “I’m stuck”. It lasted two weeks, then the cups became toys.',
      why: 'It’s honest about the bad question. The cups surprise matters more than any answer that agreed with the hypothesis.',
    },

    'problem-statement/final-statement': {
      answer: 'Small-group math tutors running 6–8 kids of mixed levels at one table struggle to see every kid’s paper during independent practice because they can only look at one page at a time, which costs them 5–10 minutes a session of stuck kids waiting silently and finished kids drifting off-task.\nTODAY: they walk laps around the table glancing at papers, ask kids to raise a hand (or flip a red cup) when stuck, or move practice onto iPads with Desmos or Classkick so they can watch screens.\nWHY THAT FAILS: a lap reaches each kid only every 4–6 minutes and the loudest kids pull the tutor over first; quiet kids don’t signal, and cup systems fade within weeks; screens make kids write math worse and drift, so many groups go back to paper.',
      why: 'It has three lines: the statement, TODAY and WHY THAT FAILS. Every claim can be checked by asking a tutor, and there’s still no product in it.',
      attempts: 1,
    },

    /* ------------------------------------------------------------ §2 User Needs */

    'user-needs/outreach-plan': {
      answer: {
        people: '1. Priya — lead tutor at Northside Learning Center, where I help on Tuesdays; runs 7 kids in grades 5–7 three evenings a week, so she lives this.\n2. Marcus — volunteer who runs the after-school math club at my old middle school (8 kids); I’ve watched him circle the table all session.\n3. Ms. Alvarez — my 7th-grade math teacher, 31 students in pods of 4; she’ll tell me whether this is only a small-group problem or a whole-class one.',
        message: 'Hi Marcus,\n\nI’m Sam — I help tutor a small math group at Northside Learning Center on Tuesdays, and I’m in Builders Club at school.\n\nI’m asking you because I’ve seen you run math club with 8 kids at one table, and you never seem to sit down.\n\nI’m researching how tutors keep track of what every kid is doing during practice time. I’m not selling anything and I have nothing to show you — I just want to hear how it actually goes for you.\n\nCould I ask you about your last few club sessions — what practice time looks like from your side of the table? 20 minutes, whenever is easy.\n\nThanks,\nSam',
      },
      why: 'These are three people Sam can actually reach, and each one is there for a reason. The third one checks whether the idea scales. The message says why it was sent to Marcus and asks for 20 minutes without pitching anything.',
      attempts: 1,
    },

    'user-needs/research-recall': {
      answer: [
        '“I do laps. By the time I’ve gone round once, somebody’s been stuck for five minutes.” — Priya, learning-center tutor (simulated interview)',
        '“The kid who needs me most is the one who’ll never put his hand up.” — Marcus, after-school math club lead (simulated)',
        'SURPRISE: Priya tried red/green cups for “I’m stuck”. It worked for two weeks, then kids forgot and the cups became toys. (simulated)',
        '“We did Classkick on iPads for a term. I could see everything — and half of them were drawing on the fractions.” — Ms. Alvarez, 7th grade, 31 students (simulated)',
        'SURPRISE (my own Tuesday group): two kids covered their paper with an arm when I walked over. The kids who most need help hide their work.',
        '“When the fast ones finish, they start something — and then it’s three kids off-task, not one.” — Marcus (simulated)',
        '“I take photos of their worksheets after group and then never look at them.” — Priya (simulated)',
        'Survey, 9 tutors (simulated): 6 of 9 said their longest-waiting kid waited 6+ minutes last session; 2 said “not sure” — which is its own answer.',
      ],
      why: 'The list is mostly direct quotes with names, plus two surprises that changed Sam’s thinking. The hidden-paper one shows why walking over doesn’t fix this.',
    },

    'user-needs/market-map': {
      answer: [
        'Walking laps around the table — well: free, and you see the real paper; falls short: each kid is seen every 4–6 minutes at best, and the loudest kid pulls you over first (Priya, Marcus).',
        '“Raise your hand” / red-green cups — well: zero cost, gives kids a voice; falls short: quiet kids never signal, and cup systems fade in a couple of weeks (Priya’s cups).',
        'Mini whiteboards held up on cue — well: every answer visible in five seconds; falls short: shows final answers, not the work, and stopping the group to hold them up breaks practice.',
        'iPads with Classkick or Desmos — well: live view of every screen at once; falls short: writing math on glass is slow, kids drift, and Ms. Alvarez’s class went back to paper.',
        'A document camera on the teacher’s desk — well: a crisp view of real paper; falls short: ONE paper at a time, and only when the kid walks it up.',
        'THE GAP: nothing shows the tutor every kid’s work on paper, live and all at once — so the quiet, stuck kid is still the last one seen.',
      ],
      why: 'It counts the informal workarounds (laps, cups), not just products. Every shortfall ties back to a quote, and the gap is one line.',
      attempts: 2,
    },

    'user-needs/need-statements': {
      answer: [
        'A small-group tutor needs a way to know within two minutes which kid is stuck or done, because quiet kids don’t signal and finishers pull others off-task (“the kid who needs me most will never put his hand up”).',
        'A small-group tutor needs a way to see a kid’s work in progress without walking over, because laps reach each kid only every 4–6 minutes and kids hide their paper when the tutor arrives.',
        'A small-group tutor needs a way to keep and look back at each kid’s handwritten work across sessions, because papers go home and don’t come back, and phone photos go unread.',
      ],
      why: 'These are three different needs, and none of them names a camera. Each “because” points at a specific quote or observation.',
      attempts: 2,
    },

    'user-needs/top-needs': {
      answer: 'USER: a tutor or small-group lead running 6–8 kids of mixed levels at one table during independent practice.\n1. Know within two minutes which kid is stuck or done — #1 because every interview came back to it: the kid who needs help most won’t ask, and unnoticed finishers pull others off-task.\n2. See a kid’s work in progress without walking over — laps reach each kid every 4–6 minutes, and kids hide their paper when the tutor arrives.\n3. Keep and look back at each kid’s handwritten work across sessions — papers go home and don’t return; photos go unread.\nTHE GAP: laps, hands and cups all depend on the tutor being there or the kid speaking up, and iPads show everything but cost the paper. Nothing tells the tutor who’s stuck while kids keep working on paper.',
      why: 'The needs are ranked, and #1 comes with a reason. The gap explains why today’s options miss need #1 in particular.',
      attempts: 1,
    },

    /* ------------------------------------------------------ §3 Product Features */

    'product-features/translate-features': {
      answer: [
        'Need 2 (see work without walking over) → Live table grid: one overhead camera; every kid’s paper shows as its own tile on the tutor’s laptop.',
        'Need 2 → Tap to zoom: tap a tile to see that paper full-size, sharp enough to read a fraction.',
        'Need 1 (who’s stuck or done) → Stuck/done flags: a tile turns amber when that paper hasn’t changed for 90 seconds, green when the kid writes DONE.',
        'Need 1 → “I’m stuck” card: the kid sets a printed red card on the corner of their paper; the camera sees it and their tile jumps to the top.',
        'Need 1, at class scale → Pod mode: one camera per group of 4–6 desks, so a teacher gets one grid for 30 kids.',
        'Need 3 (keep work over time) → Auto-snapshots: each kid’s paper saved to their own folder every 2 minutes and at the end, labeled with the date.',
        'Need 3 → Mark up and send back: the tutor circles a step on a snapshot and it’s waiting in the kid’s folder next session.',
        'Need 3 → Smart-pen input: kids with a smart pen send strokes instead of camera frames, with step-by-step replay.',
      ],
      why: 'Every need gets at least one feature, and each feature is something you’d see on screen. There are no orphans, and nothing says “AI-powered”.',
      attempts: 1,
    },

    'product-features/prioritize': {
      answer: {
        must: [
          'Live table grid: feasibility — one ~$100 4K webcam on a ~$40 boom stand covers 6–8 papers over USB to my laptop; nothing to charge, wire to desks or install.',
          'Stuck/done flags: value — this IS need #1, and it’s feasible because “no new ink for 90 seconds” is a simple pixel-change check on each tile.',
          'Auto-snapshots: uniqueness — no current option keeps the paper work, and it’s nearly free once the grid already has every tile.',
        ],
        should: [
          'Tap to zoom',
          '“I’m stuck” card',
          'Pod mode for a class of 30',
        ],
        could: [
          'Mark up and send back',
          'Smart-pen input with replay',
        ],
      },
      why: 'It has three MUSTs, each with a reason. Feasibility decided the hardware: per-desk cameras need charging and smart pens need special paper, so both waited.',
      attempts: 2,
    },

    'product-features/feature-list': {
      answer: 'MUST\n- Live table grid — one overhead webcam crops every kid’s paper into its own tile on the tutor’s laptop. Serves need #2 (see work without walking over) and makes #1 possible.\n- Stuck/done flags — a tile turns amber after 90 seconds with no new writing and green when the kid writes DONE. Serves need #1 (know who’s stuck or done).\n- Auto-snapshots — each kid’s paper saved to their own folder every 2 minutes and at the end. Serves need #3 (keep work over time).\nSHOULD\n- Tap to zoom on one paper\n- Red “I’m stuck” card the camera can see\n- Pod mode: one camera per desk group, one grid for a class of 30\nCOULD\n- Mark up a snapshot and send it back\n- Smart-pen input with stroke replay',
      why: 'Someone who skipped the rest of the worksheet can read this cold. Each MUST says what it does and which need it serves.',
      attempts: 1,
    },

    /* ---------------------------------------------------------------- §4 MVP Plan */

    'mvp-plan/core-choice': {
      answer: 'Core need: #1 — know within two minutes which kid is stuck or done.\nFeatures making the cut: the live table grid and stuck/done flags. Snapshots stay only as “save one picture per kid at the end” — no folders, no history page yet.\nDeliberately out: pod mode for 30, the red card, zoom, mark-up, smart pens. Cutting pod mode stings, because Ms. Alvarez’s class of 30 is the bigger market. But if it doesn’t work for 7 kids at one table, it won’t work for 30.',
      why: 'It picks one need and two features, and it shrinks the third. It names what was cut and admits that cutting it hurt.',
    },

    'mvp-plan/testable-version': {
      answer: 'Day one: before Tuesday group I clamp a 4K webcam on a boom stand above the table, open the TableView page on my laptop, and drag a box around each of the 7 seats (about 2 minutes). During the 20-minute practice block the laptop sits at the end of the table: each kid’s paper is a tile, tiles go amber after 90 seconds with no new writing and green when the kid writes DONE. I’ll tune that number in the first session: too short and kids who are just thinking light up. At the end it saves one picture per kid.\nTesters: my own Tuesday group (7 kids, grades 5–7), then Priya’s Thursday group and Marcus’s math club, two sessions each.\nSuccess after 2 weeks (6 sessions): the longest a stuck kid waits before I get to them drops from ~8 minutes to under 3 — 90 seconds for the flag plus up to a minute to finish with the kid I’m helping (timed with a tally sheet for one session before and every session after), and the tutor keeps it running for the whole practice block in at least 5 of 6 sessions.',
      why: 'Day one is something you could literally do. The testers are people Sam already knows. Success is two numbers a mentor could check, with a baseline measured before the change.',
      attempts: 1,
    },

    'mvp-plan/final-plan': {
      answer: 'PROBLEM: Small-group math tutors can’t see every kid’s paper at once, so stuck kids wait silently and finished kids drift off-task.\nUSER: a tutor running 6–8 mixed-level kids at one table.\nCORE NEED: know within two minutes who’s stuck or done.\nCORE FEATURES: (1) live table grid — one overhead webcam shows every paper as a tile; (2) stuck/done flags — amber after 90 seconds of no writing, green on DONE; (3) one end-of-session snapshot per kid.\nFIRST TESTABLE VERSION: a 4K webcam on a boom stand plus a laptop web page; I draw seat boxes once and run it through a 20-minute practice block.\nFIRST TESTERS: my Tuesday group (7 kids), Priya’s Thursday group, Marcus’s math club.\nSUCCESS (2 weeks, 6 sessions): the longest stuck-kid wait drops from ~8 to under 3 minutes (90-second flag plus about a minute to get there), and tutors keep it on for the whole block in 5 of 6 sessions.',
      why: 'All seven parts fit in under 160 words, and each one matches the artifacts before it. A mentor could poke holes in it without asking anything.',
      attempts: 2,
    },

    /* ------------------------------------------------------------------ §6 Pitch */

    'pitch/pitch-scene': {
      answer: 'SCENE: It’s Tuesday, 4:40pm, twenty minutes into practice at Northside. I’m crouched next to Aiden, who is loudly stuck on a fraction problem. Across the table, Jordan has been staring at question 3 since 4:31 — pencil down, arm over his paper — and he hasn’t said a word. Two seats over, Mia finished five minutes ago and is now teaching Leo to flick erasers. I don’t find out about Jordan until 4:43, with twelve minutes left.\nQUOTE: “The kid who needs me most is the one who’ll never put his hand up.” — Marcus, after-school math club lead',
      why: 'It’s one moment, with a clock, names and things that go wrong, and no statistics. The quote comes from the research and backs up exactly what the scene shows.',
      attempts: 1,
    },

    'pitch/pitch-outline': {
      answer: 'SLIDE 1 — THE PROBLEM\nON SCREEN: 7 kids. 7 papers. One pair of eyes.\nI SAY: Small-group math tutors can only look at one kid’s paper at a time. That costs every session 5–10 minutes of stuck kids waiting silently and finished kids drifting off-task.\n\nSLIDE 2 — WHY IT’S PAINFUL TODAY\nON SCREEN: Laps. Hands up. iPads. All miss Jordan.\nI SAY: Tutors walk laps that reach each kid every 4–6 minutes, and quiet kids never raise a hand. iPads show every screen, but kids write math worse on glass and drift — so most groups went back to paper.\n\nSLIDE 3 — MY EXPERIENCE\nON SCREEN: Photo of my Tuesday table, Jordan circled\nI SAY: Tuesday, 4:40 — I’m helping the loudest kid while Jordan has sat stuck on question 3 for nine minutes, arm over his paper. As Marcus put it: “The kid who needs me most is the one who’ll never put his hand up.”\n\nSLIDE 4 — THE SOLUTION\nON SCREEN: Every paper. One screen. Stuck kids flagged.\nI SAY: TableView is one webcam on a stand over the table: every kid’s paper is a tile on my laptop, and a tile turns amber when a kid stops writing for 90 seconds. I know who’s stuck or done within two minutes, and each paper is saved at the end.\n\nSLIDE 5 — THE PLAN\nON SCREEN: 3 groups. 2 weeks. Waits under 3 minutes.\nI SAY: I’m testing it with my Tuesday group, Priya’s Thursday group and Marcus’s math club for six sessions; success is the longest stuck-kid wait dropping from about 8 minutes to under 3. My ask: if you run a small group, lend me your table for two sessions.',
      why: 'The five slides are in the required order, and each ON SCREEN line is 8 words or fewer. The pitch ends with one specific ask, and every number already appeared earlier in the worksheet.',
      attempts: 1,
    },
  };

  /* The answer as the app stores it in st.answer: the same text the Builder file
     carries and the AI reviewer reads. Mirrors app.js — list boxes are lines,
     fields are "LABEL:\ntext" blocks (fieldsAnswerText), boards are
     "LABEL (hint):\n- card" blocks (boardAnswerText). */
  function answerText(step, answer) {
    if (Array.isArray(answer)) return answer.join('\n');
    if (typeof answer === 'string') return answer;
    if (step.fields) {
      return step.fields.map(f => `${f.label.toUpperCase()}:\n${(answer[f.id] || '').trim()}`).join('\n\n');
    }
    if (step.board) {
      const cols = step.board.columns
        ? step.board.columns.map(c => ({ key: c.id, label: c.label, hint: c.hint }))
        : [{ key: 'left', ...step.board.left }, { key: 'right', ...step.board.right }];
      return cols.map(c => {
        const cards = (answer[c.key] || []).map(t => '- ' + t).join('\n');
        return `${c.label.toUpperCase()} (${c.hint}):\n${cards || '- (none yet)'}`;
      }).join('\n\n');
    }
    return String(answer);
  }

  return {
    id: 'tableview',
    title: 'TableView',
    tagline: 'Seeing every kid’s paper in a small-group session',
    builder: 'Sam, a high-schooler who helps tutor a small math group on Tuesdays',
    steps,
    answerText,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
if (typeof window !== 'undefined') window.EXAMPLES = EXAMPLES;
