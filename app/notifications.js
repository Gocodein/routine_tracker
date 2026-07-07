// Notification engine for AI Engineer OS.
//
// Three channels:
//   1. Browser Notifications — fires when tab is open (Notification API)
//   2. Service Worker Push   — fires even with tab in background
//   3. Email Digest          — daily summary via EmailJS at the configured time
//
// The scheduler runs every 30 seconds and compares current time against the
// configured reminder schedule. A ±1 minute window prevents missed fires.
// Each fired notification is recorded in state.notifications.firedToday so
// page refreshes won't re-fire the same reminder.

import { emailjsEnabled, emailjsConfig } from "./emailjs-config.js";

let swRegistration = null;
let emailjsSdk = null;
let emailjsLoading = null;
let getAppState = null;

// ---------------------------------------------------------------------------
// Default schedule — matches 10_Notification_Checkins.md
// ---------------------------------------------------------------------------

const defaultSchedule = [
  { time: "06:00", title: "Wake Routine", message: "Wake up, drink water, no phone for 20 minutes. Today starts now.", enabled: true },
  { time: "06:15", title: "Workout", message: "Start workout. Minimum standard: move for 30 minutes.", enabled: true },
  { time: "07:45", title: "Deep Study", message: "Begin DSA or AI/ML deep work. One clear objective only.", enabled: true },
  { time: "14:30", title: "Project Block", message: "Move DETECTOR AI or AI/ML learning forward by one visible step.", enabled: true },
  { time: "17:00", title: "Coding Block", message: "Solve DSA or improve code. Review the mistake, not just the answer.", enabled: true },
  { time: "21:30", title: "Reflection", message: "Update daily planner, habits, and tomorrow's first priority.", enabled: true, emailDigest: true },
  { time: "22:30", title: "Sleep", message: "Shut down. Tomorrow needs energy.", enabled: true }
];

export { defaultSchedule };

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "NAVIGATE_SECTION" && typeof window.__navigateSection === "function") {
        window.__navigateSection(event.data.section);
      }
    });

    return swRegistration;
  } catch (err) {
    console.warn("SW registration failed:", err);
    return null;
  }
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

function showBrowserNotification(title, body) {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: "assets/ai-os-mark.svg",
      tag: "ai-os-" + title.toLowerCase().replace(/\s+/g, "-"),
      renotify: true
    });
  } catch {
    // Fallback to SW if direct Notification fails (e.g. on mobile)
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
  const habits = [
    ["wake", "Wake early"], ["workout", "Workout"], ["dsa", "DSA"],
    ["aiml", "AI/ML study"], ["project", "DETECTOR AI"], ["resume", "Resume"],
    ["innovocon", "InnovoCon"], ["github", "GitHub"], ["reading", "Reading"],
    ["sleep", "Sleep"], ["scroll", "No scroll"]
  ];

  const completedHabits = habits.filter(([key]) => state.habits?.[key]).map(([, label]) => label);
  const pendingHabits = habits.filter(([key]) => !state.habits?.[key]).map(([, label]) => label);
  const doneTasks = (state.tasks || []).filter((t) => t.done).map((t) => t.text);
  const pendingTasks = (state.tasks || []).filter((t) => !t.done).map((t) => t.text);
  const dsaCount = (state.dsa || []).length;

  const lines = [
    `📊 AI Engineer OS — Daily Summary`,
    `Date: ${state.activeDate || new Date().toISOString().slice(0, 10)}`,
    ``,
    `✅ Habits Done (${completedHabits.length}/${habits.length}):`,
    completedHabits.length > 0 ? completedHabits.map((h) => `  • ${h}`).join("\n") : "  (none)",
    ``,
    `❌ Habits Missed:`,
    pendingHabits.length > 0 ? pendingHabits.map((h) => `  • ${h}`).join("\n") : "  (none — perfect day!)",
    ``,
    `📋 Tasks Done (${doneTasks.length}):`,
    doneTasks.length > 0 ? doneTasks.map((t) => `  • ${t}`).join("\n") : "  (none)",
    ``,
    `⏳ Tasks Pending:`,
    pendingTasks.length > 0 ? pendingTasks.map((t) => `  • ${t}`).join("\n") : "  (all clear!)",
    ``,
    `🧠 DSA Problems Logged: ${dsaCount}`,
    ``,
    `— AI Engineer OS`
  ];

  return lines.join("\n");
}

export async function sendEmailDigest(state) {
  if (!emailjsEnabled) return { ok: false, reason: "EmailJS not enabled" };

  try {
    const sdk = await loadEmailJs();
    const body = buildDailySummary(state);
    await sdk.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
      subject: `AI Engineer OS — Daily Summary (${state.activeDate || "today"})`,
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
    return { ok: false, reason: "Permission not granted" };
  }
  showBrowserNotification("Test — Browser Notification", "If you see this, browser notifications are working!");
  return { ok: true };
}

export function testSwNotification() {
  if (!swRegistration?.active) {
    return { ok: false, reason: "Service worker not registered" };
  }
  showSwNotification("Test — Service Worker Push", "If you see this while in another tab, SW push is working!", "notifications");
  return { ok: true };
}

export async function testEmailNotification(state) {
  return sendEmailDigest(state || {});
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let schedulerInterval = null;

function todayKey() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function currentHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function timeDistance(a, b) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return Math.abs((ah * 60 + am) - (bh * 60 + bm));
}

function tick(state, saveState) {
  const notif = state.notifications;
  if (!notif) return;

  const today = todayKey();
  const now = currentHHMM();

  // Reset fired tracking on new day
  if (notif._firedDate !== today) {
    notif.firedToday = {};
    notif._firedDate = today;
  }

  const schedule = notif.schedule || [];

  schedule.forEach((item) => {
    if (!item.enabled) return;

    const key = `${today}_${item.time}`;
    if (notif.firedToday[key]) return;

    // Check within ±1 minute window
    if (timeDistance(now, item.time) > 1) return;

    // Mark as fired
    notif.firedToday[key] = true;

    // Dispatch to enabled channels
    if (notif.browserEnabled) {
      showBrowserNotification(item.title, item.message);
    }

    if (notif.swEnabled) {
      showSwNotification(item.title, item.message, "notifications");
    }

    // Email digest fires only on the reminder marked with emailDigest
    if (notif.emailEnabled && item.emailDigest) {
      sendEmailDigest(state).catch(() => {});
    }

    saveState();
  });
}

export function startScheduler(stateGetter, saveState) {
  getAppState = stateGetter;
  stopScheduler();
  schedulerInterval = setInterval(() => {
    const state = getAppState();
    tick(state, saveState);
  }, 30000); // every 30 seconds

  // Also run immediately
  const state = getAppState();
  tick(state, saveState);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
