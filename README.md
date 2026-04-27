# Project Management Board

A shared Kanban board for tracking concurrent projects between you and Claude. Flask backend, vanilla JS frontend, JSON file storage.

## Quick start

```bash
./start.sh           # start in background
./start.sh status    # check if running
./start.sh stop      # stop
./start.sh restart   # restart
```

The server runs at http://localhost:5001 and keeps running after you close the terminal. Logs go to `server.log`; the PID is in `server.pid`.

## Requirements

- Python 3 with the `venv` module
- `bash`

On Debian/Ubuntu:

```bash
sudo apt install python3 python3-venv
```

On Fedora/RHEL:

```bash
sudo dnf install python3
```

## Linux notes

`start.sh` already tries `xdg-open` before falling back to macOS `open`, so the browser auto-launches on both. `xdg-open` is provided by `xdg-utils` (preinstalled on most desktop distros; `sudo apt install xdg-utils` if missing).

The server is launched via `nohup ... &` and detached, so it survives closing the terminal. Use `./start.sh stop` to shut it down.

## Layout

- `backend/` — Flask app and JSON storage
- `frontend/` — vanilla JS Kanban UI
- `data/projects/` — one JSON file per project (created on first run)
- `CLAUDE.md` — context loaded by Claude Code at session start
- `SKILLS.md` — how an agent should interact with the board over HTTP

## Columns

Each project has these columns:

- **In Progress** — actively being worked on
- **Ready for Review** — agent finished, waiting for human to verify
- **Next** — queued for after current work
- **Later** — further out
- **Long Term** — someday/maybe
- **Recent** — recently completed, kept visible for context
- **Completed** — signed-off; can be selected for archive or delete

The intended flow is **In Progress → Ready for Review → Completed** (or back to In Progress if review surfaces issues).

## Adding projects

Click **+ New Project** in the UI. Agents should add/edit projects and cards through the HTTP API — see `SKILLS.md` for the full reference.
