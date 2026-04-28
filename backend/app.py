import json
import os
import re
import uuid
from datetime import datetime
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

LOCALHOST_ADDRS = {"127.0.0.1", "::1"}


@app.before_request
def restrict_writes_to_localhost():
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if request.remote_addr not in LOCALHOST_ADDRS:
        abort(403)

DATA_DIR = os.path.join(os.path.dirname(__file__), "../data")
PROJECTS_INDEX = os.path.join(DATA_DIR, "projects.json")
PROJECTS_DIR = os.path.join(DATA_DIR, "projects")
ARCHIVED_INDEX = os.path.join(DATA_DIR, "archived_projects.json")
ARCHIVED_DIR = os.path.join(DATA_DIR, "archived")

COLUMNS = ["in_progress", "ready_for_review", "next", "later", "long_term", "recent", "completed"]


def load_json(path):
    with open(path) as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def slugify(name):
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "project"


def _init_storage():
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    os.makedirs(ARCHIVED_DIR, exist_ok=True)
    if not os.path.exists(PROJECTS_INDEX):
        save_json(PROJECTS_INDEX, [])
    if not os.path.exists(ARCHIVED_INDEX):
        save_json(ARCHIVED_INDEX, [])


_init_storage()


def load_project(project_id):
    path = os.path.join(PROJECTS_DIR, f"{project_id}.json")
    if not os.path.exists(path):
        return None
    project = load_json(path)
    project.setdefault("columns", {})
    for col in COLUMNS:
        project["columns"].setdefault(col, [])
    return project


def save_project(project):
    project["last_updated"] = datetime.now().isoformat()[:10]
    path = os.path.join(PROJECTS_DIR, f"{project['id']}.json")
    save_json(path, project)


def update_index(project):
    index = load_json(PROJECTS_INDEX)
    entry = {"id": project["id"], "name": project["name"], "status": project["status"]}
    existing = next((i for i, p in enumerate(index) if p["id"] == project["id"]), None)
    if existing is not None:
        index[existing] = entry
    else:
        index.append(entry)
    save_json(PROJECTS_INDEX, index)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/projects", methods=["GET"])
def list_projects():
    return jsonify(load_json(PROJECTS_INDEX))


@app.route("/api/activity", methods=["GET"])
def activity():
    since = request.args.get("since")  # YYYY-MM-DD, optional
    result = []
    for entry in load_json(PROJECTS_INDEX):
        project = load_project(entry["id"])
        if not project:
            continue
        sources = list(project["columns"].get("completed", []))
        sources.extend(project.get("archived", []))
        for c in sources:
            ts = c.get("completed_at")
            if not ts:
                continue
            if since and ts[:10] < since:
                continue
            result.append({
                "completed_at": ts,
                "project_id": project["id"],
                "project_name": project["name"],
                "card_id": c["id"],
                "title": c["title"],
                "tags": c.get("tags", []),
            })
    result.sort(key=lambda r: r["completed_at"], reverse=True)
    return jsonify(result)


def _column_overview(column):
    result = []
    for entry in load_json(PROJECTS_INDEX):
        project = load_project(entry["id"])
        if not project:
            continue
        cards = project["columns"].get(column, [])
        if cards:
            result.append({
                "project_id": project["id"],
                "project_name": project["name"],
                "cards": cards,
            })
    return result


@app.route("/api/review-queue", methods=["GET"])
def review_queue():
    return jsonify(_column_overview("ready_for_review"))


@app.route("/api/in-progress", methods=["GET"])
def in_progress():
    return jsonify(_column_overview("in_progress"))


@app.route("/api/column-overview/<column>", methods=["GET"])
def column_overview(column):
    if column not in COLUMNS:
        return jsonify({"error": "invalid column"}), 400
    return jsonify(_column_overview(column))


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.json
    project_id = slugify(data["name"])
    project = {
        "id": project_id,
        "name": data["name"],
        "description": data.get("description", ""),
        "repo": data.get("repo", ""),
        "status": "active",
        "last_updated": datetime.now().isoformat()[:10],
        "columns": {col: [] for col in COLUMNS},
        "notes": "",
        "session_log": [],
    }
    save_project(project)
    update_index(project)
    return jsonify(project), 201


@app.route("/api/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    return jsonify(project)


@app.route("/api/projects/<project_id>", methods=["PUT"])
def update_project(project_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    data = request.json
    for field in ["name", "description", "repo", "status", "notes"]:
        if field in data:
            project[field] = data[field]
    save_project(project)
    update_index(project)
    return jsonify(project)


@app.route("/api/projects/<project_id>", methods=["DELETE"])
def delete_project(project_id):
    path = os.path.join(PROJECTS_DIR, f"{project_id}.json")
    if os.path.exists(path):
        os.remove(path)
    index = load_json(PROJECTS_INDEX)
    index = [p for p in index if p["id"] != project_id]
    save_json(PROJECTS_INDEX, index)
    return jsonify({"ok": True})


@app.route("/api/projects/<project_id>/archive-project", methods=["POST"])
def archive_project(project_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404

    project["archived_date"] = datetime.now().isoformat()[:10]

    # Move JSON to archived dir
    archived_path = os.path.join(ARCHIVED_DIR, f"{project_id}.json")
    save_json(archived_path, project)

    # Remove from active
    active_path = os.path.join(PROJECTS_DIR, f"{project_id}.json")
    if os.path.exists(active_path):
        os.remove(active_path)

    # Update indexes
    active_index = load_json(PROJECTS_INDEX)
    save_json(PROJECTS_INDEX, [p for p in active_index if p["id"] != project_id])

    archived_index = load_json(ARCHIVED_INDEX)
    archived_index.insert(0, {
        "id": project["id"],
        "name": project["name"],
        "archived_date": project["archived_date"],
    })
    save_json(ARCHIVED_INDEX, archived_index)

    return jsonify({"ok": True})


@app.route("/api/archived-projects", methods=["GET"])
def list_archived_projects():
    return jsonify(load_json(ARCHIVED_INDEX))


@app.route("/api/archived-projects/<project_id>/restore", methods=["POST"])
def restore_project(project_id):
    archived_path = os.path.join(ARCHIVED_DIR, f"{project_id}.json")
    if not os.path.exists(archived_path):
        return jsonify({"error": "not found"}), 404

    project = load_json(archived_path)
    project.pop("archived_date", None)

    save_json(os.path.join(PROJECTS_DIR, f"{project_id}.json"), project)
    os.remove(archived_path)

    archived_index = load_json(ARCHIVED_INDEX)
    save_json(ARCHIVED_INDEX, [p for p in archived_index if p["id"] != project_id])

    update_index(project)
    return jsonify(project)


@app.route("/api/projects/<project_id>/columns/<column>/reorder", methods=["PUT"])
def reorder_column(project_id, column):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    if column not in COLUMNS:
        return jsonify({"error": "invalid column"}), 400
    desired = request.json.get("card_ids", [])
    by_id = {c["id"]: c for c in project["columns"].get(column, [])}
    new_order = [by_id[i] for i in desired if i in by_id]
    leftovers = [c for c in project["columns"].get(column, []) if c["id"] not in set(desired)]
    project["columns"][column] = new_order + leftovers
    save_project(project)
    return jsonify(project["columns"][column])


@app.route("/api/projects/<project_id>/cards", methods=["POST"])
def add_card(project_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    data = request.json
    column = data.get("column", "next")
    card = {
        "id": str(uuid.uuid4())[:8],
        "title": data["title"],
        "description": data.get("description", ""),
        "plan_path": data.get("plan_path", ""),
        "due_date": data.get("due_date", ""),
        "created": datetime.now().isoformat()[:10],
        "tags": data.get("tags", []),
    }
    if column == "completed":
        card["completed_at"] = datetime.now().isoformat(timespec="seconds")
    project["columns"][column].append(card)
    save_project(project)
    return jsonify(card), 201


@app.route("/api/projects/<project_id>/cards/<card_id>", methods=["PUT"])
def update_card(project_id, card_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    data = request.json
    for col, cards in project["columns"].items():
        for card in cards:
            if card["id"] == card_id:
                for field in ["title", "description", "tags", "plan_path", "due_date"]:
                    if field in data:
                        card[field] = data[field]
                # move to different column if requested
                if "column" in data and data["column"] != col:
                    new_col = data["column"]
                    project["columns"][col].remove(card)
                    if new_col == "completed":
                        card["completed_at"] = datetime.now().isoformat(timespec="seconds")
                    elif col == "completed":
                        card.pop("completed_at", None)
                    project["columns"][new_col].append(card)
                save_project(project)
                return jsonify(card)
    return jsonify({"error": "card not found"}), 404


@app.route("/api/projects/<project_id>/cards/<card_id>", methods=["DELETE"])
def delete_card(project_id, card_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    for col, cards in project["columns"].items():
        project["columns"][col] = [c for c in cards if c["id"] != card_id]
    save_project(project)
    return jsonify({"ok": True})


@app.route("/api/projects/<project_id>/archive", methods=["POST"])
def archive_cards(project_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    card_ids = set(request.json.get("card_ids", []))
    archived = project.setdefault("archived", [])
    archived_date = datetime.now().isoformat()[:10]
    moved = []
    for col, cards in project["columns"].items():
        to_keep, to_archive = [], []
        for c in cards:
            (to_archive if c["id"] in card_ids else to_keep).append(c)
        project["columns"][col] = to_keep
        for c in to_archive:
            c["archived_date"] = archived_date
            archived.append(c)
            moved.append(c)
    archived.sort(key=lambda c: c.get("archived_date", ""), reverse=True)
    save_project(project)
    return jsonify(moved)


@app.route("/api/projects/<project_id>/log", methods=["POST"])
def add_session_log(project_id):
    project = load_project(project_id)
    if not project:
        return jsonify({"error": "not found"}), 404
    entry = {
        "date": datetime.now().isoformat()[:10],
        "summary": request.json.get("summary", ""),
    }
    project["session_log"].insert(0, entry)
    project["session_log"] = project["session_log"][:50]  # keep last 50 entries
    save_project(project)
    return jsonify(entry), 201


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
