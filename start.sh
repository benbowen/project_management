#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

# Install/update dependencies
venv/bin/pip install -q -r backend/requirements.txt

# Start Flask
echo "Starting server at http://localhost:5001"
open http://localhost:5001 2>/dev/null || true
FLASK_APP=backend/app.py venv/bin/python backend/app.py
