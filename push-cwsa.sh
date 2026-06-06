#!/usr/bin/env bash
# Push Can We Start Again? changes — code + event images
# Usage: bash push-cwsa.sh "optional commit message"
set -e

MSG="${1:-"Update Can We Start Again: content, timetable, events, and images"}"

# ── Pages & code ──────────────────────────────────────────────────────────────
git add can-we-start-again/index.html
git add styles/can-we-start-again.css
git add scripts/cwsa-events.js
git add scripts/can-we-start-again.js

# ── Event data ────────────────────────────────────────────────────────────────
git add json/schema.json

# ── Images — posters and event photos under CanWeStartAgain/ ─────────────────
# Poster images sit directly in assets/CanWeStartAgain/
# Event photo sets go in  assets/CanWeStartAgain/Events/<EventName>/
git add assets/CanWeStartAgain/

# ── Commit & push ─────────────────────────────────────────────────────────────
git diff --cached --quiet && { echo "Nothing staged — nothing to push."; exit 0; }

git commit -m "$MSG"
git push origin main

echo "Done."
