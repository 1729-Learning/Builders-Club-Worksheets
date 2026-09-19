# Builders Club — Semester Worksheets

Interactive semester worksheets for Builders Club, with **AI review** built in. Students work through scaffolded chains of journals, gated video segments, and exercises; each worksheet builds on top of the previous ones allowing for a cohesive experience.

![Worksheet hub](docs/screenshots/hub.png)

Every submission is reviewed against the step's rubric by **Claude** (Anthropic) or **Codex** (OpenAI). It runs as a website, so:

- **Students install nothing.** They open a link and sign in, either with a class code you share or with their school Microsoft account.
- **One set of API keys.** The instructor sets them once on the server; students never see or need a key.
- **No database.** Each student's progress is a JSON file on a persistent disk.

---

## For students

1. Open the link your instructor gave you.
2. Sign in. Depending on how your instructor set it up, that is either the **class code** they gave you plus your own name, or your **school Microsoft account**.
3. Work through the sections.

If you sign in with a class code, **type your name the same way every time** — your name is how your work is found again. Capitals and extra spaces don't matter, but "Jamie Chen" and "Jamie C" are two different people as far as the site is concerned.

That's the whole setup. A few things worth knowing:

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

You need a Railway project, at least one AI API key, and a way for students to sign in. There are two, and you can run both at once:

| | Class code | School Microsoft accounts |
|---|---|---|
| Setup | Two environment variables | An Entra ID app registration, usually via school IT |
| Students type | A shared code and their name | Their normal school email and password |
| Identity | The name they type | Their real school account |
| Good for | Getting started this week | The whole semester, if IT will grant it |

Start with the class code if you don't already have Entra access — you can add Microsoft later without anyone losing work, since the two can run side by side.

### Option A: class code (no IT needed)

Set three variables on the service and you're done:

```
CLASS_CODE=Builders Club
INSTRUCTOR_CODE=<a private code only you use>
SESSION_SECRET=<openssl rand -hex 32>
```

Students go to the site, type the class code and their name, and start working. You sign in the same way but with `INSTRUCTOR_CODE` instead, which is what unlocks the student roster.

The class code is meant to be shared and isn't a secret. `INSTRUCTOR_CODE` is: treat it like a password, make it at least 10 characters, and keep it to yourself. If it ever leaks, changing it signs out every instructor session it granted. Wrong codes are rate-limited, so guessing is impractical.

What this does and doesn't give you: students keep separate progress and it takes two minutes to set up, but a name is the only proof of identity, so a student who types a classmate's name would open that classmate's worksheets. For a club worksheet app that is usually a fair trade; if it isn't for you, use Microsoft accounts below.

### Option B: school Microsoft accounts

#### 1. Register the app in Microsoft Entra ID

In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**:

- **Supported account types:** *Accounts in this organizational directory only* — single tenant, so only your school's accounts can sign in.
- **Redirect URI:** platform **Web**, value `https://YOUR-APP.up.railway.app/auth/callback`. You get the real domain in step 2; come back and set it then.
- After creating it, note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page.
- Under **Certificates & secrets** → **New client secret**, copy the secret **Value** (not the Secret ID — the value is shown only once).

If **New registration** is greyed out or you get an "insufficient privileges" error, your tenant doesn't let you do this and school IT has to. What to ask them for: *a single-tenant app registration for a web app, with redirect URI `https://OUR-URL/auth/callback`, and a client secret.* You need the tenant ID, client ID and secret value back.

### 2. Create the Railway service

1. New project → **Deploy from GitHub repo** → pick this repository.
2. **Settings → Networking → Generate Domain.** That URL is your `PUBLIC_BASE_URL`. Put `PUBLIC_BASE_URL/auth/callback` into the Entra redirect URI from step 1.
3. **Add a Volume** to the service and mount it at `/data`. Without it, every student's work is erased on the next deploy.
4. Leave the service at **1 replica**. Student work is files on that one volume, so a second replica would race on writes.

### 3. Set the variables

Copy what you need from [`.env.example`](.env.example). With a class code, the whole list is:

```
CLASS_CODE=Builders Club
INSTRUCTOR_CODE=<a private code only you use>
SESSION_SECRET=<openssl rand -hex 32>
ANTHROPIC_API_KEY=sk-ant-...
```

With Microsoft accounts, swap the two codes for:

```
MS_TENANT_ID=...
MS_CLIENT_ID=...
MS_CLIENT_SECRET=...
INSTRUCTOR_EMAILS=you@school.edu
PUBLIC_BASE_URL=https://YOUR-APP.up.railway.app
```

Railway sets `PORT`, `RAILWAY_VOLUME_MOUNT_PATH` and the public domain itself, so `PUBLIC_BASE_URL` is only needed for Microsoft sign-in or a custom domain. Redeploy after saving.

### 4. Check it

- `https://YOUR-APP.up.railway.app/healthz` returns `{"ok":true}`.
- Sign in as yourself — with `INSTRUCTOR_CODE`, or with a school account whose email is in `INSTRUCTOR_EMAILS`. Either way a **👥** button appears in the top bar.
- The deploy logs name the reviewer and the sign-in mode at boot, and print one line per AI call with its token counts — that is your running cost.

### The student roster

**👥** lists everyone who has signed in: steps done, XP, artifacts, and when they were last active. Click a row to read that student's worksheets exactly as they see them, read-only — nothing you do while viewing can change their work. The **⬇** button downloads any student's Builder file.

### Updating worksheets

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

- `/auth/dev?as=alex` signs in as a second student — useful for filling a roster.
- `/auth/dev?as=instructor` plus `INSTRUCTOR_EMAILS=instructor@dev.local` gives you the roster view.
- Add `ANTHROPIC_API_KEY=...` to test real reviews; without a key, reviews show a friendly "not set up yet" notice and everything else still works.
- Data lands in `./data/`, which git ignores.

Dev sign-in refuses to run if `MS_CLIENT_ID` is set or `NODE_ENV=production`, so it cannot be reached on a deployed site.

---

## Configuration reference

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `4321` | Server port. Railway sets this. |
| `PUBLIC_BASE_URL` | Railway's domain | Public https origin. Builds the Microsoft redirect URI and decides whether cookies are `Secure`. Filled in from `RAILWAY_PUBLIC_DOMAIN` on Railway. |
| `SESSION_SECRET` | — | Signs session cookies. Required in production; changing it signs everyone out. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts. |
| `CLASS_CODE` | — | The code students type to sign in. Setting it enables class-code sign-in. |
| `INSTRUCTOR_CODE` | — | Your private code; signing in with it opens the roster. Required alongside `CLASS_CODE`, and must differ from it. |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | — | The Entra app registration. |
| `INSTRUCTOR_EMAILS` | empty | Comma-separated emails that get the roster, for Microsoft sign-in. Case-insensitive, re-read on every request. |
| `ANTHROPIC_API_KEY` | — | Enables the Claude engine. |
| `OPENAI_API_KEY` | — | Enables the Codex (OpenAI) engine. |
| `REVIEW_BACKEND` | `auto` | Default engine: `claude`, `codex`, or `auto`. Students can switch only when both keys are set. |
| `REVIEW_MODEL` | `claude-sonnet-5` | Anthropic model. |
| `OPENAI_MODEL` | `gpt-5.6-terra` | OpenAI model. |
| `REVIEW_MAX_TOKENS` / `DRAFT_MAX_TOKENS` | `32000` / `16000` | Output ceilings. Reviews stream, so a high ceiling is safe. |
| `AI_TIMEOUT_MS` | `300000` | Per-request timeout. |
| `AI_CONCURRENCY` | `4` | Simultaneous AI calls across all students; the rest queue. |
| `REVIEW_DAILY_CAP` | `60` | AI calls per student per day. `0` disables the cap. |
| `DATA_DIR` | volume, else `./data` | Where per-student JSON lives. |
| `ALLOW_DEV_LOGIN` | unset | `1` enables `/auth/dev` locally. Ignored in production. |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in bounces back with an error | The redirect URI on the Entra app must match `PUBLIC_BASE_URL/auth/callback` exactly. Check the deploy logs for the reason. |
| "Use the one your school gave you" | That was a personal Microsoft account. The app is single-tenant by design. |
| Reviews say the reviewer is unavailable | No API key set, a key that's invalid or out of credit, or that student hit `REVIEW_DAILY_CAP`. The logs say which. |
| A student's progress vanished after a deploy | The Volume isn't attached, or `DATA_DIR` points somewhere off it. Check the `data:` line in the boot log. |
| 👥 button missing | With a class code, you signed in with `CLASS_CODE` instead of `INSTRUCTOR_CODE`; sign out and back in. With Microsoft, that email isn't in `INSTRUCTOR_EMAILS`, which is re-read per request, so just reload after fixing it. |
| "That class code doesn't look right" | Check `CLASS_CODE` on the service. Capitals and extra spaces are ignored, so only the letters have to match. |
| A student can't find their work | They typed a different name than last time. Ask them exactly what they typed; the roster shows every name that has signed in. |
| Server won't start at all | It refuses to run with no sign-in configured. The boot log lists the three variables for each option. |
| Students see a spinner for a long time | Reviews are queued behind `AI_CONCURRENCY`. Raise it if your rate limits allow. |
| Someone wants a clean slate | ⚙ Settings → Danger zone → Hard reset. It only touches that one account. |

---

## How content works

All worksheet content — worksheets, sections, steps, video segments, rubrics, role-plays — lives in [`content.js`](content.js). **Adding a worksheet is config, not code.** Video segments reference YouTube IDs with `start`/`end` times; swap them freely.

The server ([`server.js`](server.js)) serves the static app and routes requests; the work is in [`lib/`](lib): `prompts.js` (the review persona and every prompt, as pure functions), `store.js` (per-student state, snapshots, profiles), `ai.js` (provider calls plus concurrency, single-flight and daily caps), and `auth.js` (Microsoft sign-in and signed session cookies). The front-end ([`public/app.js`](public/app.js)) is a hash-routed single-page app, no framework, no build step.
