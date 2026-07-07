# Build From Scratch Guide

Use this guide if you want to rebuild the system in Notion, Google Sheets, Google Calendar, or another tool.

## System Philosophy

The OS has four layers:

1. Command Center: shows what matters now.
2. Execution: daily planner and time blocks.
3. Trackers: habits, DSA, AI/ML, projects, GitHub, placements.
4. Reviews: weekly and monthly decisions.

If a page does not help you execute, track, or review, do not add it.

## Build Order

### Step 1: Command Center

Create one home page named:

```text
AI Engineer OS
```

Add sections:

- Today.
- Top 3 Tasks.
- Daily Scoreboard.
- Active Projects.
- Weekly Rules.
- Links to all trackers.

### Step 2: Daily Planner Database

Database name:

```text
Daily Logs
```

Properties:

| Property | Type |
|---|---|
| Date | Date |
| Wake Time | Text |
| Energy | Select: Low, Medium, High |
| Top 1 | Text |
| Top 2 | Text |
| Top 3 | Text |
| Workout | Checkbox |
| DSA | Checkbox |
| AI/ML | Checkbox |
| Project | Checkbox |
| GitHub | Checkbox |
| Reflection | Text |
| Score | Number |

Default views:

- Today.
- This Week.
- Calendar.

### Step 3: Habit Tracker Database

Database name:

```text
Habits
```

Properties:

| Property | Type |
|---|---|
| Date | Date |
| Wake Early | Checkbox |
| Workout | Checkbox |
| DSA | Checkbox |
| AI/ML Study | Checkbox |
| Project Progress | Checkbox |
| GitHub | Checkbox |
| Reading | Checkbox |
| Sleep | Checkbox |
| No Scroll | Checkbox |
| Notes | Text |

Formula idea:

```text
Completed Habits = count of checked habits
```

### Step 4: DSA Tracker Database

Database name:

```text
DSA Problems
```

Properties:

| Property | Type |
|---|---|
| Problem | Title |
| Date | Date |
| Platform | Select |
| Topic | Multi-select |
| Difficulty | Select: Easy, Medium, Hard |
| Time Taken | Number |
| Solved | Checkbox |
| Pattern | Text |
| Mistake | Text |
| Revision 1 | Date |
| Revision 2 | Date |
| Link | URL |

Views:

- By Topic.
- Unsolved.
- Revision Due.
- This Week.

### Step 5: AI/ML Learning Database

Database name:

```text
AI ML Roadmap
```

Properties:

| Property | Type |
|---|---|
| Topic | Title |
| Phase | Select: Foundation, Deep Learning, Portfolio |
| Status | Select: Pending, Active, Completed |
| Confidence | Number |
| Proof of Work | Text |
| Resource | URL |
| Notes | Text |

Views:

- Active Topics.
- By Phase.
- Completed.

### Step 6: Project Tracker Database

Database name:

```text
Projects
```

Properties:

| Property | Type |
|---|---|
| Task | Title |
| Project | Select |
| Milestone | Select |
| Priority | Select: High, Medium, Low |
| Status | Select: Backlog, Active, Blocked, Done |
| Due Date | Date |
| Next Action | Text |
| Result | Text |

Views:

- DETECTOR AI Board.
- Active Tasks.
- Blocked.
- Completed This Week.

### Step 7: GitHub Tracker Database

Database name:

```text
GitHub Log
```

Properties:

| Property | Type |
|---|---|
| Date | Date |
| Repository | Text |
| Work Done | Text |
| Commit / PR | URL |
| Time Spent | Number |
| Category | Select: Feature, Fix, Docs, Experiment, Refactor |

### Step 8: Placement Tracker Database

Database name:

```text
Placement Tracker
```

Properties:

| Property | Type |
|---|---|
| Company | Title |
| Role | Text |
| Status | Select: Researching, Applied, OA, Interview, Rejected, Offer |
| Applied Date | Date |
| Next Step | Text |
| Deadline | Date |
| Notes | Text |

### Step 9: Review Templates

Create two templates:

- Weekly Review.
- Monthly Review.

Each review must include:

- Numbers.
- What worked.
- What failed.
- Root cause.
- Next decision.

## Recommended Calendar Blocks

| Time | Calendar Event |
|---|---|
| 6:00 AM | Wake + Water |
| 6:15 AM | Workout |
| 7:45 AM | DSA / AI Deep Work |
| 2:30 PM | AI Project Block |
| 5:00 PM | DSA / Coding |
| 9:30 PM | Night Reflection |
| 10:30 PM | Sleep |

## First 7 Days Setup Plan

| Day | Build |
|---:|---|
| 1 | Command Center + Daily Logs |
| 2 | Habit Tracker + check-ins |
| 3 | DSA Tracker |
| 4 | AI/ML Roadmap |
| 5 | DETECTOR AI Project board |
| 6 | GitHub + Placement trackers |
| 7 | Weekly Review and cleanup |

## Keep It Lean

Do not add more trackers until the current ones are being used for two weeks.

The system should feel like a cockpit, not a museum.
