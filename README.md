# Builders Club — Semester Worksheets

Interactive semester worksheets for Builders Club, with **AI review** built in. Students work through scaffolded chains of journals, gated video segments, and exercises; each worksheet builds on top of the previous ones allowing for a cohesive experience.

![Worksheet hub](docs/screenshots/hub.png)

Every submission is reviewed against the step's rubric by **Claude** (Anthropic) or **Codex** (OpenAI). It runs as a website, so:

- **Students install nothing.** They open a link and sign in with a Microsoft account — their school's or a personal one.
- **One set of API keys.** The instructor sets them once on the server; students never see or need a key.
- **No database.** Each student's progress is a JSON file on a persistent disk.

---

## For students

1. Open the link your instructor gave you.
2. Click **Sign in with Microsoft** and use your school account, or a personal Microsoft account if you'd rather.
3. Work through the sections.

Sign in with the same account every time and your work is always there. That's the whole setup. A few things worth knowing:

- **Your answers save themselves** as you type — there is no save button for drafts, and you can close the tab whenever you like.
- **It works on a phone or a laptop**, and you can switch between them. Your work follows your account, not the device.
- **Video steps** play a segment of a video picked for its quality; the next step unlocks when it finishes.
- **Exercise steps** are reviewed by the AI against that step's rubric. The goal is to iterate towards a good response, not to get graded or rush towards completion.
- **Journal steps** are private reflections; the AI can reference them later to connect ideas.
- Finished sections mint **artifacts** — the tangible outputs (problem statement, MVP plan, …).

![A worksheet step with a gated video segment](docs/screenshots/step.png)

To hand work in or keep a copy, open **⚙ Settings → Download Builder file**. Uploading one restores that work into your account. If you ever want to start over, Settings has a hard reset that clears your account only.

---

## For instructors: deploying on Railway

You need three things: an app registration for sign-in, a Railway project, and an AI API key.

**Nothing is required from your school, or from any student's school.** The app registration lives in your own directory. Students at any organization sign in with the account they already have, and their IT department never registers, configures or approves anything. If a student's school happens to block unapproved apps for its own accounts, that student can sign in with a personal Microsoft account instead.

### 1. Register the app

You can do this with **any** Microsoft account, including a free personal one — you don't need school Azure access. In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**:

- **Supported account types:** *Accounts in any organizational directory (any Microsoft Entra ID tenant — Multitenant) **and** personal Microsoft accounts.* This is the setting that makes it work for everyone without their IT involved.
- **Redirect URI:** platform **Web**, value `https://YOUR-APP.up.railway.app/auth/callback`. You get the real domain in step 2; come back and fill it in then.
- From the Overview page, copy the **Application (client) ID**.
- Under **Certificates & secrets** → **New client secret**, copy the secret **Value** (not the Secret ID — the value is shown only once).

You do not need to add API permissions. The app asks only for `openid`, `profile` and `email`, which are the basic sign-in scopes and need no admin consent.

### 2. Create the Railway service

1. New project → **Deploy from GitHub repo** → pick this repository.
2. **Settings → Networking → Generate Domain.** Put that domain plus `/auth/callback` into the redirect URI from step 1.
3. **Add a Volume** and mount it at `/data`. Without it, every student's work is erased on the next deploy — the server refuses to start rather than let that happen quietly. If your plan offers volume backups, turn on a **daily schedule**; either way, download a **class backup** from the dashboard now and then (see below), because that copy is the one that doesn't live on the same platform as the thing it's backing up.
4. Leave the service at **1 replica**. Student work is files on that one volume, so a second replica would race on writes.

### 3. Set the variables

In the service's **Variables** tab. Paste values raw, with no quotes:

```
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<the secret Value>
SESSION_SECRET=<openssl rand -hex 32>
INSTRUCTOR_EMAILS=you@school.edu
ANTHROPIC_API_KEY=sk-ant-...
```

That's the whole list. Railway supplies `PORT`, the volume path and the public domain itself.

**Leave `MS_TENANT_ID` unset.** That's what makes sign-in work for any Microsoft account. Setting it restricts sign-in to that one directory, which you'd only want if every student is guaranteed to have an account there.

Optionally set `ALLOWED_EMAIL_DOMAINS=yourschool.edu` to limit who can get in. Without it, anyone with a Microsoft account can sign in and start their own worksheets, which also means they can spend your AI budget. The per-student daily cap limits the damage, but the domain list is the real gate.

### 4. Check it

- `https://YOUR-APP.up.railway.app/healthz` returns `{"ok":true}` plus a `storage` block naming the path it writes to and whether that path is persistent and writable.
- The boot log's `data:` line should show your volume's mount path (`/data`), not a path under `/app`.
- The deploy log names the sign-in mode. You want: `Microsoft — any Microsoft account`.
- Sign in as yourself. Because your email is in `INSTRUCTOR_EMAILS`, a **👥** button appears in the top bar — that's the dashboard.
- The log prints one line per AI call with its token counts — that's your running cost.

## The instructor dashboard

**👥** opens it. Five screens over the same live data — there is nothing to download, import or refresh.

| Screen | Use it to |
|---|---|
| **Class** | See everyone at once. Every builder is a row, every core step a column. Click a cell to read that step across the class, a name for that builder, a section number for that section. **Board** and **List** re-sort the same people by who needs you today. |
| **Steps** | Find the step the class is failing. *Taking the most attempts* ranks by how many tries the work takes; *People sitting on them now* ranks by how many are stuck there this minute. |
| **One step** | Read every answer to one question in one scroll, with the rubric beside them, and every earlier attempt with what the AI said. This is the screen for session prep and marking. |
| **A builder** | Everything one student wrote, section by section. **Print one-pager** gives you a sheet for a 1:1; **Read their worksheets** opens their account exactly as they see it, read-only. |
| **XP** | The leaderboard, plus **Copy CSV** for a gradebook. |

### Reading the class grid

| | |
|---|---|
| **Green** | done |
| **Green with a slash** | Builders AI let them skip it — **this earns no XP** |
| **Blue** | in progress |
| **Coral** | stuck: three or more rejected attempts. Coral only ever means "a human should look at this" |
| **White** | not started, but unlocked |
| **Pale** | not unlocked yet — they couldn't have reached it |
| **Notch in the corner** | passed, but it took three or more tries |

The number on the right is how many steps from the class median someone is. It is a position, not a grade, and it makes no claim about how hard anyone worked.

### Things it deliberately doesn't do

**No streak.** Students see one; this doesn't. It counts *distinct days on which XP was earned*, not consecutive ones, and it never resets — so someone who worked in January and again in August shows a "2-day streak". Ranking a class by a number that doesn't mean what it says would be worse than showing nothing.

**No attempts figure per builder.** Attempts belong to a step. Three attempts on a hard synthesis step is better work than one on an easy exercise, so a per-builder average would quietly punish the builders who revise — the opposite of what the program teaches. You see attempts against steps, and against a builder's individual answers, never as their score.

**No time on task, and no predicted finish date.** The data carries when a step was finished and nothing about how long it took, so anything about hours or pace would be invented.

**No dash where a zero would lie.** Only 29 of the 88 steps are graded by an AI, so the rest show `—` for attempts rather than `0`, which would read as "trivially easy" about a step nobody ever graded.

### XP, and why it may differ from the student's

XP is recomputed from the work rather than read off the student's running total, because a step pays its own XP **plus** its section's bonus when it's the step that finishes the section — 1020 of the 2480 available. Where the two disagree you get an `xp mismatch` pill, which usually means a redo, an import, or an older version of the worksheets.

Steps the AI let a builder skip pay nothing, so two builders at the same point in the course can be a couple of hundred XP apart through no fault of either. The leaderboard says so, permanently, under its title.

> The **One step** screen shows the rubrics — the answer keys the AI marks against. That's fine for you and your mentors; it's a reason not to hand anyone your sign-in.

### Backing up the class

At the bottom of the Class screen, **⬇ Download class backup** writes one JSON file holding every student's answers, XP, artifacts and review threads. It is the whole semester in a file you keep yourself — no platform feature, no plan tier, nothing to configure. Take one at the end of each week and put it somewhere that isn't this server.

**⬆ Restore class backup** puts one back. It is additive and reversible: a student the file doesn't mention is untouched, and each student it does restore gets a snapshot of their current work taken first, so ⚙ Settings → Restore a backup can undo it per student. Use it after a volume is lost or when standing the site up somewhere new — sign in as yourself on the empty service and upload the file.

Snapshots, volume backups and class backups protect different things and don't replace each other: snapshots undo one student's mistake, volume backups are the platform's copy of the disk, and a class backup is yours. Note that wiping a volume deletes its backups with it, and a deleted volume is recoverable for 48 hours via an emailed link.

## Updating worksheets

Push to the repository. Railway redeploys and the new content is live immediately; student work on the volume is untouched.

<details>
<summary>Editing content while students are mid-worksheet</summary>

Progress is denoted by **id** (`"sectionId/stepId"`), stored separately from content, so most edits land safely on a student who's halfway through. Free to change any time: prompts, placeholders, rubrics, lesson panels, reviewer notes, titles, videos and their timestamps, week chips, `buildsOn`, resources — plus adding steps, sections or whole worksheets, and reordering steps.

There are only 3 edits to look out for that cause issues with student work:

1. **Renaming a step or section `id`.** The answer stays in the student's state file but nothing looks for it, and the step reads as untouched. Change titles freely; treat ids as permanent. (`pick-top-5` keeps that id even though it now says "top 3" — that's the pattern.)
2. **Deleting a step or section** that students have answered.
3. **Converting a step to or from a `board`.** Text and list answers share one string field, so textarea ↔ list is safe; boards use a separate field and won't show the old answer. Raising a `min` or `minPerSide` can also make an already-passed step fail on redo.
</details>

---

## Local development

```bash
git clone https://github.com/1729-Learning/Builders-Club-Worksheets.git
cd Builders-Club-Worksheets
npm install
ALLOW_DEV_LOGIN=1 npm start
```

Open <http://localhost:4321> and click **Dev sign-in**. No Entra tenant needed.

- `/auth/dev?as=alex` signs in as a second student — useful for filling a class.
- `/auth/dev?as=instructor` plus `INSTRUCTOR_EMAILS=instructor@dev.local` gives you the dashboard.
- Add `ANTHROPIC_API_KEY=...` to test real reviews; without a key, reviews show a friendly "not set up yet" notice and everything else still works.
- Data lands in `./data/`, which git ignores.

Dev sign-in refuses to run if `MS_CLIENT_ID` is set or `NODE_ENV=production`, so it cannot be reached on a deployed site.

```bash
npm test          # 39 checks, no dependencies
node test/run.js --only=grid --verbose
```

The suite covers the curriculum's two-layer XP model, the state-to-record adapter, every number the dashboard shows, and the grid's six cell states. Fixtures are built from the real curriculum rather than written by hand, so a mistyped step id can't make a check pass for the wrong reason.

---

## Configuration reference

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `4321` | Server port. Railway sets this. |
| `PUBLIC_BASE_URL` | Railway's domain | Public https origin. Builds the Microsoft redirect URI and decides whether cookies are `Secure`. Filled in from `RAILWAY_PUBLIC_DOMAIN` on Railway. |
| `SESSION_SECRET` | — | Signs session cookies. Required in production; changing it signs everyone out. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts. |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | — | The app registration. Both required. |
| `MS_TENANT_ID` | multi-tenant | Leave unset so any Microsoft account can sign in. A Directory (tenant) ID restricts sign-in to that directory. |
| `ALLOWED_EMAIL_DOMAINS` | empty | Comma-separated domains allowed to sign in; subdomains included. Empty allows any account. |
| `INSTRUCTOR_EMAILS` | empty | Comma-separated emails that get the dashboard. Case-insensitive, re-read on every request. |
| `ANTHROPIC_API_KEY` | — | Enables the Claude engine. |
| `OPENAI_API_KEY` | — | Enables the Codex (OpenAI) engine. |
| `REVIEW_BACKEND` | `auto` | Default engine: `claude`, `codex`, or `auto`. Students can switch only when both keys are set. |
| `REVIEW_MODEL` | `claude-sonnet-5` | Anthropic model. |
| `OPENAI_MODEL` | `gpt-5.6-terra` | OpenAI model. |
| `REVIEW_MAX_TOKENS` / `DRAFT_MAX_TOKENS` | `32000` / `16000` | Output ceilings. Reviews stream, so a high ceiling is safe. |
| `AI_TIMEOUT_MS` | `300000` | Per-request timeout. |
| `AI_CONCURRENCY` | `4` | Simultaneous AI calls across all students; the rest queue. |
| `REVIEW_DAILY_CAP` | `60` | AI calls per student per day. `0` disables the cap. |
| `DATA_DIR` | volume, else `./data` | Where per-student JSON lives. Leave empty when deployed so the Volume is used. |
| `ALLOW_EPHEMERAL_DATA` | unset | `1` lets the server start with no persistent disk, erasing all work on each deploy. Throwaway demos only. |
| `ALLOW_DEV_LOGIN` | unset | `1` enables `/auth/dev` locally. Ignored in production. |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in bounces back with an error | The redirect URI on the app registration must match your domain plus `/auth/callback` exactly. The deploy log gives the reason. |
| Only accounts from one directory work | `MS_TENANT_ID` is set. Clear it for multi-tenant. |
| Reviews say the reviewer is unavailable | No API key set, a key that's invalid or out of credit, or that student hit `REVIEW_DAILY_CAP`. The logs say which. |
| A student's progress vanished after a deploy | The Volume isn't attached, or `DATA_DIR` points somewhere off it. The server now refuses to start in the first case and warns in the second; check the `data:` line in the boot log against your mount path. |
| Everyone's work is gone and there's no volume backup | Sign in as yourself and upload your most recent **class backup** from the dashboard. Work done since that file was downloaded is not in it. |
| 👥 button missing | That email isn't in `INSTRUCTOR_EMAILS`. It's re-read per request, so just reload after fixing it. Check it matches the address the sign-in actually returned. |
| A student sees "Need admin approval" | Their school blocks unapproved apps for its own accounts. They can sign in with a personal Microsoft account instead. |
| "That account isn't on your instructor's list" | `ALLOWED_EMAIL_DOMAINS` doesn't include their address's domain. |
| Server won't start at all | It refuses to run with no sign-in configured, with no persistent disk, or when it cannot write to `DATA_DIR`. The boot log names the cause, the variables it needs, and which ones it can currently see. |
| Students see a spinner for a long time | Reviews are queued behind `AI_CONCURRENCY`. Raise it if your rate limits allow. |
| Someone wants a clean slate | ⚙ Settings → Danger zone → Hard reset. It only touches that one account. |

---

## How content works

All worksheet content — worksheets, sections, steps, video segments, rubrics, role-plays — lives in [`content.js`](content.js). **Adding a worksheet is config, not code.** Video segments reference YouTube IDs with `start`/`end` times; swap them freely.

[`curriculum.js`](curriculum.js) projects that content into the flat, decided shape the dashboard wants — XP defaults applied, rubrics split into lines, every step given a stable `sectionId/stepId` key. It runs in both the browser and Node, and never mutates `WORKSHEETS`.

The server ([`server.js`](server.js)) serves the static app and routes requests; the work is in [`lib/`](lib): `prompts.js` (the review persona and every prompt, as pure functions), `store.js` (per-student state, snapshots, profiles), `ai.js` (provider calls plus concurrency, single-flight and daily caps), `auth.js` (Microsoft sign-in and signed session cookies), and `records.js` (one student's stored state, shaped into the record the dashboard reads).

The front-end is a hash-routed single-page app — no framework, no build step, classic `<script>` tags whose order in [`index.html`](public/index.html) is the dependency graph. [`public/app.js`](public/app.js) is the student's worksheets; the `dash-*.js` files are the instructor's dashboard, kept separate so the two halves don't grow into each other: `dash-aggregate.js` (every number, as pure functions), `dash-ui.js` (HTML-string helpers), `dash-store.js` (what's loaded and how), `dash-app.js` (its router), and one file per screen.

Three instructor endpoints feed it. `/api/instructor/class` carries **numbers only** — the grid, the step rankings and the leaderboard show nobody's writing, so nobody's writing is sent. `/api/instructor/record/:oid` and `/api/instructor/step/:section/:step` fetch prose for the one screen that will display it.
