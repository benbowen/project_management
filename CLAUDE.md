# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted Kanban board for coordinating work between the user and Claude across many concurrent projects. Flask serves a vanilla-JS UI and a JSON HTTP API; project state lives in `data/` as one JSON file per project.

This app has a dual identity: it **is** a codebase you may be editing, **and** it is a runtime tool that tracks work for *other* projects on the same machine (server at `http://localhost:5001`). Keep them separate when reasoning about a request — "add a feature" usually means editing `backend/app.py` or `frontend/app.js`; "add a card" means hitting the running server's API.

## Running it

```bash
./start.sh           # start in background; creates venv on first run, opens browser
./start.sh status
./start.sh stop
./start.sh restart   # required after backend changes (Flask is launched detached, no auto-reload)
```

Server logs go to `server.log`; PID lives in `server.pid`. Frontend changes (HTML/CSS/JS) take effect on browser refresh — no rebuild. There are no tests, no linter, no build step.

## Editing data

On-disk layout:
- `data/projects.json` — index of active projects (id, name, status)
- `data/projects/<id>.json` — full project (cards, columns, archived, session log, notes)
- `data/archived_projects.json` and `data/archived/<id>.json` — archived projects

**Do not edit these JSON files by hand while the server is running.** The browser holds the project in memory and writes it back on the next mutation, silently overwriting external edits. To change board state from an agent, go through the HTTP API in `SKILLS.md` (or use the `project-management-board` skill that wraps it). Direct file edits are only safe when the server is stopped.

## Architecture

**Backend** (`backend/app.py`, single file ~370 lines): Flask + flask-cors, no blueprints, no ORM. Every route is "load JSON → mutate → save JSON". There's no locking — the server assumes itself as the sole writer, so concurrent agents racing `PUT`s against the same project will lose updates.

**Frontend** (`frontend/`, no build step): one HTML, one CSS, one JS file (~950 lines). `app.js` is a single-file SPA with module-level globals (`projects`, `currentProject`, `selectedCards`); it does not poll, it re-fetches on user action through the `api()` helper.

**Column enum is duplicated.** The valid column list lives in two places that must be kept in sync:
- `backend/app.py` → `COLUMNS` (server-side validation, source of truth)
- `frontend/app.js` → hard-coded `cols` array inside `renderProject()` and the column-id strings used throughout the UI

Adding, removing, or renaming a column requires touching both, plus `frontend/index.html` (column markup) and likely `frontend/style.css`.

**Card lifecycle.** Intended flow: `in_progress → ready_for_review → completed`. The server stamps `completed_at` when a card transitions *into* `completed` and clears it on transition *out* (see `update_card` in `app.py`). The cross-project endpoints `/api/activity` and `/api/review-queue` depend on this — older cards completed before `completed_at` existed are silently skipped from date-filtered activity queries.

**IDs are server-assigned.** Card ids come from `uuid.uuid4()[:8]` in `add_card`; project ids are slugified from `name` (`slugify` in `app.py`). Never set either client-side.

**Cross-project views** (`/api/review-queue`, `/api/in-progress`, `/api/column-overview/<column>`, `/api/activity`) iterate every project file on each request — fine at this scale, would need indexing if project count grows large.

## Agent integration

`SKILLS.md` is the canonical reference for driving the board over HTTP. Read it before adding, moving, or archiving cards. Prefer the `project-management-board` skill (wraps the API) over raw `curl` when it's available.

When you finish a unit of work, append a `session_log` entry via `POST /api/projects/<id>/log` — that one-line summary is what gives the next session context.

---

<!-- BOARD-STATE: auto-generated below this line. Regenerate from the board, do not edit by hand. -->

## Project

**Description:** Shared Kanban board for tracking 5+ concurrent projects between human and Claude. Flask backend, vanilla JS frontend, JSON file storage.
**Repo:** ~/repos/project_management
**Last updated:** 2026-04-27

## Currently In Progress

### Write a CLAUDE.md for tasks in progress
Make a button that generates instructions for Claude for all "In Progress" tasks for a specific project.  Pay attention to the fact that this is a project level button.  It only generates tasks for a project.
_Tags: ai-integration_

## Up Next

### Add your real projects
Use '+ New Project' to add each of your active projects. Populate In Progress, Next, and Notes for each one.
_Tags: onboarding_

## Recent Session Log

- **2026-04-26**: Added project-level archive/restore. Fixed modal cancel button (missing flex layout on panel divs). Claude created this project entry directly via JSON. Next: write CLAUDE.md to auto-load project context at session start, then add real projects.
- **2026-04-26**: Added Completed column with multi-select checkboxes. Archive (N) preserves cards in archived section; Delete (N) removes permanently and auto-logs what was deleted.
- **2026-04-26**: Initial scaffolding: Flask backend serving vanilla JS Kanban board. Columns: In Progress, Next, Later, Long Term, Recent, Completed. JSON file storage per project.
