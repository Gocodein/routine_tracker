// Notification engine for AI Engineer OS.
//
// Channels:
//   1. Browser Notifications — fires when tab is visible (Notification API)
//   2. Service Worker Push   — fires even with tab in background
//   3. Email Digest          — daily summary via EmailJS
//
// The scheduler uses setTimeout targeting the next event rather than a
// fixed-interval setInterval.  Page Visibility API catches up on missed
// reminders whenever the user returns to the tab.  Missed reminders are
// shown in a grouped catch-up notification so nothing slips through.

import { emailjsEnabled, emailjsConfig } from "./emailjs-config.js";

let swRegistration = null;
let emailjsSdk = null;
let emailjsLoading = null;
let getAppState = null;
let saveStateFn = null;
let schedulerTimer = null;
let notifListeners = [];

// ---------------------------------------------------------------------------
// Default schedule — matches 10_Notification_Checkins.md
// ---------------------------------------------------------------------------

export const defaultSchedule = [
  { time: "06:00", title: "Wake Routine",   message: "Wake up, drink water, no phone for 20 minutes. Today starts now.", enabled: true, priority: "high" },
  { time: "06:15", title: "Workout",        message: "Start workout. Minimum standard: move for 30 minutes.",           enabled: true, priority: "normal" },
  { time: "07:45", title: "Deep Study",     message: "Begin DSA or AI/ML deep work. One clear objective only.",          enabled: true, priority: "high" },
  { time: "14:30", title: "Project Block",  message: "Move DETECTOR AI or AI/ML learning forward by one visible step.", enabled: true, priority: "high" },
  { time: "17:00", title: "Coding Block",   message: "Solve DSA or improve code. Review the mistake, not just the answer.", enabled: true, priority: "normal" },
  { time: "21:30", title: "Reflection",     message: "Update daily planner, habits, and tomorrow's first priority.",     enabled: true, priority: "high", emailDigest: true },
  { time: "22:30", title: "Sleep",          message: "Shut down. Tomorrow needs energy.",                                enabled: true, priority: "normal" }
];

// ---------------------------------------------------------------------------
// Time utilities
// ---------------------------------------------------------------------------

function todayKey() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function currentHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function msUntilMinute(targetMin) {
  const now = new Date();
  const currentMs = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds();
  const targetMs = targetMin * 60000;
  let diff = targetMs - currentMs;
  if (diff < 0) diff += 86400000; // next day
  return diff;
}

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    // Notify the user when a new version of the app is installed
    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showToast("Update ready", "A new version is available. Refresh to update.", "normal", false);
        }
      });
    });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "NAVIGATE_SECTION" && typeof window.__navigateSection === "function") {
        window.__navigateSection(event.data.section);
      }
      if (event.data?.type === "REMINDERS_FIRED_IN_SW") {
        // SW fired reminders while we were away — merge so we don't double-fire
        mergeSwFiredIntoState().catch(() => {});
      }
    });

    return swRegistration;
  } catch (err) {
    console.warn("SW registration failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offline reminder support — mirror schedule to the service worker (IndexedDB)
// and register background sync so reminders fire with the tab closed.
// ---------------------------------------------------------------------------

const IDB_NAME = "ai-os-db";
const IDB_STORE = "kv";

function idbGetKey(key) {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) return resolve(undefined);
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      try {
        const db = req.result;
        const get = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
        get.onsuccess = () => { db.close(); resolve(get.result); };
        get.onerror = () => { db.close(); resolve(undefined); };
      } catch { resolve(undefined); }
    };
    req.onerror = () => resolve(undefined);
  });
}

async function mergeSwFiredIntoState() {
  if (!getAppState || !saveStateFn) return;
  const fired = await idbGetKey("firedToday");
  if (!fired || fired._date !== todayKey()) return;

  const state = getAppState();
  const notif = state.notifications;
  if (!notif) return;

  let changed = false;
  Object.keys(fired).forEach((key) => {
    if (key === "_date") return;
    if (!notif.firedToday[key]) {
      notif.firedToday[key] = true;
      changed = true;
    }
  });
  if (changed) saveStateFn();
}

export function syncScheduleToSW(state) {
  const controller = navigator.serviceWorker?.controller || swRegistration?.active;
  if (!controller) return;

  const notif = state?.notifications;
  if (!notif) return;

  const fired = { _date: todayKey() };
  Object.keys(notif.firedToday || {}).forEach((key) => {
    if (key.startsWith(todayKey())) fired[key] = true;
  });

  controller.postMessage({
    type: "SYNC_SCHEDULE",
    swEnabled: !!notif.swEnabled,
    schedule: (notif.schedule || []).map((item) => ({
      time: item.time,
      title: item.title,
      message: item.message,
      enabled: !!item.enabled,
      priority: item.priority || "normal"
    })),
    firedToday: fired
  });
}

export async function enableBackgroundCheckins() {
  if (!swRegistration) return { periodic: false, sync: false };
  const result = { periodic: false, sync: false };

  // Periodic Background Sync — lets the SW wake up regularly, even offline
  if ("periodicSync" in swRegistration) {
    try {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") {
        await swRegistration.periodicSync.register("ai-os-checkin", {
          minInterval: 15 * 60 * 1000
        });
        result.periodic = true;
      }
    } catch { /* not supported or denied */ }
  }

  // One-off Background Sync — fires a reminder check when connectivity returns
  if ("sync" in swRegistration) {
    try {
      await swRegistration.sync.register("ai-os-reminder-sync");
      result.sync = true;
    } catch { /* not supported */ }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

export function getPermissionState() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

export async function requestPermission() {
  if (!("Notification" in window)) return "unsupported";
  const result = await Notification.requestPermission();
  return result;
}

// ---------------------------------------------------------------------------
// Notification dispatch
// ---------------------------------------------------------------------------

function playAlertSound(priority) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (priority === "high") {
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.start();
      osc.frequency.setValueAtTime(1046, ctx.currentTime + 0.15);
      osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.frequency.value = 660;
      gain.gain.value = 0.1;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    }
  } catch { /* audio context may not be available */ }
}

function showBrowserNotification(title, body, priority) {
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "assets/ai-os-mark.svg",
      tag: "ai-os-" + title.toLowerCase().replace(/\s+/g, "-"),
      renotify: true,
      requireInteraction: priority === "high",
      silent: false
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    showSwNotification(title, body);
  }
}

function showSwNotification(title, body, section) {
  if (!swRegistration?.active) return;
  swRegistration.active.postMessage({
    type: "SHOW_NOTIFICATION",
    title,
    body,
    tag: "ai-os-" + title.toLowerCase().replace(/\s+/g, "-"),
    section: section || "dashboard"
  });
}

// ---------------------------------------------------------------------------
// In-app toast system
// ---------------------------------------------------------------------------

function showToast(title, body, priority, isCatchUp) {
  const container = document.getElementById("notifToast");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${priority || "normal"}${isCatchUp ? " toast-catchup" : ""}`;
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon">${priority === "high" ? "🔴" : "🔔"}</span>
      <strong>${escapeHtml(title)}</strong>
      ${isCatchUp ? '<span class="toast-badge">Missed</span>' : ""}
      <button class="toast-close" type="button">&times;</button>
    </div>
    <p class="toast-body">${escapeHtml(body)}</p>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);

  // Auto dismiss after 8s (high priority) or 5s (normal)
  const delay = priority === "high" ? 8000 : 5000;
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add("toast-exit");
      setTimeout(() => toast.remove(), 300);
    }
  }, delay);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// Notification log (persisted in state)
// ---------------------------------------------------------------------------

function logNotification(state, item, type) {
  if (!state.notifications.log) state.notifications.log = [];
  state.notifications.log.unshift({
    time: currentHHMM(),
    date: todayKey(),
    title: item.title,
    message: item.message,
    type, // "fired" | "missed" | "catchup"
    priority: item.priority || "normal"
  });
  // Keep last 50 entries
  if (state.notifications.log.length > 50) {
    state.notifications.log.length = 50;
  }
}

// Dispatch to the user: used for both live and catch-up scenarios
function dispatch(item, state, isCatchUp) {
  const notif = state.notifications;
  const priority = item.priority || "normal";

  // Always show in-app toast
  showToast(item.title, item.message, priority, isCatchUp);

  // Play sound for live (non-catchup) notifications
  if (!isCatchUp && notif.soundEnabled !== false) {
    playAlertSound(priority);
  }

  // Browser notification
  if (notif.browserEnabled) {
    showBrowserNotification(item.title, item.message, priority);
  }

  // Service worker notification (works in background)
  if (notif.swEnabled) {
    showSwNotification(item.title, item.message, "notifications");
  }

  // Email digest (only on items marked emailDigest)
  if (notif.emailEnabled && item.emailDigest && !isCatchUp) {
    sendEmailDigest(state).catch(() => {});
  }

  // Log it
  logNotification(state, item, isCatchUp ? "catchup" : "fired");

  // Notify listeners (for UI updates)
  notifListeners.forEach((fn) => fn(item, isCatchUp));
}

// ---------------------------------------------------------------------------
// EmailJS — lazy load and send
// ---------------------------------------------------------------------------

async function loadEmailJs() {
  if (emailjsSdk) return emailjsSdk;
  if (emailjsLoading) return emailjsLoading;

  emailjsLoading = new Promise((resolve, reject) => {
    if (window.emailjs) {
      emailjsSdk = window.emailjs;
      emailjsSdk.init(emailjsConfig.publicKey);
      resolve(emailjsSdk);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    script.onload = () => {
      emailjsSdk = window.emailjs;
      emailjsSdk.init(emailjsConfig.publicKey);
      resolve(emailjsSdk);
    };
    script.onerror = () => reject(new Error("Failed to load EmailJS SDK"));
    document.head.appendChild(script);
  });

  return emailjsLoading;
}

function buildDailySummary(state) {
  const habitDefs = [
    ["wake", "Wake early"], ["workout", "Workout"], ["dsa", "DSA"],
    ["aiml", "AI/ML study"], ["project", "DETECTOR AI"], ["resume", "Resume"],
    ["innovocon", "InnovoCon"], ["github", "GitHub"], ["reading", "Reading"],
    ["sleep", "Sleep"], ["scroll", "No scroll"]
  ];

  const completedHabits = habitDefs.filter(([key]) => state.habits?.[key]).map(([, label]) => label);
  const pendingHabits = habitDefs.filter(([key]) => !state.habits?.[key]).map(([, label]) => label);
  const doneTasks = (state.tasks || []).filter((t) => t.done).map((t) => t.text);
  const pendingTasks = (state.tasks || []).filter((t) => !t.done).map((t) => t.text);
  const dsaCount = (state.dsa || []).length;
  const totalHabits = habitDefs.length;
  const score = Math.min(10, completedHabits.length + doneTasks.length);

  const lines = [
    `══════════════════════════════════════`,
    `   AI ENGINEER OS — DAILY REVIEW`,
    `   ${state.activeDate || new Date().toISOString().slice(0, 10)}`,
    `══════════════════════════════════════`,
    ``,
    `📊 DAILY SCORE: ${score}/10`,
    ``,
    `──────────────────────────────────────`,
    `✅ HABITS COMPLETED (${completedHabits.length}/${totalHabits})`,
    `──────────────────────────────────────`,
    completedHabits.length > 0 ? completedHabits.map((h) => `  ✓ ${h}`).join("\n") : "  (none)",
    ``,
    `──────────────────────────────────────`,
    `❌ HABITS MISSED (${pendingHabits.length})`,
    `──────────────────────────────────────`,
    pendingHabits.length > 0 ? pendingHabits.map((h) => `  ✗ ${h}`).join("\n") : "  ★ Perfect day!",
    ``,
    `──────────────────────────────────────`,
    `📋 TASKS COMPLETED (${doneTasks.length})`,
    `──────────────────────────────────────`,
    doneTasks.length > 0 ? doneTasks.map((t) => `  ✓ ${t}`).join("\n") : "  (none)",
    ``,
    `──────────────────────────────────────`,
    `⏳ TASKS STILL PENDING (${pendingTasks.length})`,
    `──────────────────────────────────────`,
    pendingTasks.length > 0 ? pendingTasks.map((t) => `  → ${t}`).join("\n") : "  ★ All clear!",
    ``,
    `──────────────────────────────────────`,
    `🧠 DSA PROBLEMS LOGGED: ${dsaCount}`,
    `──────────────────────────────────────`,
    ``
  ];

  // Include reflections if filled
  const reflections = state.reflections || {};
  if (reflections.win || reflections.lesson) {
    lines.push(`──────────────────────────────────────`);
    lines.push(`💭 REFLECTIONS`);
    lines.push(`──────────────────────────────────────`);
    if (reflections.win) lines.push(`  Win: ${reflections.win}`);
    if (reflections.lesson) lines.push(`  Lesson: ${reflections.lesson}`);
    if (reflections.tomorrow) lines.push(`  Tomorrow's #1: ${reflections.tomorrow}`);
    lines.push(``);
  }

  lines.push(`── AI Engineer OS`);
  return lines.join("\n");
}

export async function sendEmailDigest(state) {
  if (!emailjsEnabled) return { ok: false, reason: "EmailJS not configured — open emailjs-config.js" };

  try {
    const sdk = await loadEmailJs();
    const body = buildDailySummary(state);
    await sdk.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
      subject: `AI Engineer OS — Daily Review (${state.activeDate || "today"})`,
      body,
      to_email: emailjsConfig.recipientEmail
    });
    return { ok: true };
  } catch (err) {
    console.warn("Email send failed:", err);
    return { ok: false, reason: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Test functions (called by UI test buttons)
// ---------------------------------------------------------------------------

export function testBrowserNotification() {
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "Permission not granted — click 'Enable Notifications' first" };
  }
  showBrowserNotification("Test — Browser Notification", "If you see this, browser notifications work!", "normal");
  showToast("Test — Browser Notification", "If you see this, browser notifications work!", "normal", false);
  return { ok: true };
}

export function testSwNotification() {
  if (!swRegistration?.active) {
    return { ok: false, reason: "Service worker not active — reload the page" };
  }
  showSwNotification("Test — Background Push", "If you see this in another tab, SW push works!", "notifications");
  showToast("Test — Background Push", "Sent! Switch to another tab to verify.", "normal", false);
  return { ok: true };
}

export async function testEmailNotification(state) {
  return sendEmailDigest(state || {});
}

// ---------------------------------------------------------------------------
// Scheduler — the core engine
// ---------------------------------------------------------------------------

const FIRE_WINDOW = 3;    // minutes — fire if within this window of scheduled time
const CATCHUP_WINDOW = 60; // minutes — show as "missed" if within this window

function processSchedule(isCatchUp) {
  if (!getAppState || !saveStateFn) return;

  const state = getAppState();
  const notif = state.notifications;
  if (!notif) return;

  const today = todayKey();
  const now = nowMinutes();

  // Reset fired tracking on new day
  if (notif._firedDate !== today) {
    notif.firedToday = {};
    notif._firedDate = today;
    notif._emailSentToday = false;
  }

  const schedule = notif.schedule || [];
  let anyFired = false;

  schedule.forEach((item) => {
    if (!item.enabled) return;

    const key = `${today}_${item.time}`;
    if (notif.firedToday[key]) return;

    const itemMin = timeToMinutes(item.time);
    const diff = now - itemMin; // positive = past, negative = future

    if (diff >= 0 && diff <= FIRE_WINDOW) {
      // Within fire window — send notification
      notif.firedToday[key] = true;
      dispatch(item, state, false);
      anyFired = true;
    } else if (isCatchUp && diff > FIRE_WINDOW && diff <= CATCHUP_WINDOW) {
      // Missed but recent — show catch-up notification
      notif.firedToday[key] = true;
      dispatch(item, state, true);
      anyFired = true;
    } else if (diff > CATCHUP_WINDOW) {
      // Too old — silently mark as fired
      notif.firedToday[key] = true;
      logNotification(state, item, "missed");
      anyFired = true;
    }
  });

  // Auto daily review email at end of day
  if (notif.emailEnabled && !notif._emailSentToday && now >= timeToMinutes("21:30")) {
    notif._emailSentToday = true;
    sendEmailDigest(state).catch(() => {});
    anyFired = true;
  }

  if (anyFired) {
    saveStateFn();
  }

  // Keep the service worker's offline schedule mirror up to date
  syncScheduleToSW(state);

  // Update "next up" widget
  updateNextUp(state);

  // Schedule the next check
  scheduleNextCheck(state);
}

function updateNextUp(state) {
  const notif = state.notifications;
  if (!notif) return;

  const schedule = notif.schedule || [];
  const today = todayKey();
  const now = nowMinutes();

  let nextItem = null;
  let nextMin = Infinity;

  schedule.forEach((item) => {
    if (!item.enabled) return;
    const key = `${today}_${item.time}`;
    if (notif.firedToday[key]) return;
    const itemMin = timeToMinutes(item.time);
    if (itemMin > now && itemMin < nextMin) {
      nextMin = itemMin;
      nextItem = item;
    }
  });

  // Update the UI
  const widget = document.getElementById("nextUpWidget");
  if (!widget) return;

  if (nextItem) {
    widget.style.display = "block";
    const timeEl = document.getElementById("nextUpTime");
    const titleEl = document.getElementById("nextUpTitle");
    const msgEl = document.getElementById("nextUpMessage");
    const countdown = document.getElementById("nextUpCountdown");
    if (timeEl) timeEl.textContent = nextItem.time;
    if (titleEl) titleEl.textContent = nextItem.title;
    if (msgEl) msgEl.textContent = nextItem.message;
    if (countdown) {
      const minsLeft = nextMin - now;
      const h = Math.floor(minsLeft / 60);
      const m = minsLeft % 60;
      countdown.textContent = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
    }
  } else {
    widget.style.display = "none";
  }
}

function scheduleNextCheck(state) {
  clearTimeout(schedulerTimer);

  const notif = state.notifications;
  if (!notif) return;

  const schedule = notif.schedule || [];
  const today = todayKey();
  const now = nowMinutes();

  // Find the next upcoming event
  let nextMin = Infinity;
  schedule.forEach((item) => {
    if (!item.enabled) return;
    const key = `${today}_${item.time}`;
    if (notif.firedToday[key]) return;
    const itemMin = timeToMinutes(item.time);
    if (itemMin > now && itemMin < nextMin) {
      nextMin = itemMin;
    }
  });

  if (nextMin === Infinity) {
    // No more events today — check again in 15 minutes (for midnight rollover)
    schedulerTimer = setTimeout(() => processSchedule(false), 15 * 60 * 1000);
    return;
  }

  // Schedule a check 10 seconds after the event time
  const ms = msUntilMinute(nextMin) + 10000;
  // But also run a safety check every 60 seconds in case setTimeout drifts
  const safetyMs = Math.min(ms, 60000);

  schedulerTimer = setTimeout(() => processSchedule(false), safetyMs);
}

// ---------------------------------------------------------------------------
// Visibility change — catch up on missed reminders
// ---------------------------------------------------------------------------

function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    // User returned to tab — catch up on anything missed
    processSchedule(true);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startScheduler(stateGetter, saveState) {
  getAppState = stateGetter;
  saveStateFn = saveState;
  stopScheduler();

  // Listen for tab focus changes
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Merge anything the SW fired while the tab was closed, then catch up
  mergeSwFiredIntoState()
    .catch(() => {})
    .finally(() => processSchedule(true));
}

export function stopScheduler() {
  clearTimeout(schedulerTimer);
  schedulerTimer = null;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
}

export function getNextReminder(state) {
  const notif = state?.notifications;
  if (!notif) return null;

  const schedule = notif.schedule || [];
  const today = todayKey();
  const now = nowMinutes();

  let nextItem = null;
  let nextMin = Infinity;

  schedule.forEach((item) => {
    if (!item.enabled) return;
    const key = `${today}_${item.time}`;
    if (notif.firedToday?.[key]) return;
    const itemMin = timeToMinutes(item.time);
    if (itemMin > now && itemMin < nextMin) {
      nextMin = itemMin;
      nextItem = item;
    }
  });

  return nextItem;
}

export function getNotificationLog(state) {
  return state?.notifications?.log || [];
}

export function onNotification(callback) {
  notifListeners.push(callback);
  return () => {
    notifListeners = notifListeners.filter((fn) => fn !== callback);
  };
}
