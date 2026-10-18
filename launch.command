#!/bin/bash
# Double-click (macOS) to launch the HZIED research homepage with a local dev server.
# Without Node.js it falls back to the self-contained "HZIED Homepage.html".
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  if [ ! -d node_modules ]; then
    echo "First run: installing dependencies into ./node_modules …"
    npm install --cache "./.npm-cache" || { echo "npm install failed."; read -r -p "Press Enter to close."; exit 1; }
  fi
  echo "Serving the HZIED homepage at http://127.0.0.1:5173  (close this window or press Ctrl+C to stop)"
  npm run dev
else
  echo "Node.js not found — opening the prebuilt single-file homepage instead."
  open "HZIED Homepage.html"
fi
