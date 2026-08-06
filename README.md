# Builders Club — Semester Worksheets

Interactive semester worksheets for Builders Club, with **real AI review** built in. Students work through scaffolded chains of journals, gated video segments, and exercises; each worksheet builds toward final artifacts they earn along the way:

- **Build Your MVP Plan** — problem statement → user needs & market gap → features → MVP plan
- **Work With AI** — when to use AI → context & the email assistant → specs → shipping safely

![Worksheet hub](docs/screenshots/hub.png)

The AI feedback is not canned — every submission is reviewed against the step's rubric by a real model, running through an agent CLI already installed and logged in on your machine: **Codex** (OpenAI) or **Claude Code** (Anthropic). That means:

- **No API keys.** No `.env` files, no keys to buy or rotate.
- **No accounts to create.** It reuses the ChatGPT or Claude login you already have.
- **No database.** Student progress is a single JSON file on disk.

---

## What you need

| Requirement | Why | Get it |
|---|---|---|
| **Node.js 18+** | Runs the local server (no dependencies to install) | [nodejs.org](https://nodejs.org) — download the LTS installer |
| **Codex CLI** *and/or* **Claude Code** | Powers the AI reviews | Setup steps below |

You only need **one** of the two CLIs. If you have both, the app lets you switch between them in Settings.

Check whether you already have Node:

```bash
node --version
```

If that prints `v18` or higher, you're set.

---

## Step 1 — Download the worksheet demo

**Clone it — don't download the ZIP:**

```bash
git clone https://github.com/1729-Learning/Builders-Club-Worksheets.git
cd Builders-Club-Worksheets
```

Worksheets get fixed and added to during the semester, and a cloned folder can update itself in one double-click while keeping all your work (see [Getting updates](#getting-updates)). A ZIP can't — you'd have to re-download the whole thing into a new folder and move your progress across by hand.

<details>
<summary>No git installed?</summary>

On macOS, run `git --version` once and the system offers to install the Command Line Tools for you. Otherwise get it from [git-scm.com](https://git-scm.com).

If you truly can't use git, the ZIP works for running the worksheets: green **Code** button → **Download ZIP**, unzip, and open a terminal in the unzipped folder (on macOS: right-click the folder → *New Terminal at Folder*). Just know that updating later means downloading a fresh ZIP and copying your `data/` folder into it.
</details>

---

## Step 2 — Set up an AI reviewer

Pick one (or do both — the app auto-detects what's installed).

### Option A: Codex (recommended — ~4× faster per review)

Codex is OpenAI's agent CLI. It signs in with a regular **ChatGPT account** (Plus/Pro/Team). Docs: [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)

1. Install it:

```bash
npm install -g @openai/codex
```

2. Sign in (opens your browser — choose **Sign in with ChatGPT**):

```bash
codex
```

3. Verify it works:

```bash
codex --version
```

### Option B: Claude Code

Claude Code is Anthropic's agent CLI. It signs in with a **Claude account** (Pro/Max). Docs: [claude.com/claude-code](https://claude.com/claude-code) · [setup guide](https://docs.claude.com/en/docs/claude-code/setup)

1. Install it:

```bash
npm install -g @anthropic-ai/claude-code
```

2. Start it once and follow the browser login prompt:

```bash
claude
```

3. Verify it works:

```bash
claude --version
```

> **Tip:** installing both is genuinely useful — reviews fail over gracefully, and you can compare feedback quality between engines from the Settings page without touching a terminal.

---

## Step 3 — Run it

**Double-click `Start Worksheets.command`** in the `Builders-Club-Worksheets` folder. It starts the server and opens the page for you. Leave the window it opens alone while you work — closing it stops the worksheets.

<details>
<summary>macOS says it can't open the file / "unidentified developer"</summary>

The first time only: right-click `Start Worksheets.command` → **Open** → **Open** again. macOS remembers after that.
</details>

Prefer a terminal? Same thing by hand, from the same folder:

```bash
node server.js
```

Either way, open **http://localhost:4321** in your browser.

The startup log tells you which reviewer it found and which one it's using. If no CLI is detected, the app still runs — AI reviews just show a friendly "reviewer is offline" notice until you finish Step 2.

---

## Step 4 — Choose your review engine

Click the **⚙ gear** in the top-right of the app. The Settings page shows which engines are installed and lets you switch instantly — no restart needed. Your choice persists in `data/settings.json`.

![Settings page — choosing between Codex and Claude Code](docs/screenshots/settings.png)

- **Codex** — about 15s per review.
- **Claude Code** — about 60s per review.
- Until you pick one, it uses Codex when installed (it's much faster), otherwise Claude Code.

Settings also controls **progression**: *Guided* (sections unlock in order — the default classroom experience) vs *Free roam* (everything unlocked, any order).

---

## Using the worksheets

![A worksheet step with a gated video segment](docs/screenshots/step.png)

- **Video steps** play a specific segment and gate progress on actually watching it.
- **Exercise steps** are reviewed by the AI against that step's rubric — Socratic hints and questions only, never rewritten answers, never grades.
- **Journal steps** are private reflections; the AI can reference them later to connect ideas.
- Finished sections mint **artifacts** — the tangible outputs (problem statement, MVP plan, …) that carry into next semester.

Progress, XP, and streaks live in `data/state.json`. Delete that file to reset everything to a fresh student.

---

## Getting updates

Worksheets get corrected, expanded, and re-cut during the semester. To pick up the latest version:

**Double-click `Update Worksheets.command`.** That's it.

It tells you what changed, and if the worksheets are running it restarts them so the update actually takes effect. Then double-click `Start Worksheets.command` and carry on.

**Your work is never at risk.** Everything you've written — answers, artifacts, XP, streak — lives in the `data/` folder, which git ignores completely. Updating only replaces the worksheet files themselves. There is nothing to back up and nothing to migrate.

You can also do it by hand if you prefer:

```bash
git pull --rebase --autostash
```

Then restart the server. **The restart matters:** the server loads the rubrics once at boot, so a running copy keeps reviewing against the old ones until you restart it. `Update Worksheets.command` handles that for you.

<details>
<summary>Instructor note — editing content while students are mid-worksheet</summary>

Progress is keyed by **id** (`"sectionId/stepId"`), stored separately from content, so most edits land safely on a student who's halfway through. Free to change any time: prompts, placeholders, rubrics, lesson panels, reviewer notes, titles, videos and their timestamps, week chips, `buildsOn`, resources — plus adding steps, sections or whole worksheets, and reordering steps.

Three edits orphan saved work, so avoid them once a cohort has started:

1. **Renaming a step or section `id`.** The answer stays in `state.json` but nothing looks for it, and the step reads as untouched. Change titles freely; treat ids as permanent. (`pick-top-5` keeps that id even though it now says "top 3" — that's the pattern.)
2. **Deleting a step or section** that students have answered.
3. **Converting a step to or from a `board`.** Text and list answers share one string field, so textarea ↔ list is safe; boards use a separate field and won't show the old answer. Raising a `min` or `minPerSide` can also make an already-passed step fail on redo.
</details>

---

## Configuration reference

All optional — the defaults just work.

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `4321` | Server port |
| `REVIEW_BACKEND` | `auto` | `codex`, `claude`, or `auto`. The ⚙ Settings page overrides this and persists to `data/settings.json`. |
| `REVIEW_MODEL` | `haiku` | Claude backend model (`haiku` = fast, `sonnet` = smarter) |
| `CODEX_MODEL` | CLI default | Codex backend model override (e.g. `gpt-5.1-codex-mini`) |

Example:

```bash
PORT=5000 REVIEW_BACKEND=claude REVIEW_MODEL=sonnet node server.js
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Reviews say "the AI reviewer is offline" | The active engine's CLI isn't installed or isn't logged in. Run `codex --version` / `claude --version` to check, re-run the sign-in from Step 2, or switch engines in ⚙ Settings. |
| `node: command not found` | Install Node.js from [nodejs.org](https://nodejs.org), then reopen your terminal. |
| macOS won't open a `.command` file | First time only: right-click it → **Open** → **Open**. |
| Port 4321 already in use | Run with another port: `PORT=5000 node server.js` |
| `Update Worksheets` says the folder was downloaded as a ZIP | A ZIP has no git history to update from. Clone the repo instead (Step 1), then copy your old `data/` folder into the new one to keep your work. |
| Update ran but the worksheets look unchanged | Restart the server — `Update Worksheets.command` does this automatically, but a manual `git pull` doesn't. |
| Want a clean slate | Stop the server and delete `data/state.json`. |
| Reviews feel slow | Switch to Codex in ⚙ Settings (~15s vs ~60s), or keep working — reviews run in the background per step. |

---

## How content works

All worksheet content — worksheets, sections, steps, video segments, rubrics, role-plays — lives in [`content.js`](content.js). **Adding a worksheet is config, not code.** Video segments reference YouTube IDs with `start`/`end` times; swap them freely.

The server ([`server.js`](server.js)) is a single dependency-free Node file: it serves the static app, persists state, and shells out to the chosen CLI for reviews. The front-end ([`public/app.js`](public/app.js)) is a hash-routed single-page app, no framework, no build step.
