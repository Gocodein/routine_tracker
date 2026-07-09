// Vercel Serverless Function — Daily Cron Job
//
// Triggered once per day at 10:00 PM IST (4:30 PM UTC) by Vercel cron.
// On Hobby plan this runs once/day — enough for the nightly digest.
//
// Currently a lightweight health-check endpoint.
// The actual notification scheduling and email sending is handled
// client-side by notifications.js.  This endpoint is reserved for
// future Web Push integration when a database backend is added.

export default function handler(req, res) {
  // Verify this is a cron request (optional security check)
  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);

  console.log(`[AI Engineer OS] Daily cron fired at ${istTime.toISOString()} IST`);

  // Future: Web Push dispatch
  // When Firestore is connected, this function will:
  // 1. Read push subscriptions from Firestore
  // 2. Read the user's daily data (habits, tasks, score)
  // 3. Send a Web Push notification with the daily summary
  // 4. Send an email digest via EmailJS REST API

  return res.status(200).json({
    ok: true,
    message: "Daily cron executed",
    timestamp: now.toISOString(),
    ist: istTime.toISOString()
  });
}
