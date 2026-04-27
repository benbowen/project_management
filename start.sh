#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

PID_FILE="server.pid"
LOG_FILE="server.log"
URL="http://localhost:5001"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "Server already running (PID $(cat "$PID_FILE")). Logs: $LOG_FILE"
    return 0
  fi

  if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
  fi
  venv/bin/pip install -q -r backend/requirements.txt

  echo "Starting server at $URL (logging to $LOG_FILE)"
  nohup venv/bin/python backend/app.py > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  disown 2>/dev/null || true

  (xdg-open "$URL" || open "$URL") >/dev/null 2>&1 &
  echo "Started (PID $(cat "$PID_FILE")). Stop with: $0 stop"
}

stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "Stopped."
  else
    echo "Not running."
    rm -f "$PID_FILE"
  fi
}

status() {
  if is_running; then
    echo "Running (PID $(cat "$PID_FILE")) at $URL"
  else
    echo "Not running."
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  *)       echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac
