#!/usr/bin/env bash
# Start the FastAPI backend (port 8000) and the Vite dev server (port 5173).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT

cd frontend && npm run dev -- --port 5173 --open
