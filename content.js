/*
  Builders Club — semester worksheet content.
  Single source of truth for BOTH the browser (rendering) and the server (rubrics).
  Adding a worksheet, section, or step = adding config here, not code.

  Step types:
    journal   — personal-input elicitation; local validation only (minLines/minLength), no AI call
    video     — gated YouTube segment {youtubeId, start, end} (seconds); videoRecap shown on completion
    exercise  — AI review loop against `rubric`; optional `reviewerNote` adds special reviewer
                instructions (role-plays, red-teams) injected into the review prompt
    synthesis — auto-drafts on first open, using ONLY the student's words from `synthesizesFrom` steps;
                isArtifact:true → the accepted answer becomes the hub card's final artifact

  Optional worksheet fields:
    extra:     true — bonus worksheet. Renders on the EXTRAS shelf at the bottom of the home
               page, contributes nothing to the artifact counter, and awards no XP. Steps in
               an extra worksheet should carry no `xp` at all.
    freeRoam:  true — every section and step is open from day one regardless of the global
               free-roam setting. Always set alongside extra:true.

  Optional section fields:
    weeks:         'Weeks 5–6' — when this happens in class; shown as a 🗓 chip. Extras use 'Anytime'.
    alwaysUnlocked: true — this section ignores section gating (e.g. the Ship It walkthrough).

  Optional step fields:
    buildsOn:  ['sectionId/stepId', …] — earlier work this step builds on. Pinned above the
               answer box in the UI and handed to the reviewer. Keys are globally unique, so
               cross-worksheet references work.
    resources: [{ title, url, note }] — curated reading ("Go deeper"), max 2 external per step.
               A url starting with '#' is an internal link into another worksheet
               (e.g. '#/w/people-skills/s/story-telling') and renders as its own
               "On the extras shelf" block instead of opening a new tab.

  Section ids and step keys must be unique ACROSS worksheets (state is keyed by sectionId/stepId).
  Video segments are transcript-verified excerpts from public YC / Karpathy talks — each
  start/end was chosen from the actual transcript so the segment says exactly what the
  step needs. One video can appear multiple times in a worksheet, different segment each time.
*/
'use strict';

const MVP_WORKSHEET = {
  id: 'mvp',
  title: 'Build Your MVP Plan',
  subtitle: 'Go from a vague gripe to a plan you\'ll present publicly and build next semester.',
  sections: [

    /* ================================================================
       SECTION 1 · REAL PROBLEM STATEMENT
       ================================================================ */
    {
      id: 'problem-statement',
      num: 1,
      title: 'Real Problem Statement',
      kicker: 'Section 01 · Find a Real Problem',
      weeks: 'Weeks 1–3 · revisited Wk 13',
      tagline: 'Turn a vague gripe into a falsifiable problem statement backed by real people.',
      xp: 120,
      artifactLabel: 'YOUR REAL PROBLEM STATEMENT',
      steps: [
        {
          id: 'video-spot-problems',
          type: 'video',
          title: 'The best ideas hide in YOUR life',
          prompt: 'Before you write anything, watch where the best startup problems actually come from — and the exact exercise you\'re about to do.',
          video: { youtubeId: 'Th8JoIan4dg', start: 1406, end: 1536 },
          xp: 20,
          videoRecap: [
            'The best recipe: a problem you\'ve personally encountered — ideally one you\'re in an unusual position to see.',
            'Vetcove: two brothers watched their veterinarian dad order supplies by phone. Thousands of vets knew the problem; nobody who builds things had seen it. Zero competition for years.',
            'The exercise: go through your life — school, teams, clubs, family. What problems did you come across? What do you know that other people don\'t?',
          ],
        },
        {
          id: 'journal-problems',
          type: 'journal',
          title: 'Problems in my life',
          resources: [{ title: 'Founder Stories — Where Ideas Come From', url: '#/w/founder-stories/s/idea-origins', note: 'Two accounts of how real products started, including a founder who built every one of his from something he needed himself.' }],
          prompt: 'List every real problem you bumped into this week — yours or ones you watched someone else have. Small and boring is great. One per box, at least 10.',
          listAnswer: { min: 10, max: 15, itemLabel: 'Problem', placeholder: 'Something that wasted time, caused stress, or made someone improvise…' },
          xp: 15,
          lessonPanel: {
            point: 'This is a <b>journal, not a test</b> — there are no wrong entries. The best problems are the boring ones you almost didn\'t notice. If you saw someone get annoyed, stuck, or waste time this week, that moment belongs on this list.',
            good: 'Every Saturday shift, the café wastes ~30 minutes figuring out who\'s on register because the schedule lives in three different group chats.',
            bad: 'World hunger. <em>(real, but you didn\'t bump into it this week — we want problems you can actually observe)</em>',
          },
        },
        {
          id: 'pick-top-5',
          type: 'journal',
          title: 'Pick your top 3 by impact',
          buildsOn: ['problem-statement/journal-problems'],
          prompt: 'From your list above, pick the 3 that impact your life (or someone you know) the most. One per box, and add a few words on WHY it makes the cut.',
          listAnswer: { min: 3, max: 3, itemLabel: 'Problem', placeholder: '[problem] — [why: how often · what it costs · why I care]' },
          xp: 15,
          lessonPanel: {
            point: 'Impact = how often it happens × how much it costs (time, money, stress) × how much you actually care. A problem you care about survives the whole semester — pick ones you\'d still want to think about in December.',
            good: '1. Yearbook photo chaos — happens every spring, we lost ~200 photos across random drives last year, and I\'m the one who has to hunt them down.',
            bad: '1. Homework exists. <em>(you don\'t actually want to work on this for 4 months)</em>',
          },
        },
        {
          id: 'video-good-statement',
          type: 'video',
          title: 'The #1 mistake: solution first',
          prompt: 'Watch: the most common startup mistake — the "solution in search of a problem" — in 90 seconds from YC\'s Startup School. The next step unlocks when it finishes.',
          video: { youtubeId: 'Th8JoIan4dg', start: 100, end: 192 },
          xp: 20,
          videoRecap: [
            'The #1 mistake: picking a solution first ("AI is cool — what can I apply it to?") and hunting for a problem to fit it.',
            'A made-up problem can look plausible — but if people don\'t care about the problem, they won\'t care about your solution.',
            'Fall in love with a problem, not a solution. And "huge societal problems" are too abstract to start from — get specific.',
          ],
        },
        {
          id: 'video-tarpits',
          type: 'video',
          title: 'Beware the tarpit',
          prompt: 'Check your top 3 against this: some problems LOOK perfect and have quietly swallowed founders for twenty years.',
          video: { youtubeId: 'Th8JoIan4dg', start: 186, end: 290 },
          xp: 20,
          videoRecap: [
            'Tarpit ideas: problems that lots of people have and that LOOK easy to solve — but a structural reason means nobody has cracked them in 20 years of trying.',
            'The classic: "an app to make plans with my friends." Everyone has the problem, everyone can imagine the app, and it never works.',
            'If a problem on your list feels suspiciously popular and suspiciously easy, ask: why hasn\'t anyone solved it yet?',
          ],
        },
        {
          id: 'transform-2',
          type: 'exercise',
          title: 'Transform 3 problems into problem statements',
          buildsOn: ['problem-statement/pick-top-5'],
          resources: [{ title: 'Paul Graham — How to Get Startup Ideas', url: 'https://paulgraham.com/startupideas.html', note: 'The essay behind this whole section: why "noticing" beats "brainstorming".' }],
          prompt: 'Take all THREE problems from your top 3 (pinned below) and rewrite each as a real problem statement — one per box: [specific person] struggles to [do X] because [root cause], which costs them [consequence]. If one refuses to fit the format, that\'s a clue it isn\'t a strong problem — rework it rather than force it.',
          listAnswer: { min: 3, max: 3, itemLabel: 'Statement', placeholder: '[specific person] struggles to [do X] because [root cause], which costs them [consequence]' },
          xp: 30,
          lessonPanel: {
            point: 'The format forces every claim a problem needs: a <b>person</b>, a <b>struggle</b>, a <b>cause</b>, and a <b>price</b>. One sentence each. Falsifiable — someone could check whether it\'s true. And <b>no solution smuggled in</b>.',
            good: 'Student tutors struggle to schedule sessions because requests arrive by text, email, and hallway conversations, which costs them about three no-shows a week.',
            bad: 'We should make an app so students save money. <em>(that\'s a pitch — the problem is hidden and a solution is baked in)</em>',
          },
          rubric: `- Contains THREE distinct problem statements drawn from the student's own listed problems (not new invented ones)
- Each names a SPECIFIC person or narrow group (not "people", "students", "everyone")
- Each has a struggle, a root cause, and a concrete consequence/cost
- None of them contains a solution, product, or app idea
- Each is falsifiable — a real person could confirm or deny it`,
        },
        {
          id: 'video-acute',
          type: 'video',
          title: 'How sharp is your problem?',
          prompt: 'Before you write your hypothesis, watch how YC judges whether a problem is acute — and the two questions about real people that founders forget to ask themselves.',
          video: { youtubeId: 'Th8JoIan4dg', start: 508, end: 585 },
          xp: 20,
          videoRecap: [
            'The acuteness test: what\'s the alternative? Brex won because startups literally could not get a credit card — the alternative to their solution was nothing.',
            'Two personal checks: do YOU want this? Do you know real, specific people who want it?',
            'If both answers are no, that\'s your signal to go talk to users — which is exactly where this section goes next.',
          ],
        },
        {
          id: 'problem-hypothesis',
          type: 'exercise',
          title: 'Write your problem hypothesis',
          buildsOn: ['problem-statement/transform-2'],
          prompt: 'Pick the strongest of your three statements (pinned below) and stretch it into a hypothesis you could test by talking to people: WHO feels this most acutely, HOW OFTEN it happens, WHAT they do about it today, and WHY that isn\'t good enough. You\'re allowed to guess — that\'s what makes it a hypothesis.',
          placeholder: 'I believe [who] hits this [how often], currently deals with it by [what], and hates that because…',
          xp: 30,
          masteryHint: 'Skippable if the student\'s problem statements already clearly name who feels the problem most acutely, how often it occurs, and what those people currently do about it.',
          lessonPanel: {
            point: 'A hypothesis is a <b>guess written down clearly enough to be proven wrong</b>. Next step you\'ll build the questions that test it. If you already know all four parts for sure, you\'ve interviewed people — if not, guessing is the honest move.',
            good: 'I believe club treasurers (not regular members) hit this every fundraiser, currently track cash in a notes app, and hate it because they\'re the ones blamed when totals don\'t match.',
            bad: 'People have this problem a lot and nothing works. <em>(untestable — no who, no frequency, no current behavior)</em>',
          },
          rubric: `- Names WHO has it most acutely (a narrower group than the problem statement is fine)
- States HOW OFTEN it happens (a guess is acceptable if framed as one)
- Describes what those people DO about it today
- Says why the current workaround isn't good enough`,
        },
        {
          id: 'video-interview-run',
          type: 'video',
          title: 'How to run the conversation',
          prompt: 'Watch a real user interview happen — including the one rule that beginners break in the first thirty seconds.',
          video: { youtubeId: 'z1iF1c8w5Lg', start: 376, end: 511 },
          xp: 20,
          videoRecap: [
            'One deep interview beats 500 shallow survey responses — build rapport so people tell you the truth.',
            'THE rule: don\'t introduce your idea until the end of the call — or ever. Your job is to listen, not talk.',
            'Watch the example: every reply gets an open follow-up ("what do you do with the report?", "why not?", "tell me more about that") until the real problem surfaces.',
          ],
        },
        {
          id: 'video-interview',
          type: 'video',
          title: 'Questions that get the truth',
          prompt: 'Watch this before writing your own questions: the exact questions that work in a user interview — and the four kinds that quietly ruin one.',
          video: { youtubeId: 'z1iF1c8w5Lg', start: 511, end: 695 },
          xp: 20,
          videoRecap: [
            'Never pitch — don\'t even say what you\'re building. You\'re there to learn the problem, nothing else.',
            'The workhorse questions: "how do you do X today?", "what\'s the hardest part?", "why is it hard?", "how often?", "what do you do to solve it now?"',
            'Follow up with "what do you mean by that?" and "why is that important to you?" — one answer rarely holds the whole truth.',
            'Never ask: "would you use our product?", "what features would make it better?", yes/no questions, or two questions at once.',
          ],
        },
        {
          id: 'survey-questions',
          type: 'exercise',
          reviewerNote: 'This step is a survey red-team. Before judging, ROLE-PLAY a realistic person from the student\'s own problem area (use their prior work to pick who) answering each question in one short line, exactly as a real person would. Answer HONESTLY: a question that works gets a real, useful answer, and you say so. Give a vague or useless answer ONLY where the question genuinely earns it — never manufacture a bad answer to make a point, and never say an option "doesn\'t fit" when it does. Put the role-play inside your feedback, clearly formatted, THEN break character and explain what it revealed. Judge the QUESTIONS, not the wording of the multiple-choice options: as long as the survey question asks for one fact in one tap, the exact answer choices are theirs to pick. Pass if the questions are non-leading and ask about actual behavior (not opinions or predictions).',
          title: 'Build your interview questions',
          buildsOn: ['problem-statement/problem-hypothesis'],
          resources: [
            { title: 'The Mom Test — full free write-up', url: 'https://mtlynch.io/book-reports/the-mom-test/', note: 'The whole method for free, in about fifteen minutes of reading: the three rules, the exact good and bad question pairs, and what to do after the interview.' },
            { title: 'Rob Fitzpatrick\'s own Mom Test mini-workshop', url: 'https://www.youtube.com/watch?v=tOojBwR8cis', note: 'The author walking through how to find the gaps in what you actually know about your users. Free on his channel.' },
          ],
          prompt: 'Write THREE interview questions (boxes 1–3) and ONE survey question (box 4) to test your hypothesis (pinned below) with real people. Careful: the AI will answer them as a real person from your problem area would — leading questions will get you useless answers.',
          listAnswer: { min: 4, max: 4, itemLabel: 'Question', placeholder: 'Tell me about the last time you…' },
          xp: 30,
          lessonPanel: {
            point: 'Ask about <b>behavior, not opinions</b>. "Would you use an app that…?" gets polite lies. "Tell me about the last time you planned your week" gets the truth. Never mention your idea. Never put the answer inside the question.',
            good: 'Tell me about the last time you tried to plan workouts for the week. What did you actually use?',
            bad: 'Don\'t you think planning workouts is really annoying? <em>(leading — you put the answer in their mouth)</em>',
          },
          rubric: `- Exactly 3 interview questions + 1 survey question, all aimed at testing the student's stated hypothesis
- All questions ask about actual past behavior or specific experiences, not opinions or predictions
- No leading questions (nothing that presumes the answer or mentions the student's own problem framing as fact)
- The survey question is answerable in one tap/line (scale, multiple choice, or single fact)`,
        },
        {
          id: 'interview-practice',
          type: 'journal',
          practice: true,
          title: 'Practice the interview — on an AI',
          buildsOn: ['problem-statement/survey-questions'],
          prompt: 'Before you spend a real conversation, run a practice one at home. Hit the copy button below and paste it into your own AI chat (ChatGPT, Claude — your pick): the AI becomes a realistic person from your problem area. Interview them for real — your questions, their answers, your follow-ups. When you\'re done, type END INTERVIEW and it will break character and tell you how you interviewed. Then come back and log what you learned.',
          placeholder: 'Best question I asked: …\nWhere I led the witness / pitched: …\nOne follow-up I should have asked: …',
          minLines: 3,
          xp: 20,
          lessonPanel: {
            point: 'The practice interview is <b>reps for the real thing</b> — the AI will answer like a busy real person: short, polite, sometimes vague. Your job is follow-ups: "what do you mean by that?", "walk me through the last time". The feedback at the end only counts if you actually pushed past the first answers.',
            good: 'It said "I just deal with it" and I asked what dealing with it looked like last Tuesday — that\'s where the real answer was.',
            bad: 'I asked my three questions, it answered, done in four messages. <em>(a real interview is follow-ups — go again and dig)</em>',
          },
        },
        {
          id: 'final-statement',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your real problem statement',
          prompt: 'Bring it together — this is the write-up you\'ll present when you choose your problem. Line 1: [specific person] struggles to [do X] because [root cause], which costs them [consequence]. Line 2 — TODAY: what those people currently do about it. Line 3 — WHY THAT FAILS: why the workaround isn\'t good enough. Falsifiable, no solution anywhere. A starting draft is assembled from your own work — make it sharp, and build Line 1 from the statement your hypothesis picked as strongest, not just the first on your list.',
          placeholder: '',
          xp: 30,
          draftWordLimit: 90,
          synthesizesFrom: ['problem-hypothesis', 'transform-2', 'survey-questions'],
          lessonPanel: {
            point: 'This is the <b>foundation of your whole MVP plan</b> — who has it, how often, what they do now, and why that\'s not good enough. It should make a stranger wince, not nod. If someone could disagree with it, you\'re close.',
            good: 'Student editors struggle to track who\'s writing what because assignments live in DMs, which costs them 2–3 blank pages every issue. TODAY: the editor re-asks everyone weekly. WHY THAT FAILS: people reply late or not at all, so pages stay blank until deadline night.',
            bad: 'Organization is hard for busy students. <em>(nobody can disagree with this, which is exactly the problem)</em>',
          },
          rubric: `- Opens with a one-sentence problem statement: a specific person, their struggle, the root cause, and what it costs them
- Includes what those people DO about it today, and why that workaround falls short
- Consistent with (or a deliberate sharpening of) the student's earlier statements and hypothesis
- Specific person/group, concrete cost, falsifiable
- Zero solution content`,
        },
      ],
    },

    /* ================================================================
       SECTION 2 · USER NEEDS
       ================================================================ */
    {
      id: 'user-needs',
      num: 2,
      title: 'User Needs',
      kicker: 'Section 02 · Know Your User & Market',
      weeks: 'Weeks 3 → 14',
      tagline: 'Map what your users do today, find the gap, and define what they actually need.',
      xp: 100,
      artifactLabel: 'YOUR TOP USER NEEDS',
      steps: [
        {
          id: 'video-find-users',
          type: 'video',
          title: 'Finding people to talk to',
          prompt: 'If your interview list is thin, watch this first: how founders actually find and reach the people they learn from — starting with one person, not a thousand.',
          video: { youtubeId: 'MT4Ig2uqjTc', start: 898, end: 1146 },
          xp: 20,
          videoRecap: [
            'The ladder: start with yourself (test your questions on you), then friends and coworkers for warm intros — "every good user research strategy begins with just one or two people."',
            'The critical skill is an unbiased, detailed interview — NOT pitching your idea. You\'re there to learn, not to sell.',
            'When cold email fails, show up: a YC startup got dozens of 10–15-minute meetings by literally dropping by fire stations in person.',
            'Ask small: 15 minutes of their time about a problem THEY have — "you\'ll be helping them out." Start with one, then three, then five.',
          ],
        },
        {
          id: 'outreach-plan',
          type: 'exercise',
          title: 'Plan your outreach',
          buildsOn: ['problem-statement/survey-questions'],
          resources: [{ title: 'People Skills — The Networking Call', url: '#/w/people-skills/s/networking-call', note: 'A professional interviewer\'s five rules for the call itself, and how to phrase an ask someone can say yes to.' }],
          prompt: 'Time to actually reach people. Name THREE real, reachable people or places in your problem area you\'ll contact first (names, teams, servers, forums — specific), then write the actual outreach message you\'ll send, in this shape: who you are → one line on what you\'re researching → a small ask (15–20 minutes), no pitching. Your interview questions are pinned below — this message is how they get used.',
          placeholder: '1. [name] — [why they\'re the right person to ask]…\n\nMessage: "Hi [name] — I\'m [you], and I\'m researching [topic]…"',
          xp: 30,
          lessonPanel: {
            point: 'Outreach fails from <b>pitching</b>, not from asking. You\'re not selling anything yet — you\'re a person curious about their experience. Short beats clever, specific beats broad, and naming why you\'re asking THEM beats any template.',
            good: '"Hi Mr. Alvarez — I\'m on Westside\'s stage crew, and I\'m researching how theaters keep track of props between shows. Could I ask how your crew handles it? 20 minutes, whenever works."',
            bad: '"Hi! I\'m building an app that solves prop tracking forever — would you use it?" <em>(that\'s a pitch, and it poisons every answer that follows)</em>',
          },
          rubric: `- THREE specific, plausibly reachable targets from the student's own problem area (real names/roles/communities, not "some students")
- The message introduces who they are, says what they're researching in one line, and asks for ~20 minutes
- The message does NOT pitch a product, solution, or app idea
- The message is personalized — it says why THIS person/community
- Consistent with their problem hypothesis and interview questions`,
        },
        {
          id: 'research-recall',
          type: 'journal',
          title: 'What did people actually tell you?',
          buildsOn: ['user-needs/outreach-plan', 'problem-statement/survey-questions'],
          prompt: 'Think back over the conversations your outreach started — and anything else you\'ve observed about your problem. Write down at least four things REAL people told you or that you watched them do, one per box. Direct quotes are gold. Surprises are double gold.',
          listAnswer: { min: 4, max: 8, itemLabel: 'Observation', placeholder: '"[their exact words]" — [who said it]' },
          xp: 15,
          lessonPanel: {
            point: 'This is a memory dump, not analysis — that comes next. What people <b>said</b> and <b>did</b> goes here; what you think it means comes later. If you haven\'t talked to anyone yet, write what you\'ve directly observed, and be honest that it\'s thin.',
            good: '"I just text all three owners and hope somebody answers" — heard this twice, from different dog walkers.',
            bad: 'People confirmed my idea is good. <em>(that\'s a conclusion, not an observation — and nobody says that unprompted)</em>',
          },
        },
        {
          id: 'video-market',
          type: 'video',
          title: 'Your real competition is a spreadsheet',
          prompt: 'Watch: positioning expert April Dunford on the "competitors" that don\'t look like competitors — the ones your market map has to take seriously. (And remember: people already paying for anything in your space is a GOOD sign — the problem is worth money.)',
          video: { youtubeId: 'hdjlCLb9Hl8', start: 1352, end: 1578 },
          xp: 20,
          videoRecap: [
            'Question one: "what do I have to beat to win?" — and it is NOT just the things that look exactly like you.',
            'The real rival set includes the STATUS QUO: whatever your user does about the problem right now, "even if it\'s crappy."',
            'The killer stat: ~40% of deals are lost to "no decision" — which really means "we lost to the spreadsheet, we lost to pen and paper, we lost to interns."',
            'To move someone off a workaround, list what you have that the alternatives don\'t — then ask "so what? why does the user care?" and cut anything an alternative could match.',
          ],
        },
        {
          id: 'market-map',
          type: 'exercise',
          title: 'Map what already exists',
          buildsOn: ['problem-statement/final-statement'],
          prompt: 'Your problem statement is pinned below. List at least THREE things those users use today to deal with it — apps, spreadsheets, group chats, sticky notes, memory, or plain putting-up-with-it — one per box. For each: what it does WELL, and where it FALLS SHORT for your user. Make your LAST box the gap: "THE GAP: [the thing none of them do]".',
          listAnswer: { min: 4, max: 7, itemLabel: 'Option', placeholder: '[what they use today] — well: …; falls short: …' },
          xp: 30,
          lessonPanel: {
            point: 'Your product will live in the <b>gap</b> — the thing every current option fails to do for YOUR user. Be generous about what counts as competition: memory, habits, and "just deal with it" are your real rivals, not just apps. If nothing exists at all, ask whether the problem is real.',
            good: 'Group chat — well: everyone\'s already in it; falls short: the study plan scrolls out of sight by Tuesday. THE GAP: nothing keeps the plan where everyone actually looks.',
            bad: 'There\'s nothing like my idea out there. <em>(there\'s always something — even doing nothing is a competitor)</em>',
          },
          rubric: `- At least THREE current options/workarounds; informal ones (memory, group chats, doing nothing) count
- Each option has BOTH something it does well AND a specific way it falls short for this user
- The shortfalls connect to the student's stated problem or research, not generic complaints
- Ends with a one-line gap naming what none of the current options do`,
        },
        {
          id: 'video-needs',
          type: 'video',
          title: 'The faster-horse trap',
          prompt: 'Watch: the two interview questions that dig up NEEDS instead of feature wishlists — and why "what features do you want?" is the one question that always lies to you.',
          video: { youtubeId: 'MT4Ig2uqjTc', start: 671, end: 852 },
          xp: 20,
          videoRecap: [
            '"What, if anything, have you DONE to try to solve this?" — if people aren\'t already hunting for solutions, the problem isn\'t burning enough.',
            'Dropbox\'s users were already emailing files, sharing computers — one had literally set up rsync. Proof the problem was real, AND a map of the competition.',
            '"What don\'t you LOVE about what you\'ve tried?" is the start of your feature set. NOT "what features would you want?" — users are bad at naming their next features.',
            'The Henry Ford kicker: users would have asked for a faster horse. Target the problems with existing solutions, not the features people request.',
          ],
        },
        {
          id: 'need-statements',
          type: 'exercise',
          title: 'Write 3 need statements',
          buildsOn: ['user-needs/research-recall'],
          prompt: 'Turn what you heard (pinned below) into THREE need statements, one per box: [your user] needs a way to [X] because [Y]. Needs, not features — if your sentence contains an app, a button, or an AI, dig one level deeper. Every "because" should trace to something in your research.',
          listAnswer: { min: 3, max: 3, itemLabel: 'Need', placeholder: '[your user] needs a way to [X] because [what your research showed]' },
          xp: 30,
          masteryHint: 'Skippable if the student\'s prior research or hypothesis work already contains 3+ clearly separated user needs grounded in things real people said.',
          lessonPanel: {
            point: 'A need is <b>solution-free</b>. "Needs a spreadsheet" is a feature; "needs a way to see what\'s already ordered without asking around" is a need. The "because" must trace back to something a real person told you or you observed.',
            good: 'Baristas need a way to swap shifts without texting the whole staff, because a single swap currently takes 20+ messages.',
            bad: 'Users need an AI-powered dashboard. <em>(that\'s your solution wearing a need costume)</em>',
          },
          rubric: `- THREE distinct need statements, each naming who needs it, what they need to be able to do, and why
- The user matches the person in their problem statement (or a deliberate, stated narrowing)
- What they need is a capability/outcome, NOT a feature, product, or technology
- Each reason is grounded in their reported research or observations, not invented
- The three needs are genuinely different, not one need rephrased`,
        },
        {
          id: 'top-needs',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your top user needs',
          prompt: 'Lock in your final user-needs list: who your user is (one line), their needs ranked by importance with a few words on why #1 is #1, and one line on THE GAP — why what exists today doesn\'t meet need #1. A starting draft is assembled from your own words.',
          placeholder: '',
          xp: 35,
          draftWordLimit: 130,
          synthesizesFrom: ['research-recall', 'market-map', 'need-statements'],
          lessonPanel: {
            point: 'Ranking is the thinking. Anyone can list needs; deciding which one matters MOST — and why nothing out there meets it — is what turns research into a product direction. #1 becomes the heart of your feature list next section.',
            good: 'User: esports team captains who book the scrims. #1: know who\'s actually free before booking (this is where matches fall apart). THE GAP: polls and chats both die within a day…',
            bad: 'All the needs are equally important. <em>(ranking dodged = decision dodged)</em>',
          },
          rubric: `- Opens with a one-line description of who the user is
- Needs are ranked (not just listed), and the #1 choice has an explicit reason
- Includes a gap line: why today's options (from their market map) don't meet need #1
- Needs remain solution-free
- Consistent with their research-recall, market map, and need statements`,
        },
      ],
    },

    /* ================================================================
       SECTION 3 · PRODUCT FEATURES
       ================================================================ */
    {
      id: 'product-features',
      num: 3,
      title: 'Product Features',
      kicker: 'Section 03 · Needs into Features',
      weeks: 'Week 16',
      tagline: 'Translate needs into what the product actually does — then decide what matters most.',
      xp: 100,
      artifactLabel: 'YOUR FEATURE LIST',
      steps: [
        {
          id: 'video-features',
          type: 'video',
          title: 'How small should v1 be?',
          prompt: 'Watch: Michael Seibel on the lean MVP — how few features a first version really needs. Next step unlocks when it finishes.',
          video: { youtubeId: '1hHMwLxN6EM', start: 268, end: 345 },
          xp: 20,
          videoRecap: [
            'Build it in weeks, not months — sometimes a landing page and a spreadsheet is enough to start.',
            'Extremely limited functionality: serve a SMALL set of initial users and their highest-order problems. Ignore the rest until later.',
            'Keep the big vision in your head — the MVP is just a base to iterate from. It isn\'t special.',
          ],
        },
        {
          id: 'translate-features',
          type: 'exercise',
          title: 'Translate each need into features',
          buildsOn: ['user-needs/top-needs'],
          prompt: 'Your ranked user needs are pinned below. For each one, write 1–2 features that would meet it — one feature per box, formatted as: NEED → FEATURE: what it does (one line). A feature is something a user could see or touch — be concrete enough that a builder could start.',
          listAnswer: { min: 3, max: 8, itemLabel: 'Feature', placeholder: '[need] → [feature name]: [what the user sees it do]' },
          xp: 30,
          lessonPanel: {
            point: 'Every feature must <b>point back at a need</b> — a feature with no need behind it is decoration. And "AI" is not a feature; "snap a photo of the signup sheet and it fills in the board" is.',
            good: 'Need: know which volunteer shifts are uncovered → Feature: live signup board — one link, every shift, who\'s on it, what\'s still empty.',
            bad: 'Feature: AI integration. <em>(what does the user actually see happen?)</em>',
          },
          rubric: `- Every top user need from their prior work has at least one feature mapped to it
- It's clear which need each feature is meant to serve
- Each feature is concrete (a user-visible behavior, not a technology name or buzzword)
- No orphan features that answer no stated need`,
        },
        {
          id: 'video-famous-mvps',
          type: 'video',
          title: 'What billion-dollar v1s looked like',
          prompt: 'Before you prioritize, watch what Airbnb, Twitch, and Stripe actually shipped on day one — it\'s less than what\'s on your feature list.',
          video: { youtubeId: '1hHMwLxN6EM', start: 335, end: 512 },
          xp: 20,
          videoRecap: [
            'Airbnb day one: no payments (you handed the host cash in person), no map view, and the only engineer worked part-time.',
            'Twitch day one: one video channel and a chat box. No games, terrible resolution — that\'s the whole product.',
            'Stripe day one: no bank deals, almost no features, and the founders came to your office to integrate it by hand — half desperation, half the best bug-finding trick ever.',
            'All three are billion-dollar companies, and every first version was something most people would call embarrassing — on purpose.',
          ],
        },
        {
          id: 'prioritize',
          type: 'exercise',
          title: 'Prioritize: must / should / could',
          buildsOn: ['product-features/translate-features'],
          prompt: 'Sort your features (pinned below) into the three columns — one feature per card. Justify each MUST on its card in one line using value, feasibility, or uniqueness. Rule: 3 MUSTs maximum.',
          board: {
            columns: [
              { id: 'must', label: 'Must', hint: 'v1 dies without it', placeholder: '[feature]: [why — value, feasibility, or uniqueness]', min: 1, max: 3 },
              { id: 'should', label: 'Should', hint: 'important, survivable', placeholder: '[feature]' },
              { id: 'could', label: 'Could', hint: 'later', placeholder: '[feature]' },
            ],
          },
          boardNote: 'every feature in exactly one column · 3 MUSTs max',
          xp: 30,
          lessonPanel: {
            point: 'Everything can\'t be a MUST — that\'s the whole exercise. Judge on: <b>value</b> (how hard does it hit need #1?), <b>feasibility</b> (can YOU build it this year?), <b>uniqueness</b> (does anything else already do this?). Cutting a good feature is not failure; it\'s focus.',
            good: 'MUST — live signup board (value: kills the who\'s-covering-Friday panic; feasible: it\'s a list). COULD — automatic reminder texts (cool, but v2).',
            bad: 'Everything is a MUST because it all matters. <em>(then nothing is)</em>',
          },
          rubric: `- Every feature from the previous step appears in exactly one bucket (MUST/SHOULD/COULD)
- At most 3 MUSTs
- Each MUST has a one-line justification referencing value, feasibility, or uniqueness
- The MUSTs collectively serve the student's #1 ranked user need`,
        },
        {
          id: 'feature-list',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your feature list',
          prompt: 'Write the final feature list for your product: the MUSTs with what each does and which need it serves, then SHOULDs and COULDs as short lines. A starting draft is assembled from your own words.',
          placeholder: '',
          xp: 20,
          draftWordLimit: 130,
          synthesizesFrom: ['translate-features', 'prioritize'],
          lessonPanel: {
            point: 'This is the artifact a mentor or builder could pick up cold and understand your product from. Clear beats complete: a stranger should be able to read it and say back what your product does.',
            good: 'MUST 1 — Live signup board (serves: see uncovered shifts). One link, every shift, who\'s on it, what\'s empty…',
            bad: 'A really good app with AI features for organization. <em>(a stranger learns nothing)</em>',
          },
          rubric: `- MUSTs listed first, each with what it does + which need it serves
- SHOULD and COULD items present as brief lines
- Consistent with their prioritization step
- Readable cold by someone who hasn't seen the rest of the worksheet`,
        },
      ],
    },

    /* ================================================================
       SECTION 4 · MVP PLAN
       ================================================================ */
    {
      id: 'mvp-plan',
      num: 4,
      title: 'MVP Plan',
      kicker: 'Section 04 · The Plan',
      weeks: 'Weeks 16–17 + winter break',
      tagline: 'One core need, two-to-three core features, a first testable version, and what success looks like.',
      xp: 150,
      artifactLabel: 'YOUR MVP PLAN',
      steps: [
        {
          id: 'video-mvp',
          type: 'video',
          title: 'Launch something bad, quickly',
          prompt: 'Watch: the whole pre-launch playbook in three minutes — and the screwdriver rule for what to fix when your first version doesn\'t land.',
          video: { youtubeId: '1hHMwLxN6EM', start: 100, end: 268 },
          xp: 20,
          videoRecap: [
            '"Launch something bad quickly" — many founders\' journeys end before a single user ever touches the product.',
            'Get feedback on the small version NOW. The "full thing" in your head should stay flexible — it might not be what users want at all.',
            'Hold the problem tightly, hold the customer tightly, hold the solution loosely.',
            'The screwdriver rule: if it doesn\'t work, fix the solution — don\'t hunt for a different problem your solution might fit.',
          ],
        },
        {
          id: 'core-choice',
          type: 'journal',
          title: 'Choose your core',
          buildsOn: ['product-features/feature-list'],
          prompt: 'Your feature list is pinned below. Commit: which ONE user need is your MVP built around, and which 2–3 features (from your MUSTs) make the cut? Also write one line on what you\'re deliberately leaving out — and how that feels.',
          placeholder: 'Core need: …\nFeatures making the cut: …\nDeliberately out: …',
          minLines: 3,
          xp: 15,
          lessonPanel: {
            point: 'An MVP is the <b>smallest thing that tests your riskiest belief</b>. Choosing means losing — writing down what you\'re cutting (and that it stings) is part of the discipline. You can always add it back after real users ask for it.',
            good: 'Core need: know who\'s free before booking. In: shared availability grid + one-tap RSVP. Out: auto-scheduling, which hurts because it\'s the coolest one.',
            bad: 'I\'ll build everything but smaller. <em>(that\'s not choosing, that\'s shrinking)</em>',
          },
        },
        {
          id: 'video-launch',
          type: 'video',
          title: 'Nobody remembers launch day',
          prompt: 'Watch: why "launching" isn\'t what you think it is — and what actually counts.',
          video: { youtubeId: '1hHMwLxN6EM', start: 575, end: 690 },
          xp: 20,
          videoRecap: [
            'Do you remember the day Google launched? Facebook? Twitter? Nobody does — launches aren\'t special.',
            'Redefine it: "launch" = the day ANY customer can use your thing. Push the press-and-buzz version way off; pull the get-any-customers version way in.',
            'You can talk to users all day, but until something is in front of them, you have no idea whether it works.',
            'Time spent polishing a pitch deck is worth less than time spent building anything you can hand to a customer.',
          ],
        },
        {
          id: 'video-test',
          type: 'video',
          title: 'Watch a real usability test',
          prompt: 'Watch a REAL test happen, start to finish: Steve Krug (the guy who wrote the book on usability) hands a stranger a task on a real website and then — this is the skill — barely says anything. You\'ll run this exact protocol on your first version, and it works on a paper sketch or clickable mockup before anything is built.',
          video: { youtubeId: '1UCDUOB_aS8', start: 489, end: 786 },
          xp: 20,
          videoRecap: [
            'Give a realistic GOAL, not directions: "you need a car 3 hours a week — figure out what this would cost you each month." Then get out of the way.',
            'Ask them to think out loud, and keep your mouth shut — Krug\'s only interjections are neutral probes like "what would that be like?"',
            'The stumbles ARE the bug list: she wants a cost calculator instead of doing mental math, and hits "EVP $50 — I have no idea what that means."',
            'Notice what he never does: no explaining, no defending, no helping. In real life you won\'t be standing next to your users.',
          ],
        },
        {
          id: 'testable-version',
          type: 'exercise',
          title: 'First testable version + success',
          buildsOn: ['mvp-plan/core-choice'],
          resources: [{ title: 'Paul Graham — Do Things That Don\'t Scale', url: 'https://paulgraham.com/ds.html', note: 'Why hand-delivering your first version to a few real people beats automating for imaginary ones.' }],
          prompt: 'Starting from your core (pinned below), describe: (1) the very first version a real person could try — what do they literally do with it on day one? (2) WHO those first testers are — real, reachable people. (3) What SUCCESS looks like after 2 weeks, as something you could measure or observe.',
          placeholder: 'Day one: [who] opens [the thing] and [does what], in [how long]…\nTesters: …\nSuccess after 2 weeks: …',
          xp: 30,
          lessonPanel: {
            point: 'A testable version is one a stranger can use <b>without you standing next to them</b>. Success must be checkable: "3 of 5 captains still using it in week 2" is a result; "people like it" is a hope.',
            good: 'Testers: the 4 dog walkers I interviewed. Success: at least 3 still logging walks in week 2 without reminders, and zero double-booked afternoons.',
            bad: 'Success is when the app is popular. <em>(how would you know on a Tuesday?)</em>',
          },
          rubric: `- Describes a concrete day-one user action (what a tester literally does)
- Names specific, reachable first testers (people the student can actually get)
- Defines success as something measurable or directly observable within ~2 weeks
- Scope is consistent with their chosen core features (no scope creep back in)`,
        },
        {
          id: 'final-plan',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your MVP plan',
          resources: [
            { title: 'People Skills — Telling It As A Story', url: '#/w/people-skills/s/story-telling', note: 'Before you present this plan: the structure behind persuasive talks, and why the audience is the protagonist rather than you.' },
            { title: 'People Skills — Slide Design', url: '#/w/people-skills/s/slide-design', note: 'Three rules that improve most decks, and a theme you decide once and then reuse.' },
          ],
          prompt: 'Write the plan you\'ll present and build next semester: the problem (one line), the user, the core need, the 2–3 core features, the first testable version, your first testers, and what success looks like. A starting draft is assembled from everything you\'ve written.',
          placeholder: '',
          xp: 35,
          draftWordLimit: 160,
          synthesizesFrom: ['core-choice', 'testable-version'],
          lessonPanel: {
            point: 'This is the whole semester on one card — problem to plan. It\'s what you present publicly, what your mentor pressure-tests, and what you start building over winter break. Every line should trace back to something real: a journal entry, an interview, a ranked need.',
            good: 'Problem: stage crews lose ~6 props a show to untracked handoffs… User: … Core need: … Features: … First version: … Testers: … Success: … — each one line, each traceable to earlier work.',
            bad: 'I\'m going to build an app and see how it goes. <em>(four months of work deserves better than this sentence)</em>',
          },
          rubric: `- Contains all seven parts: problem, user, core need, core features (2-3), first testable version, first testers, success definition
- Every part is consistent with the student's earlier artifacts (problem statement, top needs, feature list)
- Concrete enough that a mentor could pressure-test it without asking clarifying questions
- Fits in roughly 160 words or fewer — tight is the point`,
        },
      ],
    },
  ],
};

/* ==================================================================
   WORKSHEET 2 · WORK WITH AI
   Curriculum: W4 (when to use AI, context & the email assistant),
   W5 (specs — AI builds what you describe), W7/W11 (AI-coding traps
   + the pre-publish security checklist).
   ================================================================== */

const AI_WORKSHEET = {
  id: 'ai',
  title: 'Work With AI',
  subtitle: 'Learn when to reach for AI, how to feed it your world, and how to ship what it builds without getting burned.',
  sections: [

    /* ================================================================
       SECTION 1 · WHEN TO USE AI
       ================================================================ */
    {
      id: 'ai-judgment',
      num: 1,
      title: 'When to Use AI',
      kicker: 'Section 01 · Judgment',
      weeks: 'Week 4',
      tagline: 'Figure out when AI makes you faster — and when it quietly makes you worse.',
      xp: 100,
      artifactLabel: 'YOUR AI RULES',
      steps: [
        {
          id: 'video-when-ai',
          type: 'video',
          title: 'What the machine is actually doing',
          prompt: 'Watch: what an AI model actually does when it answers you — and why it can invent a fake ISBN number with total confidence. Next step unlocks when it finishes.',
          video: { youtubeId: 'zjkBMFhNj_g', start: 405, end: 678 },
          xp: 20,
          videoRecap: [
            'An LLM predicts the next word — it\'s a lossy compression of the internet, not a database of facts.',
            'Left to run, it "dreams" plausible-looking documents — including an ISBN number that almost certainly doesn\'t exist.',
            'Some of what it says is remembered, some is invented — and "you\'re never 100% sure which is which."',
          ],
        },
        {
          id: 'ai-scoreboard',
          type: 'board',
          title: 'The scoreboard: Artificial vs. Actual Intelligence',
          prompt: 'Keep score from today on. Every time AI genuinely nails something for you — in class or at home — add a card to ARTIFICIAL INTELLIGENCE. Every time it flops, invents something, or needs a human to step in and fix it, that\'s a point for ACTUAL INTELLIGENCE. Start with one real moment per side (the review feedback you\'ve gotten in these worksheets counts), and keep adding cards all semester — your AI rules at the end of this section are built from this board.',
          board: {
            left:  { label: 'Artificial Intelligence', hint: 'AI nailed it', placeholder: 'What you asked for + why the result was genuinely good…' },
            right: { label: 'Actual Intelligence', hint: 'a human had to step in', placeholder: 'Where it flopped, made something up, or needed your fix…' },
          },
          minPerSide: 1,
          xp: 15,
          lessonPanel: {
            point: 'This board is <b>evidence, not vibes</b>. One specific card ("it invented a source that doesn\'t exist") is worth ten "AI is kinda unreliable" opinions. Come back and add a card the moment something happens — future-you writing the AI rules will thank you.',
            good: 'ACTUAL: asked it to check my interview questions — it praised a leading question the class red-team caught in 10 seconds.',
            bad: 'AI is useful sometimes and bad sometimes. <em>(that\'s a shrug, not a scoreboard entry — what happened?)</em>',
          },
        },
        {
          id: 'video-how-trained',
          type: 'video',
          resources: [{ title: 'Stephen Wolfram — What Is ChatGPT Doing… and Why Does It Work?', url: 'https://writings.stephenwolfram.com/2023/02/what-is-chatgpt-doing-and-why-does-it-work/', note: 'The definitive deep-dive if this video hooked you — long, but the first third alone is worth it.' }],
          title: 'Why it acts like a helpful assistant',
          prompt: 'Watch: how a raw internet-predictor becomes the polite assistant you chat with — it\'s imitating people who were hired to write ideal answers.',
          video: { youtubeId: 'zjkBMFhNj_g', start: 870, end: 1010 },
          xp: 20,
          videoRecap: [
            'A raw model just generates internet-like documents. To make an assistant, companies swap the training data for ~100,000 human-written Q&A conversations.',
            'Hired labelers write the "ideal response" to each question, following instruction documents written by the company\'s engineers.',
            'So when it answers you, it\'s imitating what a hired human was told an ideal answer looks like — quality over quantity, form over truth.',
          ],
        },
        {
          id: 'sort-tasks',
          type: 'exercise',
          title: 'Sort your week: AI or not?',
          prompt: 'Take SIX real tasks from your week — school, club, home, anything — and drop each one into the column that matches your call. Every card needs the task AND why it belongs there, in a few words. The why is what gets reviewed.',
          board: {
            columns: [
              { id: 'full', label: 'Hand it to AI', hint: 'it does the whole thing', placeholder: '[task] — why: …' },
              { id: 'helper', label: 'AI as helper', hint: 'it assists, you drive', placeholder: '[task] — why: …' },
              { id: 'keepout', label: 'Keep AI out', hint: 'doing it yourself is the point', placeholder: '[task] — why: …', min: 1 },
            ],
          },
          minTotal: 6,
          boardNote: 'six tasks total · at least one KEEP AI OUT',
          xp: 30,
          lessonPanel: {
            point: 'The call depends on three things: <b>can you check the output</b> (if you can\'t verify it, don\'t outsource it), <b>what happens if it\'s wrong</b> (stakes), and <b>whether doing it yourself is the point</b> (practice you skip is skill you don\'t build).',
            good: 'Study-guide summary — HELPER: it summarizes, but I write the questions myself because guessing what gets asked is the actual studying.',
            bad: 'Essay — AI, because it\'s faster. <em>(faster at what? if the essay is graded on YOUR thinking, you just outsourced the point)</em>',
          },
          rubric: `- SIX real, specific tasks from the student's actual week (not invented generic ones)
- Every task has an explicit call: full AI, helper, or no AI
- Each reason references checkability, stakes, or learning value — not just speed or convenience
- At least one task is KEEP AI OUT with an honest reason
- The calls are consistent with each other (no contradictory logic between similar tasks)`,
        },
        {
          id: 'video-jagged',
          type: 'video',
          title: 'Superpowers and blind spots',
          prompt: 'AI is superhuman at some things and fails at things no human would. Your rules should respect both sides.',
          video: { youtubeId: 'LCEmiRjPEtQ', start: 955, end: 1090 },
          xp: 20,
          videoRecap: [
            '"Jagged intelligence": superhuman on some problems — then insists 9.11 is greater than 9.9.',
            'It has no memory between chats — like a coworker whose memory wipes every morning. Expertise never accumulates on its own.',
            'It\'s gullible: prompt injection can trick it into leaking or lying. Superpowers and deficits, at the same time.',
          ],
        },
        {
          id: 'video-search',
          type: 'video',
          title: 'What it can\'t know (and how it finds out)',
          prompt: 'Watch: the model\'s knowledge froze months ago — here\'s how search tools fill the gap, and why that changes what you can trust.',
          video: { youtubeId: 'EWvNQjAaOHw', start: 1980, end: 2085 },
          xp: 20,
          videoRecap: [
            'The model was trained months ago — anything decided since then simply isn\'t in it. Recent events, schedules, prices: no chance without help.',
            'Search tools fix this by fetching web pages and pasting their text into the context window — then the model answers from those pages, like you would.',
            'Rule of thumb: for anything fresh or checkable, use a search-enabled mode (or paste the source yourself) instead of trusting the model\'s frozen memory.',
          ],
        },
        {
          id: 'video-thinking',
          type: 'video',
          title: 'Fast mode vs. thinking mode',
          prompt: 'One more tool for your rules: some models "think" before answering. Knowing when that\'s worth the wait is part of using AI well.',
          video: { youtubeId: 'EWvNQjAaOHw', start: 1775, end: 1855 },
          xp: 20,
          videoRecap: [
            'Thinking models shine on hard problems — math, code, tricky logic — where extra reasoning buys real accuracy.',
            'For everyday questions they\'re a waste: don\'t wait a minute for travel suggestions.',
            'The pro move: start with the fast model; when an answer smells weak, escalate to thinking mode and compare.',
          ],
        },
        {
          id: 'ai-rules',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your AI rules',
          prompt: 'Write your personal AI rules: 3–5 rules for when you reach for AI and when you don\'t. Each rule must trace back to something that actually happened — a card from your scoreboard or a call from your sort. A starting draft is assembled from your own work; edit each rule until it\'s yours.',
          placeholder: '',
          xp: 35,
          draftWordLimit: 90,
          listAnswer: { min: 3, max: 5, itemLabel: 'Rule', placeholder: 'If [situation], I [do / don\'t]… — because of [what happened]' },
          synthesizesFrom: ['ai-scoreboard', 'sort-tasks'],
          lessonPanel: {
            point: 'Rules you copied from a poster don\'t survive contact with a deadline. Rules that came from <b>your own flops</b> do. Each rule should be concrete enough that on a busy Tuesday you\'d know instantly whether you\'re breaking it.',
            good: 'If a teacher will grade it as MY voice, AI never writes sentences — it only critiques mine. (Learned from the book-report incident.)',
            bad: 'Use AI responsibly. <em>(what would you actually DO differently on Tuesday?)</em>',
          },
          rubric: `- 3 to 5 short, clear rules
- Each rule is actionable — a specific behavior, not a value statement
- At least one rule says when NOT to use AI
- Rules visibly connect to the student's own logged moments or task calls
- No rule contradicts another`,
        },
      ],
    },

    /* ================================================================
       SECTION 2 · CONTEXT IS EVERYTHING
       ================================================================ */
    {
      id: 'ai-context',
      num: 2,
      title: 'Context Is Everything',
      kicker: 'Section 02 · Context & Examples',
      weeks: 'Week 4 + home',
      tagline: 'AI doesn\'t know your world. Feed it context and examples until it sounds like you.',
      xp: 120,
      artifactLabel: 'YOUR EMAIL ASSISTANT PROMPT',
      steps: [
        {
          id: 'voice-samples',
          type: 'journal',
          title: 'Collect your voice samples',
          prompt: 'Paste 2–3 real messages you\'ve actually sent — emails or messages to a teacher, coach, or club (nothing private or embarrassing). These are the raw material: how you ACTUALLY write, not how you think you write.',
          placeholder: 'Hi Ms. Rivera — quick question about the lab report…',
          minLines: 5,
          xp: 15,
          lessonPanel: {
            point: 'Real samples beat self-description every time. You think you write "casual but polite" — the samples show you start every email with "quick question", never use exclamation marks, and sign off with just your first initial. <b>That\'s</b> the voice.',
            good: 'Three real emails, pasted as sent — typos, greetings, sign-offs and all.',
            bad: 'I write in a friendly but professional tone. <em>(that\'s a description, not a sample — the AI needs the real thing)</em>',
          },
        },
        {
          id: 'video-context',
          type: 'video',
          title: 'The model only knows what you show it',
          prompt: 'Watch: the context window is the model\'s entire working memory — and it starts empty every single chat. Next step unlocks when it finishes.',
          video: { youtubeId: 'EWvNQjAaOHw', start: 985, end: 1085 },
          xp: 20,
          videoRecap: [
            'Starting a new chat wipes the context window to zero — the model knows nothing about you it can\'t see right now.',
            'The context window is the model\'s working memory: what you put in it is its entire world.',
            'It\'s a precious resource — load it with relevant context, keep the clutter out.',
          ],
        },
        {
          id: 'naive-prompt',
          type: 'exercise',
          title: 'The instructions-only attempt',
          prompt: 'Write the prompt you\'d give an AI to draft emails as you — using ONLY instructions and adjectives, no examples (that\'s the next step). Then add one line: PREDICTION — where you think it will still sound generic or wrong.',
          placeholder: 'You are my email assistant. Write short, polite emails that…\n\nPREDICTION: …',
          xp: 30,
          lessonPanel: {
            point: 'This attempt is <b>supposed to be weak</b> — that\'s the experiment. Instructions-only prompts produce emails that could be from anyone. Predicting exactly HOW yours will miss is what makes the next step land.',
            good: 'PREDICTION: it\'ll open with "I hope this email finds you well," which I have never once said.',
            bad: 'PREDICTION: it might not be perfect. <em>(name the actual miss — greeting? length? tone? sign-off?)</em>',
          },
          rubric: `- Contains an actual, usable instructions-only prompt (role + what to write), with NO pasted examples
- Includes a PREDICTION line
- The prediction names a specific expected failure (greeting, tone, length, word choice, sign-off) — not a vague "might be off"
- The prompt's instructions are ones the student could defend as true about their writing`,
        },
        {
          id: 'video-examples',
          type: 'video',
          title: 'Feed it the real thing',
          prompt: 'Watch: why experienced users hand the model concrete documents instead of descriptions — exactly what you\'re about to do with your own emails.',
          video: { youtubeId: 'EWvNQjAaOHw', start: 3057, end: 3165 },
          xp: 20,
          videoRecap: [
            'The model\'s built-in knowledge is "hazy" — concrete documents in the context window beat it every time.',
            'Paste or upload the real thing, and the model works from YOUR material instead of internet averages.',
            'Your voice samples are exactly this: concrete documents that replace the model\'s guessing with evidence.',
          ],
        },
        {
          id: 'context-prompt',
          type: 'exercise',
          reviewerNote: 'Before judging, TEST the student\'s prompt: role-play being the email assistant their prompt describes, and draft one short sample email (pick a realistic scenario from their world using their prior work — a teacher, coach, or club contact). Follow ONLY their prompt. Show the drafted email in your feedback, THEN break character and judge: does the draft plausibly sound like the student\'s pasted voice samples, and did their added context/examples fix the failure they predicted in the previous step? Pass only if the prompt includes who they are, who they write to, at least two real voice samples, and concrete do/don\'t rules drawn from those samples.',
          title: 'The context-loaded upgrade',
          buildsOn: ['ai-context/voice-samples', 'ai-context/naive-prompt'],
          resources: [{ title: 'Anthropic — Prompt engineering overview', url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview', note: 'The official playbook — notice how much of it is "give the model context and examples."' }],
          prompt: 'Now rebuild the prompt with real context: WHO you are, WHO you usually write to, your voice samples (pinned below) pasted in as examples, and 2–3 DO/DON\'T rules you noticed in those samples. Fix the failure you predicted in your instructions-only attempt (also pinned). The AI will test-drive your prompt by drafting an email with it — see if it sounds like you.',
          placeholder: 'You draft emails for me. About me: [who you are, one line]…\nI usually write to: …\nHere are real emails I\'ve sent: …\nDO: … DON\'T: …',
          xp: 35,
          masteryHint: 'Skippable if the student\'s earlier prompt work already includes identity context, audience, 2+ real writing samples, and sample-derived do/don\'t rules.',
          lessonPanel: {
            point: 'This is the whole lesson in one step: <b>AI needs your context and examples, not just commands</b>. The do/don\'t rules should come from evidence — things you can point to in your own samples — not from how you\'d like to sound.',
            good: 'DON\'T use exclamation marks (check my samples: zero). DO open with the actual question by sentence two — all three of my emails do.',
            bad: 'DO sound like me. <em>(the AI is holding your samples asking "which parts ARE you?")</em>',
          },
          rubric: `- Includes who the student is and who they typically write to
- Contains at least TWO real voice samples pasted as examples
- Has 2-3 DO/DON'T rules that are visibly derived from the samples (not aspirational)
- Addresses the specific failure the student predicted in their instructions-only attempt
- Self-contained: an AI with ONLY this prompt could plausibly draft in their voice`,
        },
        {
          id: 'assistant-prompt',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your email assistant prompt',
          resources: [{ title: 'Turn it into a real custom GPT', url: 'https://chatgpt.com/gpts/mine', note: 'Hit "Create a GPT", paste your finished prompt into the Instructions box, and your email assistant becomes a real tool in your ChatGPT sidebar.' }],
          prompt: 'Finalize the prompt you\'ll actually reuse: identity, audience, voice samples, do/don\'t rules — everything an AI needs to draft as you, in one self-contained block. A starting draft is assembled from your work — trim anything that doesn\'t earn its place. Once it\'s accepted, make it permanent: create a custom GPT (link below) and paste this in as its instructions.',
          placeholder: '',
          xp: 35,
          draftWordLimit: 160,
          synthesizesFrom: ['voice-samples', 'naive-prompt', 'context-prompt'],
          lessonPanel: {
            point: 'This is a <b>reusable tool</b>, not homework — you\'ll paste it into any AI whenever you need an email drafted. The test of a good one: a brand-new AI chat with only this prompt produces something your teacher would believe you wrote.',
            good: 'A tight block: who I am → who I write to → 2 pasted samples → 3 do/don\'ts → "draft, then ask me one question if context is missing."',
            bad: 'A wall of every instruction imaginable. <em>(bloat buries the voice — trim until every line earns its place)</em>',
          },
          rubric: `- One self-contained prompt: identity, audience, 2+ voice samples, and do/don't rules
- Rules trace to evidence in the samples
- No redundant or contradictory instructions
- Short enough to actually reuse (roughly 160 words or fewer outside the samples)`,
        },
      ],
    },

    /* ================================================================
       SECTION 3 · SAY WHAT YOU MEAN (SPECS)
       ================================================================ */
    {
      id: 'ai-specs',
      num: 3,
      title: 'Say What You Mean',
      kicker: 'Section 03 · Specs',
      weeks: 'Weeks 5–6',
      tagline: 'AI builds what you describe, not what you mean. The spec is the skill.',
      xp: 120,
      artifactLabel: 'YOUR BUILD SPEC',
      steps: [
        {
          id: 'video-everyone',
          type: 'video',
          title: 'Everyone is a programmer now',
          prompt: 'Watch this first: why you — right now, at your age, in English — can build real software.',
          video: { youtubeId: 'LCEmiRjPEtQ', start: 1741, end: 1890 },
          xp: 20,
          videoRecap: [
            'Software used to take 5–10 years of study before you could build anything. Not anymore: the programming language is English.',
            'Karpathy\'s favorite video is literally kids vibe-coding — "a gateway drug to software development."',
            'He built and shipped an iPhone app in a day without knowing Swift. The skill that mattered was describing what he wanted.',
          ],
        },
        {
          id: 'pick-build',
          type: 'journal',
          title: 'Pick something small to build',
          buildsOn: ['problem-statement/final-statement'],
          prompt: 'Pick ONE small, real problem that a tiny app could help with. If you\'ve earned your problem statement in the MVP worksheet, it\'s pinned below — a slice of it makes a great pick, but any real problem from your life works. Describe the app the way you\'d tell a friend, in 2–3 sentences. Don\'t polish it; this is the "before" picture.',
          placeholder: 'An app where [who] can [do the one thing]…',
          minLines: 2,
          xp: 15,
          lessonPanel: {
            point: 'Small is the assignment. This build is <b>practice</b> — how you learn the skill, not your final project. A tool that does ONE thing for people you know beats a platform that does everything for no one.',
            good: 'A page where our whole friend group can vote on tonight\'s movie in 5 seconds and see the tally.',
            bad: 'A social network for students with AI recommendations. <em>(that\'s a company, not a first build)</em>',
          },
        },
        {
          id: 'video-specs',
          type: 'video',
          title: 'Your words are the program',
          prompt: 'Watch: Karpathy on "Software 3.0" — your prompts are now programs, and the programming language is English. Next step unlocks when it finishes.',
          video: { youtubeId: 'LCEmiRjPEtQ', start: 188, end: 270 },
          xp: 20,
          videoRecap: [
            'Prompts are programs: the words you write literally program the computer.',
            'The programming language is English — which means writing clearly IS the technical skill.',
            'Change the words and you change the program. Precision in, precision out.',
          ],
        },
        {
          id: 'video-vibe',
          type: 'video',
          title: 'Catch the AI\'s mistake before the code exists',
          prompt: 'Watch a real Claude Code session: a builder reads the AI\'s written plan for his production app, catches a design mistake before a single line of code exists, and fixes it in writing. That moment is the whole reason your spec matters.',
          video: { youtubeId: 'g6z_4TMDiaE', start: 1112, end: 1360 },
          xp: 20,
          videoRecap: [
            'He reads the AI\'s written PLAN, not its code: "I can already feel or see if this is completely wrong, if I see any red flags."',
            'And he catches one live — the AI planned a heavy pile of separate tools; he pushes back: can\'t one tool handle it?',
            'Why it matters here: "if you already started implementing and you\'re an hour further… it\'s harder to take a step back." Mistakes are cheap at the plan stage, expensive after.',
            'Then he writes the correction into the AI\'s standing rules so it "ideally never makes this mistake anymore" — catch it, then write it down.',
          ],
        },
        {
          id: 'video-spec-hacks',
          type: 'video',
          title: 'Spec discipline: timebox, write, cut',
          prompt: 'Before you write your spec, watch the three habits that keep a three-week build from becoming a three-month one.',
          video: { youtubeId: '1hHMwLxN6EM', start: 686, end: 785 },
          xp: 20,
          videoRecap: [
            'Timebox the spec: "what can I build in three weeks?" — anything that doesn\'t fit gets removed for you.',
            'WRITE it down. If it\'s not written, you\'ll change what you\'re building every time someone comments — and never notice you did.',
            'A week in, you\'ll realize you added too much. Cut the unimportant stuff; if it\'s all important, cut important stuff.',
            'Don\'t fall in love with the version in your head — getting ANYTHING into the world creates the momentum that keeps you going.',
          ],
        },
        {
          id: 'write-spec',
          type: 'exercise',
          isArtifact: true,
          reviewerNote: 'Before judging, ROLE-PLAY a fast, literal-minded AI coding agent given this spec. In your feedback, briefly restate what you would build following ONLY what is written — and flag every place you had to guess because the spec didn\'t say (one short line per guess, e.g. "- You didn\'t say what happens after submit, so I guessed a blank page"). THEN break character and judge. IMPORTANT: if the underlying idea is too big to spec (a platform, a company, months of work), do NOT ask for more detail — say it\'s too big and coach them to slice out one small piece worth building first. Pass only when the spec names the user, 2-3 concrete actions with visible outcomes, and verifiable "done when" checks, with no vague adjectives standing in for behavior and no guess left open.',
          title: 'Your build spec',
          buildsOn: ['ai-specs/pick-build'],
          resources: [
            { title: 'How I AI — A 3-step AI coding workflow (Ryan Carson)', url: 'https://www.youtube.com/watch?v=fD4ktSkNCw4', note: 'Watch a 5-time founder write a real spec and task list on screen, then hand it to an AI that builds it — slowing down to write clearly is what makes the AI fast.' },
            { title: 'AI Coding — Specifications as the Source of Truth', url: '#/w/pro-coding/s/spec-truth', note: 'Why the specification, not the generated code, is the artifact worth keeping.' },
            { title: 'AI Coding — Planning and Reviewing', url: '#/w/pro-coding/s/agent-driving', note: 'Once the spec is written: how experienced developers plan a change, then review what the agent produced.' },
          ],
          prompt: 'Turn your idea (pinned below) into the spec you\'d hand an AI coding tool: WHO uses it, the 2–3 things they can DO, what visibly HAPPENS for each action, and DONE WHEN — two or three checks a stranger could verify. The AI will play a literal-minded builder and build EXACTLY what you wrote — every gap becomes a guess. Revise until no guess is left, because this is the artifact: the spec you\'ll actually build from.',
          placeholder: 'WHO: [your users]…\nDO: [action + what they enter]…\nHAPPENS: [what visibly changes]…\nDONE WHEN: [a check a stranger could verify]…',
          xp: 35,
          lessonPanel: {
            point: 'Vague words are where builds die. "Easy to use" and "clean design" mean nothing to a builder — <b>"add an order in under 10 seconds from a phone"</b> means everything. If a stranger couldn\'t check it, it\'s not a spec line, it\'s a wish. And if the idea won\'t fit in a spec this size, the idea is too big — slice it.',
            good: 'DONE WHEN: opening the link on a phone shows tonight\'s options in under 2 seconds, and voting takes 2 taps or fewer.',
            bad: 'The app should be simple and work well. <em>(the builder just guessed twelve things — enjoy the surprise)</em>',
          },
          rubric: `- Names WHO uses it (specific people, not "users")
- Lists 2-3 actions, each with a visible outcome (what the user sees happen)
- Has 2-3 DONE WHEN checks a stranger could verify without asking the student anything
- No vague adjectives doing load-bearing work ("easy", "simple", "clean", "nice")
- Small enough to build in weeks — if the idea is fundamentally too big, the right feedback is to slice it down, not to add detail
- No guess from the builder role-play left unanswered`,
        },
      ],
    },

    /* ================================================================
       SECTION 4 · SHIP IT SAFELY
       ================================================================ */
    {
      id: 'ai-shipping',
      num: 4,
      title: 'Ship It Safely',
      kicker: 'Section 04 · Safe Shipping',
      weeks: 'Weeks 7 & 11',
      tagline: 'Catch the classic AI-coding traps before real people touch what you built.',
      xp: 110,
      artifactLabel: 'YOUR PRE-PUBLISH CHECKLIST',
      steps: [
        {
          id: 'video-autonomy',
          type: 'video',
          title: 'The modern build loop: prototype three, build one',
          prompt: 'Watch how builders actually work now: coding stopped being the slow part, so the skill moved upstream — YOU come up with the idea from user needs, knock out cheap throwaway prototypes to see it, test with real humans, and only then build it for real.',
          video: { youtubeId: 'wc8FBhQtdsA', start: 1246, end: 1442 },
          xp: 20,
          videoRecap: [
            'The bottleneck moved: a spec that took an engineering team 3 weeks now takes a coding agent ~3 hours — so deciding WHAT to build is the hard part again.',
            '"Your initial ideas are always wrong. What matters is proving them" — prototypes are how you find out fast.',
            'A UI prototype is basically free now — so for any feature, prototype THREE different ways it could work and compare, then throw two away.',
            'Validation still means real humans: someone on a screen-share actually using it beats any AI pretending to click around.',
          ],
        },
        {
          id: 'video-traps',
          type: 'video',
          title: 'Keep the AI on the leash',
          prompt: 'Watch: how experienced builders work with AI coding agents — you verify everything, and vague prompts make you spin in circles. Next step unlocks when it finishes.',
          video: { youtubeId: 'LCEmiRjPEtQ', start: 1333, end: 1495 },
          xp: 20,
          videoRecap: [
            'The loop is: AI generates, YOU verify — and you\'re the bottleneck, so make verifying fast.',
            'A 10,000-line AI diff is useless if you can\'t check it for bugs and security issues. Work in small chunks you can actually read.',
            'Keep the AI on the leash — over-eager agents create work instead of doing it.',
            'Vague prompt → failed verification → spinning in circles. Being concrete the first time saves the whole round trip.',
          ],
        },
        {
          id: 'spot-traps',
          type: 'exercise',
          title: 'Spot the traps in YOUR build',
          buildsOn: ['ai-specs/write-spec'],
          resources: [{ title: 'OWASP Top 10 for LLM Applications', url: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/', note: 'The professional checklist of ways AI apps get attacked — see how many map to your traps.' }],
          prompt: 'Your build spec is pinned below. Which THREE of the classic traps — made-up APIs, shipping code you never read, insecure defaults (exposed keys, trusting user input, no auth), over-building — is YOUR project most likely to hit? One per box: where exactly it would bite, and the specific check that would catch it.',
          listAnswer: { min: 3, max: 3, itemLabel: 'Trap', placeholder: '[trap] — bites: [where exactly in YOUR app]. Catch: [the check that would catch it]' },
          xp: 30,
          lessonPanel: {
            point: 'Generic warnings don\'t stick; <b>your app\'s specific failure</b> does. "Validate input" is a poster. "The add-order box will eat a 5,000-character prank message unless I cap it" is a plan.',
            good: 'Over-building: I\'ll be tempted to add accounts. Catch: v1 rule — if the feature isn\'t in my DONE WHEN list, it doesn\'t ship.',
            bad: 'Security is important so I\'ll be careful. <em>(careful about WHAT, checked HOW?)</em>',
          },
          rubric: `- Names THREE traps and ties each to a specific place in the student's own spec/app
- Each trap has a concrete catch: an action or check, not an intention
- At least one addresses keys, user input, or auth specifically
- The scenarios are plausible for their actual app (not copied generic examples)`,
        },
        {
          id: 'video-injection',
          type: 'video',
          resources: [{ title: 'Simon Willison — Prompt injection series', url: 'https://simonwillison.net/series/prompt-injection/', note: 'The researcher who named the attack, tracking every new variant since 2022.' }],
          title: 'The invisible attack',
          prompt: 'One more before your checklist: watch how attackers hide instructions your AI will follow — in places you can\'t even see.',
          video: { youtubeId: 'zjkBMFhNj_g', start: 3092, end: 3270 },
          xp: 20,
          videoRecap: [
            'Prompt injection: hiding new instructions inside content the AI reads — faint white text in an image made ChatGPT advertise a Sephora sale.',
            'A booby-trapped web page made Bing insert a fraud link into an innocent answer about movies.',
            'A shared Google Doc hijacked the AI reading it and tried to steal personal data.',
            'Lesson for your checklist: anything your app lets an AI read — pages, docs, user input — is a door someone can knock on.',
          ],
        },
        {
          id: 'video-ironman',
          type: 'video',
          title: 'Build Iron Man suits, not Iron Man robots',
          prompt: 'The closing idea for this whole worksheet: the best AI products keep a human in the driver\'s seat — on purpose.',
          video: { youtubeId: 'LCEmiRjPEtQ', start: 1666, end: 1740 },
          xp: 20,
          videoRecap: [
            'The Iron Man suit is both an augmentation Tony Stark drives AND an autonomous agent — the autonomy slider, embodied.',
            'With today\'s fallible models, build suits, not robots: partial autonomy with a human verifying fast — not flashy autonomous demos.',
            'Design so the human\'s generate-and-verify loop is fast, and slide toward autonomy only as the system earns it.',
          ],
        },
        {
          id: 'publish-checklist',
          type: 'synthesis',
          isArtifact: true,
          title: 'Your pre-publish checklist',
          prompt: 'Write your personal pre-publish checklist: 5–8 checks you\'ll run before ANYTHING you build goes live. Each one binary — done or not done — and concrete enough that future-you can\'t weasel out. A starting draft is assembled from your trap analysis; sharpen every check.',
          placeholder: '',
          xp: 35,
          draftWordLimit: 120,
          listAnswer: { min: 5, max: 8, itemLabel: 'Check', placeholder: 'Something binary — done or not done…' },
          synthesizesFrom: ['spot-traps'],
          lessonPanel: {
            point: 'This checklist is what you\'ll run before publishing your practice app — and your real MVP later. Checks must be binary: <b>"I read every file I\'m shipping"</b> is checkable. "Be careful with security" is a mood.',
            good: '□ No keys or passwords anywhere in the code (searched for "key", "secret", "password"). □ Every input field has a max length and rejects HTML.',
            bad: '□ Make sure the app is safe. <em>(how would you ever check this box honestly?)</em>',
          },
          rubric: `- 5 to 8 checks, each phrased so it's binary (done / not done)
- Covers at minimum: secrets/keys, user input, and can-I-explain-every-part
- At least two checks visibly come from the student's own spotted traps
- No vague entries ("be careful", "test it well")`,
        },
      ],
    },
  ],
};

/* ==================================================================
   MVP WORKSHEET · SECTION 5 — SHIP IT (one-time setup walkthrough, W7–8)
   Guided checklist, no AI review: GitHub → Codex → Vercel → live URL.
   `guide` items may contain trusted inline HTML (links, <code>, <em>).
   alwaysUnlocked: needed in class around W7–8, long before Section 4
   finishes — no content dependency on the plan, so it never locks.
   ================================================================== */

const SHIP_SECTION = {
      id: 'go-live',
      num: 5,
      title: 'Ship It: Zero to Live Link',
      kicker: 'Section 05 · Go Live',
      weeks: 'Any time before Week 8',
      tagline: 'A one-time setup walkthrough — GitHub, Codex, and Vercel. Do it any time; you\'ll need it the week you publish. At the end: a real URL anyone on Earth can open.',
      alwaysUnlocked: true,
      xp: 100,
      artifactLabel: 'YOUR LIVE LINK',
      steps: [
        {
          id: 'github-account',
          type: 'journal',
          title: 'Create your GitHub account',
          prompt: 'GitHub is where your code lives — every tool in this walkthrough plugs into it. Work through the checklist, then paste your new username below.',
          guide: [
            'Go to <a href="https://github.com/signup" target="_blank" rel="noopener">github.com/signup</a> and sign up with your email (or "Continue with Google").',
            'Pick a username you\'d put on a résumé — letters, numbers, and hyphens; the form tells you if it\'s taken.',
            'Verify your email — GitHub sends a code, and <em>you can\'t create a repository until this is done</em>.',
            '<em>Fine print: GitHub requires you to be 13+ — you\'re all clear.</em>',
          ],
          placeholder: 'My GitHub username: …',
          minLines: 1,
          xp: 15,
        },
        {
          id: 'first-repo',
          type: 'journal',
          title: 'Make a repo with a real page in it',
          buildsOn: ['go-live/github-account'],
          prompt: 'A repository ("repo") is a project folder that remembers every change ever made. Create one and put a tiny web page in it, then paste the repo\'s URL below.',
          guide: [
            'Top-right corner of GitHub, hit the <b>+</b> icon → <b>"New repository"</b>.',
            'Name it something like <code>my-first-site</code>, set it to <b>Public</b>, toggle <b>"Add README"</b> on, and click <b>"Create repository"</b>.',
            'In the repo, click <b>"Add file" → "Create new file"</b>. Name it exactly <code>index.html</code>.',
            'Paste this in, then hit <b>"Commit changes"</b>: <code>&lt;h1&gt;Hi, I\'m [your name]&lt;/h1&gt;&lt;p&gt;This page is live on the internet.&lt;/p&gt;</code>',
          ],
          placeholder: 'My repo: https://github.com/[username]/[repo]',
          minLines: 1,
          xp: 20,
        },
        {
          id: 'connect-codex',
          type: 'journal',
          title: 'Connect Codex to your GitHub',
          buildsOn: ['go-live/first-repo'],
          prompt: 'Codex is an AI coding agent that works directly on your repos — you describe the change in English, it writes the code and shows you the diff. Connect it, give it one small task, and log what you asked for below.',
          guide: [
            'Go to <a href="https://chatgpt.com/codex" target="_blank" rel="noopener">chatgpt.com/codex</a> and sign in with your ChatGPT account (the free plan works — usage is just limited).',
            'When prompted, <b>connect your GitHub account</b> — and when it asks which repositories, grant <b>only the repo you just made</b>. Never hand an AI the keys to everything.',
            'Give it a real task in plain English, e.g.: <em>"Add a short bio and a list of three things I\'m building this semester to index.html. Keep the style simple."</em>',
            'When it finishes: <b>read the diff</b> (red = removed, green = added). If it looks right, apply/merge it. You just did the generate-and-verify loop from the AI worksheet.',
            '<em>Fine print: OpenAI\'s terms say under-18s need a parent or guardian\'s permission — sort that first if it applies.</em>',
          ],
          placeholder: 'What I asked Codex to do: …\nOne thing I checked in the diff before accepting: …',
          minLines: 2,
          xp: 25,
        },
        {
          id: 'connect-vercel',
          type: 'journal',
          title: 'Connect Vercel and deploy',
          buildsOn: ['go-live/first-repo'],
          prompt: 'Vercel watches your repo and puts every change live on a real URL, automatically and free. Connect it, deploy, and paste the URL it gives you below.',
          guide: [
            'Go to <a href="https://vercel.com/signup" target="_blank" rel="noopener">vercel.com/signup</a>, choose the <b>Hobby</b> plan (free), and click <b>"Continue with GitHub"</b>.',
            'Heads-up: Vercel verifies a phone number at signup, and its terms require you to be <b>16+</b>. If either blocks you, use the GitHub Pages fallback below instead — same result.',
            'From the dashboard: <b>"Add New…" → "Project"</b>, then <b>"Import"</b> next to your repo (first time, it installs the Vercel app on GitHub — selected repos only is fine).',
            'Leave the detected settings alone and hit <b>Deploy</b>. ~30 seconds later you get <code>your-project.vercel.app</code>.',
            '<b>Fallback — GitHub Pages (no new account):</b> in your repo, <b>Settings → Pages → Source: "Deploy from a branch"</b> → branch <code>main</code>, folder <code>/(root)</code> → Save. Your page appears at <code>[username].github.io/[repo]</code> in a minute or two.',
          ],
          placeholder: 'My deployed URL: …',
          minLines: 1,
          xp: 20,
        },
        {
          id: 'live-link',
          type: 'journal',
          isArtifact: true,
          title: 'Prove the loop: change → live',
          buildsOn: ['go-live/connect-vercel'],
          prompt: 'The whole point of this setup: a change you make becomes live on the internet without you touching anything else. Prove it works end-to-end, then log your live link — this is the URL you\'ll publish your real app to in class.',
          guide: [
            'Ask Codex for one more visible change (a new line, a color, anything) — or edit <code>index.html</code> directly on GitHub.',
            'Merge/commit it to <code>main</code>, then watch: Vercel (or Pages) redeploys on its own within a minute.',
            'Open your URL on your PHONE — if it loads there, it loads anywhere.',
            'Send the link to one person who isn\'t in this room.',
          ],
          placeholder: 'LIVE LINK: https://…\nThe change I shipped to prove it: …\nFirst thing I\'d fix or add next: …',
          minLines: 3,
          xp: 20,
        },
      ],
};

MVP_WORKSHEET.sections.push(SHIP_SECTION);

/* ==================================================================
   EXTRAS · the bonus shelf
   extra:true keeps these out of the artifact count and off the XP
   ledger; freeRoam:true opens every section and step from day one.
   No `xp` on steps or sections here — they earn nothing on purpose.
   ================================================================== */

const AI_CODING_WORKSHEET = {
  id: 'pro-coding',
  title: 'AI Coding',
  extra: true,
  freeRoam: true,
  sections: [

    {
      id: 'agent-driving',
      num: 1,
      title: 'Planning and Reviewing',
      kicker: 'Extra 01 · Agent Workflow',
      weeks: 'Anytime',
      tagline: 'How experienced developers plan a change before any code is written, and how they review what the agent produced.',
      steps: [
        {
          id: 'video-plan-mode',
          type: 'video',
          title: 'Planning before writing code',
          prompt: 'Kieran Klaassen ships production features with Claude Code daily. This segment covers what happens before any code is written — the step most people skip.',
          video: { youtubeId: 'g6z_4TMDiaE', start: 454, end: 637 },
          videoRecap: [
            'His planning step is an expanded version of plan mode. It uses more tokens deliberately, because it researches the problem before writing anything.',
            'It reads the existing codebase first, so it follows the patterns already in use instead of introducing new ones partway through.',
            'It searches the web for best practices on the specific problem, and checks which versions of your libraries you are using so it does not write code for the wrong one.',
            'The research runs as separate sub-agents with their own context windows, which keeps the main conversation focused.',
            'The output is a single artifact: a plan a human reads and approves before work begins.',
          ],
        },
        {
          id: 'video-review-pass',
          type: 'video',
          title: 'Reviewing the agent\'s work',
          prompt: 'Working code is not finished code. This segment covers the review pass he runs after a feature works — and why he approves each fix rather than letting the agent apply them.',
          video: { youtubeId: 'g6z_4TMDiaE', start: 2098, end: 2334 },
          videoRecap: [
            'Once a feature works, he runs a separate review pass looking for three things: security risks, unnecessary code, and anything that could be simpler.',
            'The review uses several reviewer agents with fixed, distinct perspectives — security, architecture, simplicity — rather than one general request to clean things up.',
            'Their findings are combined into one prioritized list, which he approves item by item. Nothing is fixed automatically, because at this stage an agent can easily expand the scope or remove working code.',
            'Findings are ranked P1 (never merge, such as security flaws), P2 (sometimes important), and P3 (nice to have), and written to a to-do folder he can see.',
            'A single command then applies the approved fixes and opens the pull request.',
          ],
        },
        {
          id: 'agent-rules',
          type: 'exercise',
          title: 'Write three rules for your agent',
          prompt: 'A rules file records a mistake so you never have to catch it twice. Write THREE rules you would put in your own agent\'s rules file. Each needs two parts: the rule itself, specific enough that a machine could follow it, and the mistake it came from — something you actually watched an AI do to your work.',
          placeholder: 'RULE: …\nCAME FROM: the time it …\n\nRULE: …\nCAME FROM: …',
          buildsOn: ['ai-judgment/ai-scoreboard'],
          reviewerNote: 'Review these as an engineer who has maintained a rules file for a year. A rule an agent cannot verifiably follow ("write good code", "be careful") does not work — explain why and rewrite one of theirs as an example. Every rule should trace to a failure they actually observed; note any rule that appears to come from theory instead. Their AI scoreboard is the best source of evidence, so point them to it if their examples are generic. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'A rules file is memory for a system that has none. The agent forgets everything between conversations, so each rule you write is a lesson it cannot lose. The test for a rule: <b>could the agent tell whether it followed it?</b> "Be careful with the database" cannot be checked. "Never write a migration that drops a column — propose it and stop" can.',
            good: 'RULE: Before changing any file, list every other file that reads from it and show me the list. CAME FROM: it renamed a function in one file and left three callers broken, which I only found when a page came up blank.',
            bad: 'RULE: Write clean, high-quality code. CAME FROM: sometimes the code is messy. <em>(An agent has no way to check whether it followed this.)</em>',
          },
          rubric: `- Three rules, each specific enough that an agent could verifiably follow or violate it
- Every rule is paired with a CONCRETE mistake actually observed — a real incident, not a hypothetical
- No rule is a vague virtue ("be careful", "write clean code", "don't make mistakes")
- At least one rule constrains the agent's process (stop and ask, show me first, don't touch X) rather than just the output
- The rules don't contradict each other`,
        },
      ],
    },

    {
      id: 'vibe-prod',
      num: 2,
      title: 'AI Coding in Production',
      kicker: 'Extra 02 · Real Stakes',
      weeks: 'Anytime',
      tagline: 'An engineer at Anthropic shipped a 22,000-line change written mostly by AI. This is what made that safe to do.',
      steps: [
        {
          id: 'video-pm-for-model',
          type: 'video',
          title: 'Providing context: you are the product manager',
          prompt: 'Erik Schluntz shipped a 22,000-line change to production that was largely written by Claude. This segment covers the shift in thinking that makes that possible, and the limits he put in place around it.',
          video: { youtubeId: 'fHWFF_pnqDk', start: 596, end: 860 },
          videoRecap: [
            'His framing: "ask not what Claude can do for you but what you can do for Claude." When the AI writes the code, your job is product manager for the model.',
            'A useful test for how much context to provide: what would a brand-new employee need to succeed at this task? Someone on their first day needs a tour of the codebase and the real requirements. Supplying that is now your responsibility.',
            'His practice: spend 15–20 minutes building a plan in a separate conversation — the model explores the files, and you agree on what will change and which patterns to follow — then hand that plan to a fresh conversation and let it work.',
            'He is direct that this does not work for everyone: if you cannot ask the right questions, you cannot manage the model effectively.',
            'Why a 22,000-line change was manageable: deliberate containment. The changes were concentrated in leaf nodes where some technical debt was acceptable, with close human review reserved for the parts that had to stay extensible.',
            'And verifiable checkpoints — inputs and outputs a human could check, plus long-running stress tests — which established that it worked without anyone reading every line.',
          ],
        },
        {
          id: 'video-how-you-learn',
          type: 'video',
          title: 'How you learn when the AI writes the code',
          prompt: 'An audience member asks a fair question: developers used to learn by working through syntax and wiring components together, so how do you learn now? This segment is his answer.',
          video: { youtubeId: 'fHWFF_pnqDk', start: 990, end: 1195 },
          videoRecap: [
            'The question: learning used to come from working through syntax, libraries, and the connections between parts of a program. What replaces that?',
            'He acknowledges the concern, then compares it to earlier objections that programmers got worse once they stopped writing assembly by hand.',
            'His own experience is that he learns faster now. While reviewing code he asks the model to explain an unfamiliar library and why it was chosen over the alternatives — effectively a pair programmer who is always available. His caveat: people who are not curious will not learn this way.',
            'The larger advantage for beginners is volume. Lessons about architecture and product fit that used to take two years to play out can now happen over months.',
            'On how much to specify in advance: give bare requirements when you genuinely do not care how something is done, and go into structural detail only once you know the codebase. He advises against rigid templates and over-constraining the model — think about what you would give a junior engineer to succeed.',
          ],
        },
        {
          id: 'checkpoints',
          type: 'exercise',
          title: 'Define two verifiable checkpoints',
          buildsOn: ['ai-specs/write-spec'],
          prompt: 'A verifiable checkpoint is something you can check in under a minute that shows a piece of the work is correct, without reading the code. Design TWO for what you are building. For each, write what you feed in, exactly what you expect to see, and how you would know it had broken. Then add one line naming the part of your build that has no checkpoint yet.',
          placeholder: 'CHECKPOINT 1 — I feed in: … / I should see: … / it has broken if: …\nCHECKPOINT 2 — I feed in: … / I should see: … / it has broken if: …\nNO CHECKPOINT YET: …',
          reviewerNote: 'A checkpoint only counts if the student could run it in under a minute and get an unambiguous yes or no. If a checkpoint amounts to "I look at it and see if it seems right", explain that this is observation rather than verification, and show what a checkable version would look like. If the expected output is vague ("it should work"), ask for the specific thing they would see on screen. Give credit for checkpoints that would catch a silent failure, since those are the hardest to notice. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'The failures that cause the most damage are the <b>silent</b> ones — a save that does not save, a total that does not update. They do not crash, so checking whether things "look fine" never finds them. A checkpoint finds them without reading the code: one specific input, one specific expected output, checked in a minute.',
            good: 'CHECKPOINT 1 — I feed in: log a 200-calorie snack, then force-quit the app. I should see: 200 still recorded when I reopen it. It has broken if: the number resets or the entry is gone.',
            bad: 'CHECKPOINT 1 — I feed in: use the app. I should see: everything working correctly. <em>(There is no specific input or expected result here, so there is nothing to check against.)</em>',
          },
          rubric: `- Two checkpoints, each with a specific INPUT, a specific EXPECTED OUTPUT, and a stated failure signal
- Each could realistically be run in about a minute and gives an unambiguous yes/no
- Neither relies on "it looks right" or reading the code to judge
- At least one would catch a SILENT failure (something that doesn't crash but is wrong)
- Names one part of the build that has no checkpoint yet`,
        },
      ],
    },

    {
      id: 'spec-truth',
      num: 3,
      title: 'Specifications as the Source of Truth',
      kicker: 'Extra 03 · What to Keep',
      weeks: 'Anytime',
      tagline: 'We write a prompt, keep the code it generates, and discard the prompt. This section argues we have it the wrong way round.',
      steps: [
        {
          id: 'video-spec-source',
          type: 'video',
          title: 'Why the specification holds the value',
          prompt: 'Sean Grove works on this problem at OpenAI. This segment is his argument that the specification, not the generated code, is the artifact worth keeping.',
          video: { youtubeId: '8rABwKRsec4', start: 277, end: 507 },
          videoRecap: [
            'Working with AI feels productive because it is communication-first: you describe the outcome you want, and the code is a secondary artifact produced downstream from that description.',
            'But the usual habit is backwards — we keep the generated code and treat the prompt as disposable, when the specification is where the value actually sits.',
            'His comparison: it is like choosing to "shred the source and then... very carefully version control the binary."',
            'A written specification is also what aligns people. It is the thing a team can debate, refer back to, and agree on. Without one, you have an idea rather than a plan.',
            'Code is a lossy version of the specification. As with decompiling a binary, you cannot recover the intent, the naming, or the reasoning from the code alone.',
            'And a sufficiently robust specification can be aimed at many outputs — TypeScript, Rust, servers, clients, documentation, tutorials — the way source code compiles for different processors.',
          ],
        },
        {
          id: 'spec-survives',
          type: 'journal',
          title: 'What survives without the code',
          prompt: 'Suppose every line of your project\'s code disappeared tonight, but you kept one document. Write down what that document would need to contain for you to rebuild the same product — not the same code, the same product. Then note which parts of your current understanding exist only in your head and would be lost.',
          placeholder: 'WHAT THE DOCUMENT MUST CONTAIN:\n- …\n- …\n\nCURRENTLY ONLY IN MY HEAD: …',
          buildsOn: ['ai-specs/write-spec'],
          minLines: 4,
          lessonPanel: {
            point: 'This is not hypothetical. Every time you open a new conversation, <b>the code survives and your reasoning does not</b> — the agent reads the files and has no way to know why any of it is the way it is. The document described here is what closes that gap, and it is the same document a teammate would need.',
            good: 'CURRENTLY ONLY IN MY HEAD: why the schedule is organized per shift rather than per person. Marcus explained the reason in an interview, and it is why the app works at all — but it is not written down anywhere.',
            bad: 'CURRENTLY ONLY IN MY HEAD: the code. <em>(The code is what the exercise removes. The question is what you know that the code does not say.)</em>',
          },
        },
      ],
    },

    {
      id: 'watch-build',
      num: 4,
      title: 'Watching a Real Build',
      kicker: 'Extra 04 · Case Study',
      weeks: 'Anytime',
      tagline: 'A real app with real users: the number its developer tracked, and the unglamorous work that moved it.',
      steps: [
        {
          id: 'video-hundred-users',
          type: 'video',
          title: 'What 100 users reveal that 10 cannot',
          prompt: 'Chris Raroque built an app and got it to 100 users. This segment covers what became visible at 100, and the decision he made as a result.',
          video: { youtubeId: 'ghxgQaxZ9Kw', start: 40, end: 220 },
          videoRecap: [
            'The first 10 users mainly tell you whether the app works at all. At 100, the number he considers most important becomes measurable: retention.',
            'His specific metric is week-one retention, and he is at roughly 3% — for every 100 signups, about three people are still using it a week later.',
            'He looked up the benchmark before reacting: calorie-tracking apps average about 3–10% week-one retention, which puts him at the low end of a normal range rather than in failure territory.',
            'That produces a concrete decision: spend one week improving retention before releasing on the App Store and onboarding 500 more users, since first impressions only happen once.',
            'His first change is widgets, chosen deliberately — a lock screen widget is seen roughly 150 times a day and opens the app in one tap, which removes friction from a daily habit.',
            'He ships only the core widgets rather than his full design backlog, trading polish for speed as a deliberate choice.',
          ],
        },
        {
          id: 'video-boring-bugs',
          type: 'video',
          title: 'Fixing bugs as retention work',
          prompt: 'After the retention features came the part that is easy to postpone. This segment covers the bug that would have quietly cost him users, and the feature he had shipped without noticing was missing.',
          video: { youtubeId: 'ghxgQaxZ9Kw', start: 352, end: 484 },
          videoRecap: [
            'Retention is usually discussed as a feature problem. He argues bugs matter just as much: if logging food silently fails to save, the user loses confidence and leaves.',
            'The most damaging one: you could edit nutrition information inline, but closing the app too quickly meant the change was not saved. An app that saves half the time is an app people stop using.',
            'Other silent failures had accumulated — the calorie calculation sometimes did not run, and the quick-add feature did not update the total at the bottom of the screen.',
            'A user on the feedback board asked where to enter their current weight. He had built a settings page with calorie and macro goals but no height or weight fields, which are the inputs those goals are calculated from.',
            'He rebuilt the settings page, updated onboarding to collect that data, and added metric and imperial units, since more than half his users are outside the US.',
            'His conclusion: postponing a bug to work on a more interesting feature has a cost, and that cost shows up in retention.',
          ],
        },
        {
          id: 'build-decision',
          type: 'journal',
          title: 'A decision you would have made differently',
          buildsOn: ['mvp-plan/final-plan'],
          prompt: 'Choose ONE decision he made in these two segments and write down what he did, what you would have done instead, and what that would have cost you. Then add one line naming something in your own project you are postponing in favour of more interesting work.',
          placeholder: 'HIS DECISION: …\nWHAT I WOULD HAVE DONE: …\nWHAT THAT WOULD HAVE COST ME: …\nWHAT I AM CURRENTLY POSTPONING: …',
          minLines: 4,
          lessonPanel: {
            point: 'The value in watching someone build is <b>finding where your instinct differs from theirs</b>, because that gap tends to be your next mistake. He checked a benchmark before reacting, fixed silent bugs before launching, and shipped partial widgets instead of a complete design. At least one of those is probably not what you would have done.',
            good: 'HIS DECISION: he checked the industry retention benchmark before reacting to 3%. WHAT I WOULD HAVE DONE: assumed 3% meant the app had failed and rebuilt onboarding from scratch. WHAT THAT WOULD HAVE COST ME: a week rebuilding something that was not actually broken.',
            bad: 'HIS DECISION: he fixed bugs. WHAT I WOULD HAVE DONE: I would also fix bugs. <em>(Look for a decision where your instinct genuinely differs — that is where the useful information is.)</em>',
          },
        },
      ],
    },
  ],
};

const FOUNDER_STORIES_WORKSHEET = {
  id: 'founder-stories',
  title: 'Founder Stories',
  extra: true,
  freeRoam: true,
  sections: [

    {
      id: 'idea-origins',
      num: 1,
      title: 'Where Ideas Come From',
      kicker: 'Extra 01 · Origins',
      weeks: 'Anytime',
      tagline: 'Two accounts of how real products actually started, and what they suggest about choosing what to work on.',
      steps: [
        {
          id: 'video-crowded-market',
          type: 'video',
          title: 'A crowded market is not a closed market',
          prompt: 'Y Combinator partners discuss a mistake they see often: founders abandoning good ideas because the space looks competitive. The example is a company that deliberately entered the market it believed was most crowded.',
          video: { youtubeId: 'TANaRNMbYgk', start: 2330, end: 2483 },
          videoRecap: [
            'A common pattern: founders talk themselves out of a good idea because two competitors have launched on TechCrunch and raised a seed round.',
            'GigaML applied to YC with an education idea (helping students in India apply to US colleges), moved to fine-tuning as a service, could not make that sustainable, and then looked for an industry to apply their expertise to.',
            'The area they were most interested in — AI customer support — was also the one they believed was most crowded. They entered it anyway and concentrated on winning a single willing early customer, the delivery company Zepto.',
            'The partners\' reading: in most crowded B2B markets you have to win on sales, but here most competing products simply did not work well. Replacing a human support team is a genuinely difficult technical problem, and their engineering strength let them deliver what others could not.',
            'Worth noting: they are described as strong engineers and not natural salespeople, and it took roughly a year of searching before they found the right idea. The partners treat that timeline as normal.',
          ],
        },
        {
          id: 'video-own-need',
          type: 'video',
          title: 'Building for yourself, then testing demand',
          prompt: 'A solo founder describes where each of his products came from, why copied ideas tend to fail, and how he decides whether an idea is worth building — which is not by thinking about it harder.',
          video: { youtubeId: 'k-aEdS28AH0', start: 284, end: 416 },
          videoRecap: [
            'Every product he has built started from something he needed himself. He made his first app because he wanted it to exist, and around a hundred thousand other people turned out to want it too.',
            'The business grew by chaining needs: he built a second tool to help market the first one, and that tool became far larger than the original, so he stopped working on the original.',
            'His argument against copying someone else\'s niche: because the idea is not connected to your own curiosity, you do not stay with it long enough — and that is usually what determines whether it ever reaches users.',
            'He does not debate internally whether an idea is good. He publishes a landing page or a short video and reads the response: if a thousand people arrive and nobody clicks buy, the idea or its framing is wrong.',
            'He reframes the question from "is this a good idea?" to "how would I frame this so it is valuable?" — would he use it, and does it save someone time or money.',
          ],
        },
        {
          id: 'idea-pattern',
          type: 'exercise',
          title: 'Name the pattern, then find it in your own life',
          prompt: 'Choose one story from this worksheet and state the underlying pattern in a single sentence — not what the company does, but the repeatable move behind it. Then find that same pattern somewhere in your own life or area of interest: describe the specific situation, and what the equivalent move would be for you.',
          placeholder: 'THE PATTERN, IN ONE SENTENCE: …\nWHERE I SEE IT IN MY OWN LIFE: …\nWHAT THE EQUIVALENT MOVE WOULD BE FOR ME: …',
          buildsOn: ['problem-statement/journal-problems'],
          reviewerNote: 'Check two things specifically. First, whether the pattern is stated as a transferable principle or is just a summary of the story — "they entered a crowded market" is a summary; "when competitors have raised money but their products do not work, the market is open to whoever can build a working one" is a pattern. Second, whether the application is a real situation with specifics rather than a restatement of the pattern in different words. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'A pattern is only useful if it <b>transfers</b>. The test: could someone in a completely different field act on your sentence without knowing the original story? If your sentence still contains the company\'s name or product, it is a summary rather than a pattern.',
            good: 'THE PATTERN: When existing products in a market are widely funded but work badly, technical ability alone can win the market. WHERE I SEE IT: Three apps claim to organize club schedules at my school and every one of them loses events — nobody I know trusts them.',
            bad: 'THE PATTERN: GigaML succeeded in AI customer support because they were good engineers. <em>(This describes one company. Someone in a different field could not act on it.)</em>',
          },
          rubric: `- The pattern is stated in ONE sentence as a transferable principle, not a summary of the story
- The sentence would make sense to someone who had not seen the video (no company name or product standing in for the idea)
- The application names a specific real situation from the student's own life or area of interest, with concrete detail
- The equivalent move is an action the student could actually take, not a restatement of the pattern
- The pattern and the application genuinely match each other`,
        },
      ],
    },

    {
      id: 'first-customers',
      num: 2,
      title: 'Getting Your First Customers',
      kicker: 'Extra 02 · First Users',
      weeks: 'Anytime',
      tagline: 'How founders actually found the first people who used their product. Almost none of it looks like marketing.',
      steps: [
        {
          id: 'video-fifty-founders',
          type: 'video',
          title: 'How founders found their first customer',
          prompt: 'One question put to a long series of founders. Listen for how ordinary and small-scale the answers are — and how many of them involve contacting one person directly.',
          video: { youtubeId: 'NZp5j5hvn9I', start: 0, end: 189 },
          videoRecap: [
            'The answers are almost never "marketing": a cold email, messaging people on Reddit, a hand-written outreach message, LinkedIn.',
            'One team went door to door and waited outside a food truck until the owner took a break, then signed him on the spot.',
            'Another left a voicemail for a physical therapist. She called back, they explained why they had started the company, and she signed because she felt they were sincere.',
            'One team sold a $250-a-month contract from customer discovery calls before writing any code, then built and deployed a rough version in seven days.',
            'A personal finance team mocked up the product they wanted, put a waitlist page behind it, posted it to a Reddit group they were already part of, and had close to a thousand signups within 24 hours.',
          ],
        },
        {
          id: 'video-first-testers',
          type: 'video',
          title: 'Recruiting testers where you already have an audience',
          prompt: 'A realistic timeline for a small app: how long the first version took, where the first few dozen testers came from, and how long it was before the app was actually stable.',
          video: { youtubeId: 'V_4kiR3R4QU', start: 256, end: 358 },
          videoRecap: [
            'The timeline is deliberately unremarkable: building started in May, a basic timer took a few weeks, and there was no first version until August.',
            'Before launching anywhere public, they invited a few dozen people from RedNote to test it, then spent about a month on feedback and bug fixes.',
            'The launch was solid rather than dramatic — roughly 3,000 downloads in the first week — and syncing bugs meant the app was not really stable until December or January.',
            'They had a group of testers at all because his girlfriend had been posting her illustrations on RedNote and already had followers there. That existing foothold is the entire distribution story for the early stage.',
            'Later growth came from other accounts featuring the app in roundup posts and a reshare in Taiwan, which roughly doubled downloads overnight.',
          ],
        },
        {
          id: 'first-users-plan',
          type: 'exercise',
          title: 'Plan your first three users',
          prompt: 'Write how you would get three real people using what you are building, starting this week. Name each of the three specifically — an actual person, group, or place, not a category. For each, state the exact channel you would reach them through and the first message you would send. Then add one line: which tactic from these two videos you are copying, and why it fits your situation.',
          placeholder: 'PERSON 1: … / CHANNEL: … / FIRST MESSAGE: …\nPERSON 2: … / CHANNEL: … / FIRST MESSAGE: …\nPERSON 3: … / CHANNEL: … / FIRST MESSAGE: …\nTACTIC I AM COPYING, AND WHY IT FITS: …',
          buildsOn: ['user-needs/outreach-plan'],
          reviewerNote: 'Review this as someone who has done cold outreach. Point out any target that is a category rather than a specific person or place ("students at my school" is a category; "the three club presidents who run sign-ups" is not). Check that each channel is one the student can actually access this week, and that each first message is short enough that a stranger would finish reading it. If the chosen tactic does not match their situation — a paid-ads approach for someone with no budget, for instance — say so and suggest one from the videos that does fit. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'The founders in these videos did not find a channel — they found <b>a person</b>. Almost every story is one specific human contacted directly, or one community the founder was already part of. Scale is a later problem; the first three users are a list of names.',
            good: 'PERSON 1: Ms. Okafor, who runs the front desk at the rec centre and keeps the schedule on paper. CHANNEL: in person Thursday after 4pm, when the desk is quiet. FIRST MESSAGE: "I built something for the sign-up sheet problem you mentioned — could I show you for two minutes?"',
            bad: 'PERSON 1: Students who need better scheduling. CHANNEL: social media. FIRST MESSAGE: I would post about my app. <em>(No specific person, no specific channel, and nothing to send.)</em>',
          },
          rubric: `- Three targets, each a SPECIFIC person, group, or place — not a category like "students" or "small businesses"
- Each has a concrete channel the student could actually use within a week
- Each has an actual first message written out, short enough that a stranger would read it
- Names one specific tactic from the videos and explains why it fits the student's situation
- The plan does not depend on money, an existing audience, or anything the student does not have`,
        },
      ],
    },
  ],
};

const PEOPLE_WORKSHEET = {
  id: 'people-skills',
  title: 'People Skills',
  extra: true,
  freeRoam: true,
  sections: [

    {
      id: 'networking-call',
      num: 1,
      title: 'The Networking Call',
      kicker: 'Extra 01 · Conversations',
      weeks: 'Anytime',
      tagline: 'How to prepare for a conversation with someone further along than you, and make good use of the time they give you.',
      steps: [
        {
          id: 'video-conversation',
          type: 'video',
          title: 'Five rules from a professional interviewer',
          prompt: 'Celeste Headlee is a radio interviewer — her job is getting people to say interesting things out loud. This segment covers the first five of her rules, which apply directly to a call with a mentor or a potential user.',
          video: { youtubeId: 'R1vskiVDwl4', start: 258, end: 465 },
          videoRecap: [
            'Do not multitask, and it is not only about the phone. Being half-present is worse than politely ending the conversation, because the other person can tell.',
            'Do not lecture. Enter the conversation assuming you have something to learn: everybody is an expert in something you know nothing about.',
            'Ask open-ended questions. "Were you terrified?" invites a one-word answer; "What was that like?" requires the person to think.',
            'Follow the conversation rather than your notes. When a good question occurs to you mid-answer, let it go — people who hold on to a prepared question have stopped listening.',
            'If you do not know something, say so. In her words, talk should not be cheap.',
          ],
        },
        {
          id: 'prep-card',
          type: 'exercise',
          title: 'Prepare for a real call',
          buildsOn: ['problem-statement/final-statement', 'user-needs/outreach-plan'],
          prompt: 'Choose someone you could plausibly get 20 minutes with — a mentor, a family friend, a founder in your area of interest, or the manager of a business where you noticed a problem. Write a preparation card with four parts: (1) who they are and why this person specifically, (2) your introduction — who you are and what you are working on, in one line, (3) three open-ended questions this person is particularly well placed to answer, and (4) your ask, in one sentence.',
          placeholder: 'WHO, AND WHY THIS PERSON: …\nMY ONE-LINE INTRODUCTION: …\nQ1: …\nQ2: …\nQ3: …\nMY ASK: …',
          reviewerNote: 'Review this as someone who takes a lot of these calls. Point out any question that could be answered by a web search, any question answerable with yes or no, and any introduction that would lose a busy adult\'s attention. If the ask is vague ("pick your brain", "any advice"), name that and offer a concrete version. Do not push them toward contacting a well-known person — a local business manager is a perfectly good choice. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'The ask is the part most people get wrong. <b>"Can I pick your brain?"</b> puts the work on the other person — they have to work out what you actually want. A specific, small request ("could I show you two screens and tell me which one you would use?") is easy to answer. And the ask belongs at the end of the call, after the conversation has earned it.',
            good: 'MY ASK: You have hired around 50 shift workers — could I read you my three interview questions and have you tell me which one would irritate you?',
            bad: 'MY ASK: I would love to pick your brain about entrepreneurship and hear any advice you have. <em>(Too broad to answer well, and it is not clear what you would do with the response.)</em>',
          },
          rubric: `- Names a specific, real, plausibly-reachable person and says why THAT person (not "a founder")
- The one-line introduction is actually one line and covers who they are and what they're working on
- All three questions are open-ended (a yes/no or easily-searchable question does not pass)
- At least one question is one this person is particularly well placed to answer from experience
- The ask is one concrete sentence that is easy to say yes to — not "pick your brain" or "any advice"`,
        },
      ],
    },

    {
      id: 'story-telling',
      num: 2,
      title: 'Telling It As A Story',
      kicker: 'Extra 02 · Presenting',
      weeks: 'Anytime',
      tagline: 'The structure behind persuasive presentations, and how to apply it to the work you are presenting.',
      steps: [
        {
          id: 'video-story-structure',
          type: 'video',
          title: 'The structure behind persuasive talks',
          prompt: 'Nancy Duarte compared Martin Luther King Jr.\'s "I Have a Dream" with Steve Jobs\' iPhone launch and found the same underlying structure. This is the one to borrow for a demo-day presentation.',
          video: { youtubeId: '1nYFpuc2Umk', start: 301, end: 524 },
          videoRecap: [
            'The basic story shape: a likable protagonist wants something, encounters an obstacle, and is changed by the end. The important adjustment for presenters is that the audience is the protagonist, not the speaker — in her phrasing, "You\'re not Luke Skywalker, you\'re Yoda."',
            'Open by establishing what is — the current situation your audience recognizes. Then contrast it with what could be, and widen that gap as far as the facts allow.',
            'The middle of a talk moves back and forth between what is and what could be, which deliberately surfaces the resistance an audience already feels rather than ignoring it.',
            'Her analogy: a sailboat tacks against the wind in order to use it, and a well-set sail moves the boat faster than the wind itself.',
            'Close on the final turn: a call to action, followed by a specific picture of the world once the idea exists.',
          ],
        },
        {
          id: 'three-beat',
          type: 'exercise',
          title: 'Write your problem as a three-part story',
          prompt: 'Take the problem you are working on and write it in three parts. WHAT IS: the situation today, told through one specific person in one specific moment, without statistics. THE TENSION: why it stays broken, and what that costs them. WHAT COULD BE: the same person in the same moment, after your product exists. Then add one line: the call to action you would end a presentation on.',
          placeholder: 'WHAT IS: It is 7:40am and Marcus is …\nTHE TENSION: …\nWHAT COULD BE: …\nCALL TO ACTION: …',
          buildsOn: ['problem-statement/journal-problems'],
          reviewerNote: 'Respond as an audience member at a demo day rather than a grader. Say honestly whether the WHAT IS put you in a room with a specific person or opened with a statistic. If they made themselves the protagonist rather than the user, point that out — it is the most common error here. Reward specific detail, and name any part that stays general. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'Statistics tend to be what we reach for when we do not have a scene. <b>"73% of students report scheduling stress"</b> is easy to ignore. <b>"It is 7:40am and Marcus is texting three group chats to find out whether he is on register"</b> holds attention — and it conveys the same fact.',
            good: 'WHAT IS: It is 7:40am. Marcus is standing outside the café scrolling through three group chats trying to find out whether he is on register today. He worked yesterday. Nobody knows.',
            bad: 'WHAT IS: Scheduling in small businesses is inefficient and causes frustration for employees. <em>(Accurate, but there is no person and no moment, so there is nothing for an audience to picture.)</em>',
          },
          rubric: `- WHAT IS is a specific scene: a named or clearly-drawn person, a moment in time, something concrete happening — NOT a statistic or a general statement
- THE TENSION explains why it stays broken and what it costs that person
- WHAT COULD BE returns to the SAME person in the SAME moment, changed — not a feature list
- The user is the protagonist of the story; the builder is not
- The call to action is one clear sentence asking for something specific`,
        },
      ],
    },

    {
      id: 'slide-design',
      num: 3,
      title: 'Slide Design',
      kicker: 'Extra 03 · Presenting',
      weeks: 'Anytime',
      tagline: 'Three rules that improve most decks, and a theme you decide once and then reuse.',
      steps: [
        {
          id: 'video-slide-rules',
          type: 'video',
          title: 'Three rules for readable slides',
          prompt: 'This segment covers the three rules that matter most in slide design. Two of them contradict the default behaviour of every presentation template.',
          video: { youtubeId: 'Iwpi1Lm6dFo', start: 365, end: 634 },
          videoRecap: [
            'One message per slide. With two messages, an audience picks one and loses the other — the same way hearing your own name across a noisy room pulls your attention away from the person in front of you.',
            'The redundancy effect: putting full sentences on a slide and reading them aloud at the same time leaves audiences retaining almost nothing. Move the text into your notes and leave short text plus an image.',
            'Attention is drawn reliably to four things: movement, signalling colours such as red, orange and yellow, high contrast, and large objects. These can be used deliberately.',
            'Default templates invert the sizing — the largest element is the headline and the smallest is the content — so audiences spend around 70% of their attention on a headline that is usually not the point.',
            'The rule that follows: the most important item on a slide should also be the largest item on the slide.',
          ],
        },
        {
          id: 'theme-rules',
          type: 'exercise',
          title: 'Define your deck\'s four theme rules',
          prompt: 'A theme is four decisions made once so you are not re-making them the night before. Write yours: (1) TYPE — which font, and the specific sizes for the largest element and for everything else, (2) COLOUR — background, text, and one accent colour, plus what the accent is used for, (3) LAYOUT — where the main element sits on every slide and what is always in the corner, and (4) LIMIT — your maximum words per slide, and where the words you cut go instead.',
          placeholder: 'TYPE: …\nCOLOUR: …\nLAYOUT: …\nLIMIT: … / cut words go to: …',
          reviewerNote: 'Assess whether these rules could actually be followed under time pressure, or whether they are intentions. "Clean modern font" is not a rule; a font name and two point sizes is. If the accent colour has no stated purpose, note that it will end up used everywhere. If the word limit has no destination for the cut text, note that the limit is unlikely to hold. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'A theme is a constraint you set while you have time, so that a rushed version of you cannot undo it. The test for each rule: <b>could someone else build a slide from it without asking you a question?</b> "Big title" does not pass. "Title 20pt, one message 60pt, positioned bottom-left" does.',
            good: 'LIMIT: 12 words maximum per slide. Anything I cut goes into the speaker notes and I say it out loud instead.',
            bad: 'LIMIT: Keep slides clean and not too wordy. <em>(There is no number here, so there is nothing to check a slide against.)</em>',
          },
          rubric: `- TYPE names an actual font and gives specific sizes (or a clear ratio) for the largest element vs. the rest
- COLOUR specifies background, text, and exactly ONE accent — and states what the accent is used for
- LAYOUT is specific enough that another person could place elements without asking a question
- LIMIT is a number, and there is a stated destination for the words that get cut
- The rules reflect the core idea from the video: the most important item on a slide is the largest item on the slide`,
        },
      ],
    },

    {
      id: 'teamwork',
      num: 4,
      title: 'Effective Teamwork',
      kicker: 'Extra 04 · Working Together',
      weeks: 'Anytime',
      tagline: 'What research finds separates teams that deliver, and how to set expectations with your own team.',
      steps: [
        {
          id: 'video-psych-safety',
          type: 'video',
          title: 'The study that produced the opposite result',
          prompt: 'Amy Edmondson set out to show that better hospital teams make fewer mistakes. Her data showed the reverse, and the explanation is one of the more useful findings about how small teams work.',
          video: { youtubeId: 'LhoLuui9gX8', start: 310, end: 524 },
          videoRecap: [
            'She measured team effectiveness and tracked medication errors, expecting the stronger teams to make fewer. The stronger teams appeared to make more.',
            'The explanation was not that they made more errors, but that they were willing to discuss them. Mistakes were reported and examined rather than concealed.',
            'She tested this by sending in a research assistant who knew nothing — not the error rates, not her hypothesis. His independent ratings of how openly each unit discussed mistakes closely tracked the error data. She later named the underlying factor psychological safety.',
            'First practical step: frame the work as a learning problem rather than an execution problem. State the uncertainty out loud, so it is clear that everyone\'s input is needed.',
            'Second: acknowledge your own fallibility — say that you may miss something and need to hear from others. This works coming from peers, not only from whoever is leading.',
            'Third: ask a lot of questions. Genuine curiosity is what creates the need for other people to speak.',
          ],
        },
        {
          id: 'working-agreements',
          type: 'exercise',
          title: 'Write three working agreements for your team',
          prompt: 'Write three agreements you would actually propose to your team this week. Each needs a trigger (WHEN this happens) and a behaviour (WE do this). Between your three, cover at least two situations: someone is stuck or has fallen behind, and someone disagrees with the direction while everyone else agrees. Then add one line on how you would raise these with your team in your own words.',
          placeholder: 'WHEN … WE …\nWHEN … WE …\nWHEN … WE …\nHOW I WOULD ACTUALLY PROPOSE THESE: …',
          reviewerNote: 'Review these from the perspective of a teammate who has not read any of the theory. Assess whether each agreement would survive an ordinary week or whether it is a slogan. An agreement with no trigger is a value rather than an agreement — say so. Be particularly attentive to agreements that only work if everyone is already comfortable, since the purpose is to make it safe before that is true. Also check the last line: reciting the term "psychological safety" to friends is unlikely to work, and it is worth telling them that plainly. Keep the tone matter-of-fact and instructive.',
          lessonPanel: {
            point: 'Teams usually stall not because nobody cares, but because <b>admitting you are stuck feels more costly than staying stuck</b>. A working agreement lowers that cost by deciding in advance that saying so is normal. That is why the trigger matters: without a trigger, there is no agreement.',
            good: 'WHEN someone has not pushed anything in three days, WE ask "what is in your way?" in the group chat rather than "did you do it yet?", and whoever has time picks up one piece of it.',
            bad: 'WE will communicate openly and support each other. <em>(There is no trigger and no specific behaviour, so nothing about how the team works would change.)</em>',
          },
          rubric: `- Three agreements, each with an explicit trigger (WHEN …) and an explicit behaviour (WE …)
- One agreement covers someone being stuck or behind, and does so without blame
- One agreement covers a lone dissenting opinion — a way for one person to disagree and be heard
- The agreements would work even if the team is NOT already comfortable with each other
- The final line is something the student could actually say out loud to their team, in their own words, without jargon`,
        },
      ],
    },
  ],
};

const WORKSHEETS = [MVP_WORKSHEET, AI_WORKSHEET, AI_CODING_WORKSHEET, FOUNDER_STORIES_WORKSHEET, PEOPLE_WORKSHEET];

if (typeof module !== 'undefined' && module.exports) module.exports = WORKSHEETS;
if (typeof window !== 'undefined') window.WORKSHEETS = WORKSHEETS;
