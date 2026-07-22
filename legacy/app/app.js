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

import {
  defaultSchedule,
  registerServiceWorker,
  getPermissionState,
  requestPermission,
  startScheduler,
  syncScheduleToSW,
  enableBackgroundCheckins,
  testBrowserNotification,
  testSwNotification,
  testEmailNotification,
  onNotification,
  getNotificationLog
} from "./notifications.js";

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
  ],
  notifications: {
    browserEnabled: false,
    swEnabled: false,
    emailEnabled: false,
    soundEnabled: true,
    schedule: structuredClone(defaultSchedule),
    firedToday: {},
    _firedDate: "",
    _emailSentToday: false,
    log: []
  }
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
  // Mirror the reminder schedule to the service worker for offline notifications
  syncScheduleToSW(state);
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

function initOfflineIndicator() {
  const badge = document.getElementById("offlineBadge");

  const update = () => {
    const offline = !navigator.onLine;
    if (badge) badge.hidden = !offline;
    if (!offline) {
      // Connectivity returned — re-register a one-off sync so the SW
      // catches up on anything due, and re-mirror the schedule
      syncScheduleToSW(state);
      enableBackgroundCheckins().catch(() => {});
    }
  };

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function init() {
  if (!state.activeDate) {
    state.activeDate = todayIso();
  }

  initOfflineIndicator();

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
  initNotifications();
  initSync();
}

function setSection(id, title) {
  document.querySelectorAll(".section").forEach((section) => section.classList.remove("is-active"));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("is-active"));
  document.getElementById(id).classList.add("is-active");
  document.querySelector(`[data-section="${id}"]`).classList.add("is-active");
  document.getElementById("pageTitle").textContent = title;
}

// Expose for service worker click-to-navigate
window.__navigateSection = (section) => {
  const btn = document.querySelector(`[data-section="${section}"]`);
  if (btn) setSection(section, btn.textContent);
};

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
  renderNotificationUI();
}

function setSyncStatus(text) {
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = text;
}

// -----------------------------------------------------------------------
// Notification UI
// -----------------------------------------------------------------------

function updatePermissionBadge() {
  const badge = document.getElementById("permissionBadge");
  const btn = document.getElementById("requestPermBtn");
  if (!badge) return;

  const perm = getPermissionState();
  badge.classList.remove("badge-granted", "badge-denied", "badge-pending");

  if (perm === "granted") {
    badge.textContent = "Granted";
    badge.classList.add("badge-granted");
    btn.style.display = "none";
  } else if (perm === "denied") {
    badge.textContent = "Blocked";
    badge.classList.add("badge-denied");
    btn.textContent = "Blocked by browser";
    btn.disabled = true;
  } else if (perm === "unsupported") {
    badge.textContent = "Not supported";
    badge.classList.add("badge-denied");
    btn.style.display = "none";
  } else {
    badge.textContent = "Not enabled";
    badge.classList.add("badge-pending");
  }
}

function renderScheduleTable() {
  const tbody = document.getElementById("scheduleTable");
  if (!tbody) return;

  const schedule = state.notifications.schedule || [];
  tbody.innerHTML = "";

  schedule.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="time" class="schedule-time-input" value="${item.time}" data-idx="${index}" data-field="time"></td>
      <td><input type="text" class="schedule-text-input" value="${escapeHtml(item.title)}" data-idx="${index}" data-field="title"></td>
      <td><input type="text" class="schedule-text-input" value="${escapeHtml(item.message)}" data-idx="${index}" data-field="message"></td>
      <td><input type="checkbox" ${item.emailDigest ? "checked" : ""} data-idx="${index}" data-field="emailDigest" aria-label="Send email digest"></td>
      <td><input type="checkbox" ${item.enabled ? "checked" : ""} data-idx="${index}" data-field="enabled" aria-label="Active"></td>
      <td><button class="remove-btn" data-idx="${index}" type="button">\u00d7</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Bind change events
  tbody.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.idx);
      const field = input.dataset.field;
      if (field === "enabled" || field === "emailDigest") {
        state.notifications.schedule[idx][field] = input.checked;
      } else {
        state.notifications.schedule[idx][field] = input.value;
      }
      saveState();
    });
  });

  // Bind remove buttons
  tbody.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.notifications.schedule.splice(Number(btn.dataset.idx), 1);
      saveState();
      renderScheduleTable();
    });
  });
}

function renderNotificationUI() {
  updatePermissionBadge();

  const notif = state.notifications;
  const toggleBrowser = document.getElementById("toggleBrowser");
  const toggleSw = document.getElementById("toggleSw");
  const toggleEmail = document.getElementById("toggleEmail");
  const toggleSound = document.getElementById("toggleSound");
  const emailPanel = document.getElementById("emailConfigPanel");

  if (toggleBrowser) toggleBrowser.checked = notif.browserEnabled;
  if (toggleSw) toggleSw.checked = notif.swEnabled;
  if (toggleEmail) toggleEmail.checked = notif.emailEnabled;
  if (toggleSound) toggleSound.checked = notif.soundEnabled !== false;
  if (emailPanel) emailPanel.style.display = notif.emailEnabled ? "block" : "none";

  renderScheduleTable();
  renderNotifHistory();
}

function renderNotifHistory() {
  const container = document.getElementById("notifHistory");
  if (!container) return;

  const log = getNotificationLog(state);
  if (log.length === 0) {
    container.innerHTML = '<p class="muted">No notifications yet today.</p>';
    return;
  }

  container.innerHTML = log.slice(0, 20).map((entry) => {
    const badgeClass = entry.type === "fired" ? "badge-fired" : entry.type === "catchup" ? "badge-catchup" : "badge-missed";
    const badgeText = entry.type === "fired" ? "Sent" : entry.type === "catchup" ? "Catch-up" : "Missed";
    return `
      <div class="notif-history-item">
        <span class="notif-history-time">${escapeHtml(entry.time)}</span>
        <div class="notif-history-body">
          <strong>${escapeHtml(entry.title)}</strong>
          <p>${escapeHtml(entry.message)}</p>
        </div>
        <span class="notif-history-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join("");
}

function showTestResult(message) {
  const el = document.getElementById("testResult");
  if (el) {
    el.textContent = message;
    setTimeout(() => { el.textContent = ""; }, 5000);
  }
}

async function initNotifications() {
  // Ensure notification state exists (for users with existing localStorage)
  if (!state.notifications) {
    state.notifications = structuredClone(defaults.notifications);
    saveState();
  }

  // Register service worker
  await registerServiceWorker();

  // Mirror the schedule to the SW and enable background check-ins so
  // reminders fire even when the tab is closed or the device is offline
  syncScheduleToSW(state);
  enableBackgroundCheckins().catch(() => {});

  // Permission button
  document.getElementById("requestPermBtn")?.addEventListener("click", async () => {
    const result = await requestPermission();
    updatePermissionBadge();
    if (result === "granted") {
      showTestResult("Notifications enabled!");
      syncScheduleToSW(state);
      enableBackgroundCheckins().catch(() => {});
    }
  });

  // Channel toggles
  document.getElementById("toggleBrowser")?.addEventListener("change", (e) => {
    state.notifications.browserEnabled = e.target.checked;
    saveState();
  });

  document.getElementById("toggleSw")?.addEventListener("change", (e) => {
    state.notifications.swEnabled = e.target.checked;
    saveState();
  });

  document.getElementById("toggleEmail")?.addEventListener("change", (e) => {
    state.notifications.emailEnabled = e.target.checked;
    document.getElementById("emailConfigPanel").style.display = e.target.checked ? "block" : "none";
    saveState();
  });

  document.getElementById("toggleSound")?.addEventListener("change", (e) => {
    state.notifications.soundEnabled = e.target.checked;
    saveState();
  });

  // Test buttons
  document.getElementById("testBrowser")?.addEventListener("click", () => {
    const result = testBrowserNotification();
    showTestResult(result.ok ? "Browser notification sent!" : `Failed: ${result.reason}`);
  });

  document.getElementById("testSw")?.addEventListener("click", () => {
    const result = testSwNotification();
    showTestResult(result.ok ? "Push notification sent \u2014 check another tab!" : `Failed: ${result.reason}`);
  });

  document.getElementById("testEmail")?.addEventListener("click", async () => {
    showTestResult("Sending test email...");
    const result = await testEmailNotification(state);
    showTestResult(result.ok ? "Email sent \u2014 check your inbox!" : `Failed: ${result.reason}`);
  });

  // Add reminder button
  document.getElementById("addReminder")?.addEventListener("click", () => {
    state.notifications.schedule.push({
      time: "08:00",
      title: "New Reminder",
      message: "Your custom reminder message.",
      enabled: true,
      emailDigest: false
    });
    saveState();
    renderScheduleTable();
  });

  renderNotificationUI();

  // Listen for notification events to update the history UI
  onNotification(() => {
    renderNotifHistory();
  });

  // Start the notification scheduler
  startScheduler(() => state, saveState);
}

// -----------------------------------------------------------------------
// Cloud Sync
// -----------------------------------------------------------------------

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
