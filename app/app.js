import {
  firebaseEnabled as cloudEnabled,
  loadSdk,
  signIn,
  signOutUser,
  pushState,
  onAuthChange,
  onRemoteUpdate,
  isSignedIn
} from "./firebase-sync.js";

const storageKey = "aiEngineerOS.v1";

const defaults = {
  activeDate: "",
  tasks: [
    { text: "Solve one DSA problem and write the pattern", area: "DSA", done: false },
    { text: "Move DETECTOR AI one task forward", area: "DETECTOR AI", done: false },
    { text: "Send or improve one resume/job application", area: "Placement", done: false }
  ],
  habits: {},
  reflections: {
    win: "",
    lesson: "",
    tomorrow: "",
    weekly: "",
    monthly: ""
  },
  dsa: [],
  project: [
    { title: "Problem framing", status: "Done", detail: "Bengal Tiger monitoring at Rajaji National Park defined as the use case." },
    { title: "Dataset consolidation", status: "Active", detail: "Merge WII/GBIF, LILA BC WCS Camera Traps, ATRW, and iNaturalist sources." },
    { title: "YOLOv8 / MegaDetector pipeline", status: "Active", detail: "Build the detection pipeline and tune thresholds on a held-out split." },
    { title: "Model training & metrics", status: "Backlog", detail: "Train, log mAP/precision/recall, compare against the MegaDetector baseline." },
    { title: "Demo / inference interface", status: "Backlog", detail: "Simple UI or API to run detection on new camera-trap footage." },
    { title: "Portfolio README", status: "Backlog", detail: "Document setup, architecture, dataset sources, metrics, and limitations." }
  ]
};

const habits = [
  ["wake", "Wake early", "Out of bed without scrolling."],
  ["workout", "Workout", "30-45 minutes or mobility."],
  ["dsa", "DSA", "One problem plus review."],
  ["aiml", "AI/ML study", "45 focused minutes with output."],
  ["project", "DETECTOR AI progress", "One visible task moved forward."],
  ["resume", "Resume & applications", "One meaningful edit or application sent."],
  ["innovocon", "InnovoCon", "One concrete organizing task moved forward."],
  ["github", "GitHub", "Commit or document progress."],
  ["reading", "Reading", "Technical reading or paper notes."],
  ["sleep", "Sleep", "Lights out near 10:30 PM."],
  ["scroll", "No scroll", "Protect deep work blocks."]
];

const blocks = [
  ["6:00", "Wake, water, no phone"],
  ["6:15", "Workout"],
  ["7:45", "DSA or AI/ML deep work"],
  ["12:30", "Resume + placement prep"],
  ["14:30", "DETECTOR AI project block"],
  ["17:00", "DSA or coding"],
  ["19:00", "InnovoCon work"],
  ["21:30", "Night reflection"],
  ["22:30", "Sleep"]
];

const roadmap = [
  {
    title: "Days 1-30",
    label: "Foundations",
    items: ["Python for ML", "NumPy and Pandas", "EDA notebook", "Model evaluation"]
  },
  {
    title: "Days 31-60",
    label: "Deep learning",
    items: ["PyTorch basics", "Computer vision", "Transfer learning", "Experiment logs"]
  },
  {
    title: "Days 61-90",
    label: "Portfolio",
    items: ["DETECTOR AI pipeline", "Deployment demo", "Resume + interview story", "Placement applications"]
  }
];

const statuses = ["Backlog", "Active", "Blocked", "Done"];
let state = loadState();
let applyingRemote = false;
let pushTimer = null;

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return structuredClone(defaults);
  }
  try {
    return { ...structuredClone(defaults), ...JSON.parse(saved) };
  } catch {
    return structuredClone(defaults);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  updateMetrics();
  queueCloudPush();
}

function queueCloudPush() {
  if (!cloudEnabled || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushState(state).catch(() => setSyncStatus("Sync error - will retry on next change"));
  }, 800);
}

function todayIso() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function init() {
  if (!state.activeDate) {
    state.activeDate = todayIso();
  }

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => setSection(button.dataset.section, button.textContent));
  });

  const activeDate = document.getElementById("activeDate");
  activeDate.value = state.activeDate;
  activeDate.addEventListener("change", () => {
    state.activeDate = activeDate.value;
    saveState();
  });

  document.getElementById("taskForm").addEventListener("submit", addTask);
  document.getElementById("clearDoneTasks").addEventListener("click", clearDoneTasks);
  document.getElementById("dsaForm").addEventListener("submit", addProblem);
  document.getElementById("exportData").addEventListener("click", exportData);

  bindText("reflectionWin", "win");
  bindText("reflectionLesson", "lesson");
  bindText("tomorrowPriority", "tomorrow");
  bindText("weeklyReview", "weekly");
  bindText("monthlyReview", "monthly");

  hydrateAllViews();
  initSync();
}

function setSection(id, title) {
  document.querySelectorAll(".section").forEach((section) => section.classList.remove("is-active"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("is-active"));
  document.getElementById(id).classList.add("is-active");
  document.querySelector(`[data-section="${id}"]`).classList.add("is-active");
  document.getElementById("pageTitle").textContent = title;
}

function bindText(elementId, key) {
  const element = document.getElementById(elementId);
  element.value = state.reflections[key] || "";
  element.addEventListener("input", () => {
    state.reflections[key] = element.value;
    saveState();
  });
}

function renderTasks() {
  const list = document.getElementById("topTasks");
  list.innerHTML = "";
  state.tasks.slice(0, 12).forEach((task, index) => {
    const row = document.createElement("div");
    row.className = `task-item${task.done ? " is-done" : ""}`;
    row.innerHTML = `
      <input type="checkbox" ${task.done ? "checked" : ""} aria-label="Mark task complete">
      <strong>${escapeHtml(task.text)}</strong>
      <span class="pill">${escapeHtml(task.area)}</span>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      state.tasks[index].done = event.target.checked;
      saveState();
      renderTasks();
    });
    list.appendChild(row);
  });
}

function addTask(event) {
  event.preventDefault();
  const input = document.getElementById("taskInput");
  const area = document.getElementById("taskArea");
  const text = input.value.trim();
  if (!text) return;
  state.tasks.unshift({ text, area: area.value, done: false });
  input.value = "";
  saveState();
  renderTasks();
}

function clearDoneTasks() {
  state.tasks = state.tasks.filter((task) => !task.done);
  saveState();
  renderTasks();
}

function renderTimeBlocks() {
  const list = document.getElementById("timeBlocks");
  list.innerHTML = blocks.map(([time, label]) => `
    <div class="time-row">
      <strong>${time}</strong>
      <span>${label}</span>
    </div>
  `).join("");
}

function renderHabits() {
  const grid = document.getElementById("habitGrid");
  grid.innerHTML = "";
  habits.forEach(([key, title, detail]) => {
    const item = document.createElement("label");
    item.className = "habit-item";
    item.innerHTML = `
      <input type="checkbox" ${state.habits[key] ? "checked" : ""}>
      <span>
        <strong>${title}</strong>
        <p>${detail}</p>
      </span>
    `;
    item.querySelector("input").addEventListener("change", (event) => {
      state.habits[key] = event.target.checked;
      saveState();
    });
    grid.appendChild(item);
  });
}

function addProblem(event) {
  event.preventDefault();
  const name = document.getElementById("problemName");
  const topic = document.getElementById("problemTopic");
  const difficulty = document.getElementById("problemDifficulty");
  const time = document.getElementById("problemTime");

  state.dsa.unshift({
    name: name.value.trim(),
    topic: topic.value,
    difficulty: difficulty.value,
    time: Number(time.value || 0),
    solved: true
  });

  name.value = "";
  time.value = "";
  saveState();
  renderDsa();
}

function renderDsa() {
  const body = document.getElementById("dsaTable");
  if (state.dsa.length === 0) {
    body.innerHTML = `<tr><td colspan="5">No problems logged yet. Start with one today.</td></tr>`;
    return;
  }

  body.innerHTML = state.dsa.slice(0, 20).map((problem) => `
    <tr>
      <td>${escapeHtml(problem.name)}</td>
      <td>${escapeHtml(problem.topic)}</td>
      <td>${escapeHtml(problem.difficulty)}</td>
      <td>${problem.time || 0} min</td>
      <td>${problem.solved ? "Solved" : "Review"}</td>
    </tr>
  `).join("");
}

function renderRoadmap() {
  const list = document.getElementById("roadmapList");
  list.innerHTML = roadmap.map((phase) => `
    <article class="roadmap-item">
      <span>${phase.label}</span>
      <h4>${phase.title}</h4>
      <ul>
        ${phase.items.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </article>
  `).join("");
}

function renderProject() {
  const board = document.getElementById("projectBoard");
  board.innerHTML = "";
  statuses.forEach((status) => {
    const column = document.createElement("div");
    column.className = "board-column";
    column.innerHTML = `<h4>${status}</h4>`;
    state.project
      .filter((task) => task.status === status)
      .forEach((task) => {
        const card = document.createElement("article");
        card.className = "board-card";
        card.innerHTML = `
          <span>${escapeHtml(task.status)}</span>
          <h4>${escapeHtml(task.title)}</h4>
          <p class="muted">${escapeHtml(task.detail)}</p>
          <button type="button">Move Next</button>
        `;
        card.querySelector("button").addEventListener("click", () => moveProjectTask(task.title));
        column.appendChild(card);
      });
    board.appendChild(column);
  });
}

function moveProjectTask(title) {
  const task = state.project.find((item) => item.title === title);
  const index = statuses.indexOf(task.status);
  task.status = statuses[Math.min(index + 1, statuses.length - 1)];
  saveState();
  renderProject();
}

function updateMetrics() {
  const completedHabits = habits.filter(([key]) => state.habits[key]).length;
  const completedTasks = state.tasks.filter((task) => task.done).length;
  const score = Math.min(10, completedHabits + completedTasks);
  document.getElementById("dailyScore").textContent = String(score);
  document.getElementById("habitCount").textContent = `${completedHabits}/${habits.length}`;
  document.getElementById("dsaCount").textContent = String(state.dsa.length);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai-engineer-os-${state.activeDate || "export"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hydrateAllViews() {
  const activeDate = document.getElementById("activeDate");
  activeDate.value = state.activeDate;
  document.getElementById("reflectionWin").value = state.reflections.win || "";
  document.getElementById("reflectionLesson").value = state.reflections.lesson || "";
  document.getElementById("tomorrowPriority").value = state.reflections.tomorrow || "";
  document.getElementById("weeklyReview").value = state.reflections.weekly || "";
  document.getElementById("monthlyReview").value = state.reflections.monthly || "";
  renderTasks();
  renderTimeBlocks();
  renderHabits();
  renderDsa();
  renderRoadmap();
  renderProject();
  updateMetrics();
}

function setSyncStatus(text) {
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = text;
}

function initSync() {
  const syncButton = document.getElementById("syncButton");
  if (!syncButton) return;

  if (!cloudEnabled) {
    setSyncStatus("Local only");
    syncButton.textContent = "Cloud sync off";
    syncButton.disabled = true;
    syncButton.title = "Fill in firebase-config.js and set firebaseEnabled to true to turn this on.";
    return;
  }

  setSyncStatus("Connecting...");
  loadSdk();

  onAuthChange((user) => {
    if (user) {
      setSyncStatus(`Synced as ${user.email || user.displayName || "account"}`);
      syncButton.textContent = "Sign Out";
    } else {
      setSyncStatus("Local only - sign in to sync");
      syncButton.textContent = "Sign In";
    }
  });

  onRemoteUpdate((payload) => {
    if (!payload) return;
    applyingRemote = true;
    state = { ...structuredClone(defaults), ...payload };
    localStorage.setItem(storageKey, JSON.stringify(state));
    hydrateAllViews();
    applyingRemote = false;
  });

  syncButton.addEventListener("click", async () => {
    syncButton.disabled = true;
    try {
      if (isSignedIn()) {
        await signOutUser();
      } else {
        await signIn();
        setTimeout(() => pushState(state), 1500);
      }
    } catch (err) {
      setSyncStatus("Sign-in failed - try again");
    } finally {
      syncButton.disabled = false;
    }
  });
}

init();
