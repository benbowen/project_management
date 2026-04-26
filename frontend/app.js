const API = "http://localhost:5001/api";

let projects = [];
let currentProject = null;
let editingCardId = null;
let editingCardCol = null;
let selectedCards = new Set();

// --- API helpers ---

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Load & render ---

async function loadProjects() {
  projects = await api("GET", "/projects");
  renderTabs();
  if (projects.length === 0) {
    show("empty-state");
    hide("project-view");
  } else {
    const first = currentProject ? projects.find(p => p.id === currentProject.id) : null;
    await selectProject((first || projects[0]).id);
  }
}

function renderTabs() {
  const tabs = document.getElementById("project-tabs");
  tabs.innerHTML = projects.map(p =>
    `<div class="tab ${currentProject?.id === p.id ? "active" : ""}" data-id="${p.id}">${p.name}</div>`
  ).join("");
  tabs.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => selectProject(t.dataset.id))
  );
}

async function selectProject(id) {
  currentProject = await api("GET", `/projects/${id}`);
  hide("empty-state");
  show("project-view");
  renderTabs();
  renderProject();
}

function renderProject() {
  const p = currentProject;
  document.getElementById("project-title").textContent = p.name;
  document.getElementById("project-repo").textContent = p.repo ? `📁 ${p.repo}` : "";
  document.getElementById("project-updated").textContent = `Updated ${p.last_updated}`;
  document.getElementById("project-description").textContent = p.description;
  document.getElementById("notes-area").value = p.notes || "";

  selectedCards.clear();
  updateDeleteSelectedBtn();

  const cols = ["in_progress", "next", "later", "long_term", "recent", "completed"];
  cols.forEach(col => {
    const el = document.getElementById(`col-${col}`);
    el.innerHTML = "";
    (p.columns[col] || []).forEach(card => {
      el.appendChild(makeCardEl(card, col));
    });
  });

  renderArchived(p.archived || []);

  const logList = document.getElementById("session-log-list");
  logList.innerHTML = (p.session_log || []).map(e =>
    `<div class="log-entry"><div class="log-date">${e.date}</div><div class="log-summary">${escHtml(e.summary)}</div></div>`
  ).join("");
}

function renderArchived(archived) {
  const section = document.getElementById("archived-section");
  const list = document.getElementById("archived-list");
  const count = document.getElementById("archived-count");
  if (archived.length === 0) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  count.textContent = `(${archived.length})`;
  list.innerHTML = archived.map(c => `
    <div class="archived-card">
      <div>${escHtml(c.title)}</div>
      <div class="archived-card-date">${c.archived_date || ""}</div>
    </div>
  `).join("");
}

function makeCardEl(card, col) {
  const div = document.createElement("div");

  if (col === "completed") {
    div.className = "card completed-card";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "card-checkbox";
    checkbox.checked = selectedCards.has(card.id);
    checkbox.addEventListener("click", e => {
      e.stopPropagation();
      toggleCardSelection(card.id, div, checkbox);
    });
    div.addEventListener("click", () => toggleCardSelection(card.id, div, checkbox));

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="card-title">${escHtml(card.title)}</div>
      ${card.description ? `<div class="card-desc">${escHtml(card.description)}</div>` : ""}
      ${card.tags?.length ? `<div class="card-tags">${card.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
    `;
    div.appendChild(checkbox);
    div.appendChild(body);
  } else {
    div.className = "card";
    div.innerHTML = `
      <div class="card-title">${escHtml(card.title)}</div>
      ${card.description ? `<div class="card-desc">${escHtml(card.description)}</div>` : ""}
      ${card.tags?.length ? `<div class="card-tags">${card.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
    `;
    div.addEventListener("click", () => openEditCard(card, col));
  }

  return div;
}

function toggleCardSelection(cardId, el, checkbox) {
  if (selectedCards.has(cardId)) {
    selectedCards.delete(cardId);
    el.classList.remove("selected");
    checkbox.checked = false;
  } else {
    selectedCards.add(cardId);
    el.classList.add("selected");
    checkbox.checked = true;
  }
  updateDeleteSelectedBtn();
}

function updateDeleteSelectedBtn() {
  const bulk = document.getElementById("bulk-actions");
  const delBtn = document.getElementById("btn-delete-selected");
  const archBtn = document.getElementById("btn-archive-selected");
  if (!bulk) return;
  if (selectedCards.size === 0) {
    bulk.classList.add("hidden");
  } else {
    bulk.classList.remove("hidden");
    delBtn.textContent = `Delete (${selectedCards.size})`;
    archBtn.textContent = `Archive (${selectedCards.size})`;
  }
}

async function archiveSelectedCards() {
  if (selectedCards.size === 0) return;
  await api("POST", `/projects/${currentProject.id}/archive`, { card_ids: [...selectedCards] });
  selectedCards.clear();
  currentProject = await api("GET", `/projects/${currentProject.id}`);
  renderProject();
}

async function deleteSelectedCards() {
  if (selectedCards.size === 0) return;

  // Collect titles before deleting for the auto-log
  const completed = currentProject.columns.completed || [];
  const titles = completed
    .filter(c => selectedCards.has(c.id))
    .map(c => c.title);

  if (!confirm(`Permanently delete ${selectedCards.size} card(s)? This cannot be undone.`)) return;

  await Promise.all([...selectedCards].map(id =>
    api("DELETE", `/projects/${currentProject.id}/cards/${id}`)
  ));

  // Auto-log what was deleted
  const summary = `Deleted ${titles.length} completed item(s): ${titles.map(t => `"${t}"`).join(", ")}`;
  await api("POST", `/projects/${currentProject.id}/log`, { summary });

  selectedCards.clear();
  currentProject = await api("GET", `/projects/${currentProject.id}`);
  renderProject();
}

// --- Project modal ---

function switchProjectModalTab(mode) {
  document.querySelectorAll(".proj-mode-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.mode === mode)
  );
  if (mode === "create") {
    show("proj-create-panel");
    hide("proj-restore-panel");
  } else {
    hide("proj-create-panel");
    show("proj-restore-panel");
    loadArchivedProjectsList();
  }
}

async function loadArchivedProjectsList() {
  const list = document.getElementById("archived-projects-list");
  list.innerHTML = "<p class='no-archived'>Loading...</p>";
  const archived = await api("GET", "/archived-projects");
  if (archived.length === 0) {
    list.innerHTML = "<p class='no-archived'>No archived projects.</p>";
    return;
  }
  list.innerHTML = archived.map(p => `
    <div class="archived-project-row">
      <div class="archived-project-info">
        <div class="archived-project-name">${escHtml(p.name)}</div>
        <div class="archived-project-date">Archived ${p.archived_date}</div>
      </div>
      <button class="btn-primary btn-restore" data-id="${p.id}">Restore</button>
    </div>
  `).join("");
  list.querySelectorAll(".btn-restore").forEach(btn =>
    btn.addEventListener("click", () => restoreProject(btn.dataset.id))
  );
}

async function restoreProject(projectId) {
  const project = await api("POST", `/archived-projects/${projectId}/restore`);
  currentProject = project;
  hide("modal-project");
  await loadProjects();
}

function openNewProject() {
  document.getElementById("proj-name").value = "";
  document.getElementById("proj-desc").value = "";
  document.getElementById("proj-repo").value = "";
  document.getElementById("btn-modal-save").dataset.mode = "create";
  document.getElementById("modal-project-title").textContent = "New Project";
  switchProjectModalTab("create");
  // only show tabs when not editing
  show("proj-mode-tabs");
  show("modal-project");
  document.getElementById("proj-name").focus();
}

function openEditProject() {
  const p = currentProject;
  document.getElementById("modal-project-title").textContent = "Edit Project";
  document.getElementById("proj-name").value = p.name;
  document.getElementById("proj-desc").value = p.description;
  document.getElementById("proj-repo").value = p.repo;
  document.getElementById("btn-modal-save").dataset.mode = "edit";
  hide("proj-mode-tabs");
  show("proj-create-panel");
  hide("proj-restore-panel");
  show("modal-project");
}

async function archiveProject() {
  if (!currentProject) return;
  if (!confirm(`Archive project "${currentProject.name}"? It can be restored later from the New Project dialog.`)) return;
  await api("POST", `/projects/${currentProject.id}/archive-project`);
  currentProject = null;
  await loadProjects();
}

async function saveProject() {
  const mode = document.getElementById("btn-modal-save").dataset.mode;
  const data = {
    name: document.getElementById("proj-name").value.trim(),
    description: document.getElementById("proj-desc").value.trim(),
    repo: document.getElementById("proj-repo").value.trim(),
  };
  if (!data.name) return;
  if (mode === "create") {
    const p = await api("POST", "/projects", data);
    currentProject = p;
  } else {
    currentProject = await api("PUT", `/projects/${currentProject.id}`, data);
  }
  hide("modal-project");
  await loadProjects();
}

// --- Card modal ---

function openAddCard(col) {
  editingCardId = null;
  editingCardCol = col;
  document.getElementById("modal-card-title").textContent = "New Card";
  document.getElementById("card-title").value = "";
  document.getElementById("card-desc").value = "";
  document.getElementById("card-tags").value = "";
  document.getElementById("card-col").value = col;
  show("modal-card");
  document.getElementById("card-title").focus();
}

function openEditCard(card, col) {
  editingCardId = card.id;
  editingCardCol = col;
  document.getElementById("modal-card-title").textContent = "Edit Card";
  document.getElementById("card-title").value = card.title;
  document.getElementById("card-desc").value = card.description || "";
  document.getElementById("card-tags").value = (card.tags || []).join(", ");
  document.getElementById("card-col").value = col;
  show("modal-card");
  document.getElementById("card-title").focus();
}

async function saveCard() {
  const title = document.getElementById("card-title").value.trim();
  if (!title) return;
  const data = {
    title,
    description: document.getElementById("card-desc").value.trim(),
    tags: document.getElementById("card-tags").value.split(",").map(t => t.trim()).filter(Boolean),
    column: document.getElementById("card-col").value,
  };
  if (editingCardId) {
    await api("PUT", `/projects/${currentProject.id}/cards/${editingCardId}`, data);
  } else {
    await api("POST", `/projects/${currentProject.id}/cards`, data);
  }
  hide("modal-card");
  currentProject = await api("GET", `/projects/${currentProject.id}`);
  renderProject();
}

async function deleteCard() {
  if (!editingCardId) return;
  if (!confirm("Delete this card?")) return;
  await api("DELETE", `/projects/${currentProject.id}/cards/${editingCardId}`);
  hide("modal-card");
  currentProject = await api("GET", `/projects/${currentProject.id}`);
  renderProject();
}

// --- Notes ---

async function saveNotes() {
  const notes = document.getElementById("notes-area").value;
  await api("PUT", `/projects/${currentProject.id}`, { notes });
  currentProject.notes = notes;
  flashSaved("btn-save-notes");
}

// --- Session log ---

function openLog() {
  document.getElementById("log-summary").value = "";
  show("modal-log");
  document.getElementById("log-summary").focus();
}

async function saveLog() {
  const summary = document.getElementById("log-summary").value.trim();
  if (!summary) return;
  await api("POST", `/projects/${currentProject.id}/log`, { summary });
  hide("modal-log");
  currentProject = await api("GET", `/projects/${currentProject.id}`);
  renderProject();
}

// --- Utils ---

function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function flashSaved(btnId) {
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.textContent = "Saved!";
  setTimeout(() => btn.textContent = orig, 1500);
}

// --- Wire up events ---

document.getElementById("btn-new-project").addEventListener("click", openNewProject);
document.getElementById("btn-archive-project").addEventListener("click", archiveProject);
document.getElementById("btn-delete-selected").addEventListener("click", deleteSelectedCards);
document.getElementById("btn-archive-selected").addEventListener("click", archiveSelectedCards);
document.getElementById("btn-restore-cancel").addEventListener("click", () => hide("modal-project"));

document.querySelectorAll(".proj-mode-tab").forEach(tab =>
  tab.addEventListener("click", () => switchProjectModalTab(tab.dataset.mode))
);

document.getElementById("archived-header").addEventListener("click", () => {
  const list = document.getElementById("archived-list");
  const toggle = document.getElementById("archived-toggle");
  const collapsed = list.classList.toggle("hidden");
  toggle.textContent = collapsed ? "▶" : "▼";
});
document.getElementById("btn-edit-project").addEventListener("click", openEditProject);
document.getElementById("btn-add-log").addEventListener("click", openLog);
document.getElementById("btn-save-notes").addEventListener("click", saveNotes);

document.getElementById("btn-modal-cancel").addEventListener("click", () => hide("modal-project"));
document.getElementById("btn-modal-save").addEventListener("click", saveProject);

document.getElementById("btn-card-cancel").addEventListener("click", () => hide("modal-card"));
document.getElementById("btn-card-save").addEventListener("click", saveCard);

document.getElementById("btn-log-cancel").addEventListener("click", () => hide("modal-log"));
document.getElementById("btn-log-save").addEventListener("click", saveLog);

document.querySelectorAll(".btn-add-card").forEach(btn =>
  btn.addEventListener("click", () => openAddCard(btn.dataset.col))
);

// Close modals on backdrop click
document.querySelectorAll(".modal").forEach(modal =>
  modal.addEventListener("click", e => { if (e.target === modal) modal.classList.add("hidden"); })
);

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if (e.key === "Escape") document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (!document.getElementById("modal-card").classList.contains("hidden")) saveCard();
    if (!document.getElementById("modal-project").classList.contains("hidden")) saveProject();
    if (!document.getElementById("modal-log").classList.contains("hidden")) saveLog();
    if (document.getElementById("project-view") && !document.getElementById("project-view").classList.contains("hidden")) saveNotes();
  }
});

// --- Delete card from edit modal ---
// Add delete button dynamically when editing a card
const cardModal = document.getElementById("modal-card");
const deleteCardBtn = document.createElement("button");
deleteCardBtn.className = "btn-danger";
deleteCardBtn.textContent = "Delete Card";
deleteCardBtn.style.marginRight = "auto";
deleteCardBtn.addEventListener("click", deleteCard);
cardModal.querySelector(".modal-actions").prepend(deleteCardBtn);

// --- Init ---
loadProjects();
