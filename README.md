# Builders Club — Semester Worksheets

Interactive semester worksheets for Builders Club, with **AI review** built in. Students work through scaffolded chains of journals, gated video segments, and exercises; each worksheet builds on top of the previous ones allowing for a cohesive experience.

![Worksheet hub](docs/screenshots/hub.png)

Every submission is reviewed against the step's rubric by **Claude** (Anthropic) or **Codex** (OpenAI). It runs as a website, so:

- **Students install nothing.** They open a link and sign in with their school Microsoft account.
- **One set of API keys.** The instructor sets them once on the server; students never see or need a key.
- **No database.** Each student's progress is a JSON file on a persistent disk.

---

## For students

1. Open the link your instructor gave you.
2. Click **Sign in with your school account** and use your normal school email and password.
3. Work through the sections.

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

You need a Microsoft Entra ID app registration (for sign-in), a Railway project (to host it), and at least one AI API key.

### 1. Register the app in Microsoft Entra ID

In the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**:

- **Supported account types:** *Accounts in this organizational directory only* — single tenant, so only your school's accounts can sign in.
- **Redirect URI:** platform **Web**, value `https://YOUR-APP.up.railway.app/auth/callback`. You get the real domain in step 2; come back and set it then.
- After creating it, note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page.
- Under **Certificates & secrets** → **New client secret**, copy the secret **Value** (not the Secret ID — the value is shown only once).

### 2. Create the Railway service

1. New project → **Deploy from GitHub repo** → pick this repository.
2. **Settings → Networking → Generate Domain.** That URL is your `PUBLIC_BASE_URL`. Put `PUBLIC_BASE_URL/auth/callback` into the Entra redirect URI from step 1.
3. **Add a Volume** to the service and mount it at `/data`. Without it, every student's work is erased on the next deploy.
4. Leave the service at **1 replica**. Student work is files on that one volume, so a second replica would race on writes.

### 3. Set the variables

Copy what you need from [`.env.example`](.env.example). At a minimum:

```
PUBLIC_BASE_URL=https://YOUR-APP.up.railway.app
SESSION_SECRET=<openssl rand -hex 32>
MS_TENANT_ID=...
MS_CLIENT_ID=...
MS_CLIENT_SECRET=...
INSTRUCTOR_EMAILS=you@school.edu
ANTHROPIC_API_KEY=sk-ant-...
```

Railway sets `PORT` and `RAILWAY_VOLUME_MOUNT_PATH` itself. Redeploy after saving.

### 4. Check it

- `https://YOUR-APP.up.railway.app/healthz` returns `{"ok":true}`.
- Sign in with your own school account. Because your email is in `INSTRUCTOR_EMAILS`, a **👥** button appears in the top bar.
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
| `PUBLIC_BASE_URL` | — | Public https origin. Builds the Microsoft redirect URI and decides whether cookies are `Secure`. Required in production. |
| `SESSION_SECRET` | — | Signs session cookies. Required in production; changing it signs everyone out. |
| `SESSION_DAYS` | `30` | How long a sign-in lasts. |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | — | The Entra app registration. |
| `INSTRUCTOR_EMAILS` | empty | Comma-separated emails that get the roster. Case-insensitive, re-read on every request. |
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
| 👥 button missing | That email isn't in `INSTRUCTOR_EMAILS`. It's re-read per request, so just reload after fixing it. |
| Students see a spinner for a long time | Reviews are queued behind `AI_CONCURRENCY`. Raise it if your rate limits allow. |
| Someone wants a clean slate | ⚙ Settings → Danger zone → Hard reset. It only touches that one account. |

---

## How content works

All worksheet content — worksheets, sections, steps, video segments, rubrics, role-plays — lives in [`content.js`](content.js). **Adding a worksheet is config, not code.** Video segments reference YouTube IDs with `start`/`end` times; swap them freely.

The server ([`server.js`](server.js)) serves the static app and routes requests; the work is in [`lib/`](lib): `prompts.js` (the review persona and every prompt, as pure functions), `store.js` (per-student state, snapshots, profiles), `ai.js` (provider calls plus concurrency, single-flight and daily caps), and `auth.js` (Microsoft sign-in and signed session cookies). The front-end ([`public/app.js`](public/app.js)) is a hash-routed single-page app, no framework, no build step.
