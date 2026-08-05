#!/bin/zsh
# Builders Club — double-click to get the latest worksheets.
#
# Your work is never touched by this. Answers, XP and streaks live in data/,
# which git ignores completely — updating only replaces the worksheet files.
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-4321}"
URL="http://localhost:$PORT"

finish() {
  echo
  read "?Press return to close…"
  exit "${1:-0}"
}

if ! command -v git > /dev/null 2>&1; then
  echo "git isn't installed, so this folder can't update itself."
  echo "Install git (or Xcode Command Line Tools) and try again."
  finish 1
fi

# A ZIP download has no git history — there is nothing to pull from.
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "This folder was downloaded as a ZIP, so it can't update itself."
  echo
  echo "To fix it once and for all, clone the repo instead:"
  echo "  git clone https://github.com/1729-Learning/Builders-Club-Worksheets.git"
  echo
  echo "Then copy your data/ folder from THIS folder into the new one to keep your work."
  finish 1
fi

echo "Checking for new worksheets…"
echo

BEFORE=$(git rev-parse HEAD)

# --autostash tucks away any local edits (someone poking at content.js) and puts
# them back afterwards, so a curious student never hits a merge conflict here.
# Git's own chatter is held back and only shown if something goes wrong.
if ! PULL_LOG=$(git pull --rebase --autostash 2>&1); then
  echo "$PULL_LOG"
  echo
  echo "Couldn't update. The two usual reasons:"
  echo "  • no internet right now — reconnect and double-click this again"
  echo "  • you changed a worksheet file in a way git can't reconcile"
  echo
  echo "Your work in data/ is safe either way. Ask an instructor if it keeps failing."
  finish 1
fi

AFTER=$(git rev-parse HEAD)

if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "Already up to date — you have the latest version."
else
  echo "Updated. What changed:"
  git log --oneline --no-decorate "$BEFORE..$AFTER" | sed 's/^/  • /'
  echo
  echo "Your answers, XP and streak are untouched."
fi

echo
echo "Now on version: $(git rev-parse --short HEAD) ($(git log -1 --format=%cd --date=short))"
echo

# The server reads the worksheet content once at boot, so a running copy keeps
# serving the OLD rubrics until it restarts. Restart it for them, in this same
# window — that inherits any PORT override and avoids a second Terminal.
if curl -s --max-time 2 "$URL/api/settings" > /dev/null 2>&1; then
  echo "Restarting the worksheets so the update takes effect…"
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
  [[ -n "$PIDS" ]] && kill $PIDS 2>/dev/null
  for i in {1..20}; do
    curl -s --max-time 1 "$URL/api/settings" > /dev/null 2>&1 || break
    sleep 0.5
  done
  echo
  exec ./"Start Worksheets.command"
fi

echo "Double-click \"Start Worksheets\" when you're ready to work."
finish 0
