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
  const hashId = window.location.hash.slice(1);
  const projectsP = api("GET", "/projects");
  const hashProjectP = hashId ? api("GET", `/projects/${hashId}`).catch(() => null) : null;

  projects = await projectsP;
  renderTabs();
  if (projects.length === 0) {
    show("empty-state");
    hide("project-view");
  } else {
    const hashProject = hashProjectP ? await hashProjectP : null;
    const hashValid = hashProject && projects.find(p => p.id === hashId);
    const fromCurrent = currentProject ? projects.find(p => p.id === currentProject.id) : null;
    if (hashValid) {
      await selectProject(hashId, hashProject);
    } else {
      await selectProject((fromCurrent || projects[0]).id);
    }
  }
  refreshReviewBadge();
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

async function selectProject(id, prefetched) {
  currentProject = prefetched || await api("GET", `/projects/${id}`);
  if (window.location.hash.slice(1) !== id) {
    history.replaceState(null, "", `#${id}`);
  }
  hide("empty-state");
  show("project-view");
  renderTabs();
  renderProject();
}

window.addEventListener("hashchange", () => {
  const id = window.location.hash.slice(1);
  if (id && id !== currentProject?.id && projects.find(p => p.id === id)) {
    selectProject(id);
  }
});

function renderProject() {
  const p = currentProject;
  document.getElementById("project-title").textContent = p.name;
  const repoEl = document.getElementById("project-repo");
  if (p.repo) {
    repoEl.textContent = `📁 ${p.repo}`;
    repoEl.title = "Click to copy";
    repoEl.classList.add("clickable");
    repoEl.onclick = () => {
      navigator.clipboard.writeText(p.repo).then(() => {
        const orig = repoEl.textContent;
        repoEl.textContent = "📁 Copied!";
        setTimeout(() => repoEl.textContent = orig, 1200);
      });
    };
  } else {
    repoEl.textContent = "";
    repoEl.classList.remove("clickable");
    repoEl.onclick = null;
  }
  document.getElementById("project-updated").textContent = `Updated ${p.last_updated}`;
  document.getElementById("project-description").textContent = p.description;
  document.getElementById("notes-area").value = p.notes || "";

  selectedCards.clear();
  updateDeleteSelectedBtn();

  const cols = ["in_progress", "ready_for_review", "next", "later", "long_term", "recent", "completed"];
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

let dragData = null;

function makeCardDraggable(div, card, col) {
  div.draggable = true;
  div.addEventListener("dragstart", e => {
    dragData = { cardId: card.id, sourceCol: col };
    div.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", card.id); } catch {}
  });
  div.addEventListener("dragend", () => {
    div.classList.remove("dragging");
    dragData = null;
    document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
  });
}

function setupColumnDropTargets() {
  document.querySelectorAll(".cards").forEach(container => {
    const col = container.id.replace("col-", "");
    container.addEventListener("dragover", e => {
      if (!dragData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      container.closest(".column").classList.add("drop-target");
    });
    container.addEventListener("dragleave", e => {
      if (!container.contains(e.relatedTarget)) {
        container.closest(".column").classList.remove("drop-target");
      }
    });
    container.addEventListener("drop", e => {
      e.preventDefault();
      if (!dragData) return;
      const { cardId, sourceCol } = dragData;
      handleCardDrop(cardId, sourceCol, col, e.clientY, container);
    });
  });
}

async function handleCardDrop(cardId, sourceCol, targetCol, clientY, container) {
  const visible = [...container.querySelectorAll(".card")].filter(el => !el.classList.contains("dragging"));
  let dropIndex = visible.length;
  for (let i = 0; i < visible.length; i++) {
    const rect = visible[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) { dropIndex = i; break; }
  }

  if (sourceCol === targetCol) {
    const cards = [...currentProject.columns[sourceCol]];
    const fromIdx = cards.findIndex(c => c.id === cardId);
    if (fromIdx < 0) return;
    const [moved] = cards.splice(fromIdx, 1);
    let insertAt = dropIndex;
    if (fromIdx < dropIndex) insertAt--;
    cards.splice(insertAt, 0, moved);
    if (cards.map(c => c.id).join("|") === currentProject.columns[sourceCol].map(c => c.id).join("|")) return;
    await api("PUT", `/projects/${currentProject.id}/columns/${sourceCol}/reorder`, {
      card_ids: cards.map(c => c.id),
    });
  } else {
    await api("PUT", `/projects/${currentProject.id}/cards/${cardId}`, { column: targetCol });
    const fresh = await api("GET", `/projects/${currentProject.id}`);
    const targetCards = [...fresh.columns[targetCol]];
    const movedIdx = targetCards.findIndex(c => c.id === cardId);
    if (movedIdx >= 0 && dropIndex < targetCards.length - 1) {
      const [moved] = targetCards.splice(movedIdx, 1);
      targetCards.splice(dropIndex, 0, moved);
      await api("PUT", `/projects/${currentProject.id}/columns/${targetCol}/reorder`, {
        card_ids: targetCards.map(c => c.id),
      });
    }
  }
  currentProject = await api("GET", `/projects/${currentProject.id}`);
  renderProject();
  refreshReviewBadge();
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
      ${cardPlanHtml(card)}
      ${cardDueHtml(card)}
      ${card.tags?.length ? `<div class="card-tags">${card.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
    `;
    div.appendChild(checkbox);
    div.appendChild(body);
  } else {
    div.className = "card";
    div.innerHTML = `
      <div class="card-title">${escHtml(card.title)}</div>
      ${card.description ? `<div class="card-desc">${escHtml(card.description)}</div>` : ""}
      ${cardPlanHtml(card)}
      ${cardDueHtml(card)}
      ${card.tags?.length ? `<div class="card-tags">${card.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
    `;
    div.addEventListener("click", () => openEditCard(card, col));
  }

  makeCardDraggable(div, card, col);
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
  hide("modal-archive");
  await loadProjects();
}

// --- Activity ---

let activityRange = "today";

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function activitySinceDate(range) {
  const now = new Date();
  if (range === "today") return localDateStr(now);
  if (range === "week") {
    const d = new Date(now);
    const dow = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - dow);
    return localDateStr(d);
  }
  return null;
}

function timeBucket(hour) {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

async function openActivity() {
  show("modal-activity");
  await renderActivity();
}

async function renderActivity() {
  const list = document.getElementById("activity-list");
  const summary = document.getElementById("activity-summary");
  list.innerHTML = "<p class='no-archived'>Loading...</p>";
  summary.textContent = "";

  document.querySelectorAll(".activity-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.range === activityRange)
  );

  const since = activitySinceDate(activityRange);
  const path = since ? `/activity?since=${since}` : "/activity";
  const items = await api("GET", path);

  if (items.length === 0) {
    list.innerHTML = "<p class='no-archived'>Nothing completed in this range.</p>";
    return;
  }

  const buckets = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  items.forEach(it => {
    const hour = new Date(it.completed_at).getHours();
    buckets[timeBucket(hour)]++;
  });
  summary.innerHTML = `
    <span class="summary-total">${items.length} completed</span>
    <span class="summary-buckets">
      🌅 ${buckets.morning} morning ·
      ☀️ ${buckets.afternoon} afternoon ·
      🌆 ${buckets.evening} evening ·
      🌙 ${buckets.night} night
    </span>
  `;

  const groups = {};
  items.forEach(it => {
    const date = it.completed_at.slice(0, 10);
    (groups[date] ||= []).push(it);
  });

  list.innerHTML = Object.entries(groups).map(([date, entries]) => `
    <div class="activity-group">
      <div class="activity-date">${date}</div>
      ${entries.map(e => {
        const time = new Date(e.completed_at).toTimeString().slice(0, 5);
        return `
          <div class="activity-row">
            <div class="activity-time">${time}</div>
            <div class="activity-body">
              <div class="activity-title">${escHtml(e.title)}</div>
              <div class="activity-meta">
                <span class="activity-project">${escHtml(e.project_name)}</span>
                ${e.tags?.length ? `<span class="card-tags-inline">${e.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</span>` : ""}
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `).join("");
}

async function refreshReviewBadge() {
  const badge = document.getElementById("review-count");
  try {
    const queue = await api("GET", "/review-queue");
    const total = queue.reduce((n, g) => n + g.cards.length, 0);
    if (total === 0) {
      badge.classList.add("hidden");
    } else {
      badge.textContent = total;
      badge.classList.remove("hidden");
    }
  } catch {
    badge.classList.add("hidden");
  }
}

async function openReviewQueue() {
  show("modal-review");
  const list = document.getElementById("review-queue-list");
  list.innerHTML = "<p class='no-archived'>Loading...</p>";
  await renderReviewQueue();
}

async function renderReviewQueue() {
  const list = document.getElementById("review-queue-list");
  const queue = await api("GET", "/review-queue");
  if (queue.length === 0) {
    list.innerHTML = "<p class='no-archived'>Nothing waiting for review. 🎉</p>";
    refreshReviewBadge();
    return;
  }
  list.innerHTML = queue.map(group => `
    <div class="review-group">
      <div class="review-group-header">
        <span class="review-group-name">${escHtml(group.project_name)}</span>
        <span class="review-group-count">${group.cards.length}</span>
      </div>
      ${group.cards.map(c => `
        <div class="review-card" data-project="${group.project_id}" data-card="${c.id}">
          <div class="review-card-body">
            <div class="card-title">${escHtml(c.title)}</div>
            ${c.description ? `<div class="card-desc">${escHtml(c.description)}</div>` : ""}
            ${cardPlanHtml(c)}
            ${cardDueHtml(c)}
            ${c.tags?.length ? `<div class="card-tags">${c.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
          </div>
          <div class="review-card-actions">
            <button class="btn-secondary btn-review-back" data-project="${group.project_id}" data-card="${c.id}">Send back</button>
            <button class="btn-primary btn-review-approve" data-project="${group.project_id}" data-card="${c.id}">Approve</button>
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");

  list.querySelectorAll(".btn-review-approve").forEach(btn =>
    btn.addEventListener("click", () => moveReviewCard(btn.dataset.project, btn.dataset.card, "completed"))
  );
  list.querySelectorAll(".btn-review-back").forEach(btn =>
    btn.addEventListener("click", () => moveReviewCard(btn.dataset.project, btn.dataset.card, "in_progress"))
  );
  refreshReviewBadge();
}

// --- Prioritize ---

let prioritizeColumn = "next";

async function openPrioritize() {
  show("modal-prioritize");
  await renderPrioritize();
}

let prioItems = [];

async function renderPrioritize() {
  const list = document.getElementById("prioritize-list");
  list.innerHTML = "<p class='no-archived'>Loading...</p>";

  document.querySelectorAll(".prio-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.col === prioritizeColumn)
  );

  prioItems = await api("GET", `/prioritize/${prioritizeColumn}`);
  if (prioItems.length === 0) {
    list.innerHTML = "<p class='no-archived'>Nothing in this column across any project.</p>";
    return;
  }

  list.innerHTML = prioItems.map((item, i) => {
    const c = item.card;
    return `
      <div class="prio-card" data-index="${i}">
        <div class="prio-rank">${i + 1}</div>
        <div class="review-card-body">
          <div class="card-title">${escHtml(c.title)}</div>
          <div class="prio-project-label">${escHtml(item.project_name)}</div>
          ${c.description ? `<div class="card-desc">${escHtml(c.description)}</div>` : ""}
          ${cardPlanHtml(c)}
          ${cardDueHtml(c)}
          ${c.tags?.length ? `<div class="card-tags">${c.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="prio-controls">
          <button class="btn-prio-up" data-index="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="btn-prio-down" data-index="${i}" ${i === prioItems.length - 1 ? "disabled" : ""}>▼</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".btn-prio-up").forEach(btn =>
    btn.addEventListener("click", () => movePrio(+btn.dataset.index, -1))
  );
  list.querySelectorAll(".btn-prio-down").forEach(btn =>
    btn.addEventListener("click", () => movePrio(+btn.dataset.index, +1))
  );
  list.querySelectorAll(".prio-card").forEach(div =>
    makePrioCardDraggable(div, +div.dataset.index)
  );
}

async function persistPrioOrder(items) {
  await api("PUT", `/prioritize/${prioritizeColumn}`, {
    order: items.map(it => ({ project_id: it.project_id, card_id: it.card.id })),
  });
  await renderPrioritize();
}

async function movePrio(i, delta) {
  const j = i + delta;
  if (i < 0 || j < 0 || j >= prioItems.length) return;
  const reordered = prioItems.slice();
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  await persistPrioOrder(reordered);
}

let prioDragData = null;

function makePrioCardDraggable(div, index) {
  div.draggable = true;
  div.addEventListener("dragstart", e => {
    prioDragData = { index };
    div.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(index)); } catch {}
  });
  div.addEventListener("dragend", () => {
    div.classList.remove("dragging");
    prioDragData = null;
    document.querySelectorAll(".prio-card.drop-above, .prio-card.drop-below")
      .forEach(el => el.classList.remove("drop-above", "drop-below"));
  });
  div.addEventListener("dragover", e => {
    if (!prioDragData || prioDragData.index === index) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = div.getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    div.classList.toggle("drop-above", above);
    div.classList.toggle("drop-below", !above);
  });
  div.addEventListener("dragleave", () => {
    div.classList.remove("drop-above", "drop-below");
  });
  div.addEventListener("drop", async e => {
    if (!prioDragData) return;
    e.preventDefault();
    const fromIdx = prioDragData.index;
    div.classList.remove("drop-above", "drop-below");
    if (fromIdx === index) return;
    const rect = div.getBoundingClientRect();
    const dropAbove = e.clientY < rect.top + rect.height / 2;

    const reordered = prioItems.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    let target = index;
    if (fromIdx < index) target--;
    if (!dropAbove) target++;
    reordered.splice(target, 0, moved);
    await persistPrioOrder(reordered);
  });
}

async function openInProgress() {
  show("modal-in-progress");
  const list = document.getElementById("in-progress-list");
  list.innerHTML = "<p class='no-archived'>Loading...</p>";
  const groups = await api("GET", "/in-progress");

  const tasks = groups.flatMap(g =>
    g.cards.map(c => ({ card: c, project_id: g.project_id, project_name: g.project_name }))
  );

  if (tasks.length === 0) {
    list.innerHTML = "<p class='no-archived'>Nothing in progress right now.</p>";
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const dueRank = c => {
    if (!c.due_date) return 2;
    if (c.due_date < today) return 0;
    if (c.due_date === today) return 1;
    return 2;
  };

  tasks.sort((a, b) => {
    const r = dueRank(a.card) - dueRank(b.card);
    if (r !== 0) return r;
    const da = a.card.due_date || "9999-99-99";
    const db = b.card.due_date || "9999-99-99";
    if (da !== db) return da.localeCompare(db);
    return a.project_name.localeCompare(b.project_name);
  });

  list.innerHTML = `
    <div class="in-progress-count">${tasks.length} task${tasks.length === 1 ? "" : "s"} in progress</div>
    <div class="in-progress-tasks">
      ${tasks.map(t => {
        const c = t.card;
        return `
          <div class="in-progress-task" data-project="${t.project_id}" title="Open ${escHtml(t.project_name)}">
            <div class="card-title">
              <span class="in-progress-project-prefix">${escHtml(t.project_name)}</span>
              <span class="in-progress-title-sep">·</span>
              ${escHtml(c.title)}
            </div>
            ${c.description ? `<div class="card-desc">${escHtml(c.description)}</div>` : ""}
            ${cardPlanHtml(c)}
            ${cardDueHtml(c)}
            ${c.tags?.length ? `<div class="card-tags">${c.tags.map(tag => `<span class="tag">${escHtml(tag)}</span>`).join("")}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;

  list.querySelectorAll(".in-progress-task").forEach(el =>
    el.addEventListener("click", () => {
      hide("modal-in-progress");
      selectProject(el.dataset.project);
    })
  );
}

async function moveReviewCard(projectId, cardId, column) {
  await api("PUT", `/projects/${projectId}/cards/${cardId}`, { column });
  if (currentProject && currentProject.id === projectId) {
    currentProject = await api("GET", `/projects/${projectId}`);
    renderProject();
  }
  await renderReviewQueue();
}

async function openArchiveView() {
  show("modal-archive");
  const list = document.getElementById("archive-view-list");
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
      <button class="btn-primary btn-restore-archive" data-id="${p.id}">Restore</button>
    </div>
  `).join("");
  list.querySelectorAll(".btn-restore-archive").forEach(btn =>
    btn.addEventListener("click", () => restoreProject(btn.dataset.id))
  );
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

function generateClaudeMd() {
  const p = currentProject;
  const today = new Date().toISOString().slice(0, 10);

  function fmtCards(cards) {
    if (!cards || cards.length === 0) return "_None_\n";
    return cards.map(c => {
      let s = `### ${c.title}\n`;
      if (c.description) s += `${c.description}\n`;
      if (c.tags && c.tags.length) s += `_Tags: ${c.tags.join(", ")}_\n`;
      return s;
    }).join("\n");
  }

  const logLines = (p.session_log || []).slice(0, 3)
    .map(e => `- **${e.date}**: ${e.summary}`)
    .join("\n") || "_No entries yet._";

  const md = `# ${p.name} — Claude Context

> Generated ${today} from Project Board. Paste at the start of a Claude session.

## Project

**Description:** ${p.description || ""}
**Repo:** ${p.repo || ""}

## Currently In Progress

${fmtCards(p.columns.in_progress)}
## Up Next

${fmtCards((p.columns.next || []).slice(0, 5))}
## Notes

${p.notes || "_No notes._"}

## Recent Session Log

${logLines}
`;

  document.getElementById("claude-md-project-name").textContent = p.name;
  document.getElementById("claude-md-text").value = md;
  show("modal-claude-md");
  navigator.clipboard.writeText(md).then(() => {
    const btn = document.getElementById("btn-claude-md-copy");
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = "Copy to Clipboard", 2000);
  });
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
  document.getElementById("card-plan-path").value = "";
  document.getElementById("card-due-date").value = "";
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
  document.getElementById("card-plan-path").value = card.plan_path || "";
  document.getElementById("card-due-date").value = card.due_date || "";
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
    plan_path: document.getElementById("card-plan-path").value.trim(),
    due_date: document.getElementById("card-due-date").value,
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
  refreshReviewBadge();
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

function cardPlanHtml(card) {
  if (!card.plan_path) return "";
  return `<div class="card-plan" title="${escHtml(card.plan_path)}">📄 ${escHtml(card.plan_path)}</div>`;
}

function cardDueHtml(card) {
  if (!card.due_date) return "";
  const today = new Date().toISOString().slice(0, 10);
  const cls = card.due_date < today ? "due-overdue" : card.due_date === today ? "due-today" : "";
  return `<div class="card-due ${cls}">📅 ${escHtml(card.due_date)}</div>`;
}

function flashSaved(btnId) {
  const btn = document.getElementById(btnId);
  const orig = btn.textContent;
  btn.textContent = "Saved!";
  setTimeout(() => btn.textContent = orig, 1500);
}

// --- Wire up events ---

document.getElementById("btn-new-project").addEventListener("click", openNewProject);
document.getElementById("btn-show-archive").addEventListener("click", openArchiveView);
document.getElementById("btn-archive-view-close").addEventListener("click", () => hide("modal-archive"));
document.getElementById("btn-show-review").addEventListener("click", openReviewQueue);
document.getElementById("btn-review-close").addEventListener("click", () => hide("modal-review"));
document.getElementById("btn-show-activity").addEventListener("click", openActivity);
document.getElementById("btn-activity-close").addEventListener("click", () => hide("modal-activity"));
document.getElementById("btn-show-in-progress").addEventListener("click", openInProgress);
document.getElementById("btn-in-progress-close").addEventListener("click", () => hide("modal-in-progress"));
document.getElementById("btn-show-prioritize").addEventListener("click", openPrioritize);
document.getElementById("btn-prioritize-close").addEventListener("click", () => hide("modal-prioritize"));
document.querySelectorAll(".prio-tab").forEach(tab =>
  tab.addEventListener("click", () => { prioritizeColumn = tab.dataset.col; renderPrioritize(); })
);
document.querySelectorAll(".activity-tab").forEach(tab =>
  tab.addEventListener("click", () => { activityRange = tab.dataset.range; renderActivity(); })
);
document.getElementById("btn-archive-project").addEventListener("click", archiveProject);
document.getElementById("btn-generate-claude-md").addEventListener("click", generateClaudeMd);
document.getElementById("btn-claude-md-close").addEventListener("click", () => hide("modal-claude-md"));
document.getElementById("btn-claude-md-copy").addEventListener("click", () => {
  const text = document.getElementById("claude-md-text").value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("btn-claude-md-copy");
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = "Copy to Clipboard", 2000);
  });
});
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
setupColumnDropTargets();
loadProjects();
