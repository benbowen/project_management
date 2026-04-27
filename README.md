# Project Management Board

A shared Kanban board for tracking concurrent projects between you and Claude. Flask backend, vanilla JS frontend, JSON file storage.

## Quick start

```bash
./start.sh
```

The server runs at http://localhost:5001.

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

`start.sh` runs on Linux as-is, but the `open` command on line 17 is macOS-only. The script swallows the error and Flask still starts — you just need to open http://localhost:5001 manually.

To auto-open the browser on Linux, replace line 17 with:

```bash
(xdg-open http://localhost:5001 || open http://localhost:5001) >/dev/null 2>&1 &
```

`xdg-open` is provided by `xdg-utils` (preinstalled on most desktop distros; `sudo apt install xdg-utils` if missing).

## Layout

- `backend/` — Flask app and JSON storage
- `frontend/` — vanilla JS Kanban UI
- `data/projects/` — one JSON file per project (created on first run)
- `CLAUDE.md` — context loaded by Claude Code at session start

## Adding projects

Click **+ New Project** in the UI, or have Claude write the JSON directly — see `CLAUDE.md` for the schema.
