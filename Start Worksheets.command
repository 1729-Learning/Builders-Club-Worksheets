#!/bin/zsh
# Builders Club — double-click to start the worksheets and open them in your browser.
# Leave the window that opens alone while you work; closing it stops the server.
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-4321}"
URL="http://localhost:$PORT"

# Already running? Just open the page — starting a second one would fail on the port.
if curl -s --max-time 2 "$URL/api/settings" > /dev/null 2>&1; then
  echo "Worksheets are already running — opening the page."
  open "$URL"
  exit 0
fi

if ! command -v node > /dev/null 2>&1; then
  echo "Node.js isn't installed yet."
  echo "Install the LTS version from https://nodejs.org, then double-click this again."
  echo
  read "?Press return to close…"
  exit 1
fi

echo "Starting Builders Club worksheets…"

# Open the browser as soon as the server answers, so students don't stare at a
# blank page waiting for boot.
open_when_ready() {
  for i in {1..30}; do
    if curl -s --max-time 1 "$URL/api/settings" > /dev/null 2>&1; then
      open "$URL"
      return
    fi
    sleep 0.5
  done
}
open_when_ready &

echo "(leave this window open while you work — close it or press Ctrl-C to stop)"
exec node server.js
