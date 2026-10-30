#!/usr/bin/env bash
# DataVision AI — one-click start for Mac/Linux
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "[ERROR] Node.js not found. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
[ -d node_modules ] || { echo "[1/2] Installing dependencies (first run only)…"; npm install || exit 1; }
echo "[2/2] Starting server at http://localhost:3000  (admin@datavision.local / Admin@1234)"
node server/index.js
