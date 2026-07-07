# AI Engineer Operating System

This is your personal operating system for becoming an AI/ML engineer while staying consistent with college, health, DETECTOR AI, InnovoCon, placements, and GitHub.

The system is intentionally simple:

- Plan the day in 5 minutes.
- Execute the top 3 tasks.
- Track the habits that matter.
- Move one AI/project task forward daily.
- Review weekly and monthly with numbers, not vague feelings.

## Folder Map

```text
AI-Engineer-OS/
  app/
    index.html
    app.js
    styles.css
    server.mjs
    firebase-config.js
    firebase-sync.js
    assets/
      ai-os-mark.svg
  templates/
    daily_log_template.md
    problem_log_template.md
    project_task_template.md
    weekly_review_template.md
  00_Command_Center.md
  01_Daily_Planner.md
  02_Habit_Tracker.md
  03_DSA_Tracker.md
  04_AI_ML_Roadmap.md
  05_DETECTOR_AI_Project.md
  06_GitHub_Portfolio.md
  07_Placement_Tracker.md
  08_Weekly_Review.md
  09_Monthly_Review.md
  10_Notification_Checkins.md
  BUILD_FROM_SCRATCH.md
  firebase.json
  firestore.rules
  _firebaserc.example
  README.md
```

## Daily Rule

Every day has one main question:

> Did I do enough today to make tomorrow easier?

Minimum viable day:

- Workout or mobility.
- One DSA problem.
- One focused AI/ML or project session.
- One short reflection.

## Weekly Targets

| Area | Weekly Target |
|---|---:|
| Workout | 5 sessions |
| DSA | 10-14 problems |
| AI/ML Study | 6 focused sessions |
| DETECTOR AI Project | 5 progress blocks |
| Resume / Placement | 3 sessions |
| InnovoCon | as needed |
| GitHub | 5 commits |
| Weekly Review | 1 review |

## How To Use This

1. Start with the local app.
2. Fill today's top 3 tasks on the Dashboard.
3. Update habits at night.
4. Log DSA, AI/ML, project, and GitHub progress.
5. Every Sunday, complete the weekly review.
6. At month end, complete the monthly review.

## Running Locally

```powershell
cd AI-Engineer-OS\app
node server.mjs
```

Then open:

```text
http://127.0.0.1:8765/
```

The app includes:

- Dashboard and daily score.
- Top 3 task capture.
- Habit checkboxes.
- DSA problem logging.
- AI/ML roadmap.
- DETECTOR AI project board.
- Weekly and monthly review notes.
- Optional cloud sync so the same data shows up on any device.

Do not over-track. Track only what changes behavior.

## Turning On Cross-Device Sync

By default the app only saves to the browser you're using (`localStorage`), so
progress on your laptop won't show up on your phone. To fix that:

1. Go to the [Firebase console](https://console.firebase.google.com) and create a new project (free tier is enough).
2. In the project, go to **Build → Authentication → Sign-in method** and enable **Google** as a provider.
3. Go to **Build → Firestore Database → Create database**. Start in production mode.
4. In **Project settings → General**, scroll to "Your apps," add a **Web app**, and copy the config object it gives you.
5. Paste those values into `firebase-config.js`, replacing the `PASTE_...` placeholders, and set:
   ```js
   export const firebaseEnabled = true;
   ```
6. In **Firestore → Rules**, paste the contents of `firestore.rules` from this folder and publish. This restricts every user to reading/writing only their own data.
7. Restart `node server.mjs` (or redeploy if using Firebase Hosting) and reload the page.
8. Click **Sign In** in the top bar and sign in with Google. Do the same on your phone or any other device using the same Google account — both devices will now show the same data automatically, live.

Notes:

- Google sign-in popups work out of the box on `http://127.0.0.1` and `http://localhost` and on your Firebase Hosting domain. If you deploy elsewhere, add that domain under **Authentication → Settings → Authorized domains**.
- If you'd rather deploy so you don't need to keep `node server.mjs` running: install the Firebase CLI (`npm install -g firebase-tools`), run `firebase login`, copy `_firebaserc.example` to `.firebaserc` and fill in your project ID, then run `firebase deploy --only hosting,firestore:rules` from inside this folder. You'll get a public `https://YOUR_PROJECT_ID.web.app` URL that works from any device without running a local server at all.
- Without any Firebase setup, the app still works exactly as before, just single-device.
