#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Attempting best-effort installation..."
  if command -v brew >/dev/null 2>&1; then
    brew install node || true
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y nodejs npm || true
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm || true
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nodejs npm || true
  fi
fi

if command -v node >/dev/null 2>&1; then
  node ./start-uare.mjs
else
  echo "Node.js could not be installed automatically."
  echo "Install Node.js LTS, then run this launcher again."
  exit 1
fi
