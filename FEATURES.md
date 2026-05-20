# Pulse — Feature Catalog

> **School Operations, Live.**
> Built on Next.js 16, React 19, Firebase Auth + Firestore, Google Sheets API, and Lucide icons.

This document is the audit-grade reference for everything Pulse currently does, plus the roadmap for what's next. Use it as the source of truth when building slides, onboarding new staff, or scoping integrations.

---

## Table of Contents

1. [Authentication & Access](#1-authentication--access)
2. [Schedule Sync (Google Sheets → Pulse)](#2-schedule-sync-google-sheets--pulse)
3. [Home Dashboard](#3-home-dashboard)
4. [Conflict Report](#4-conflict-report)
5. [Slot Availability Checker](#5-slot-availability-checker)
6. [Workload Analytics](#6-workload-analytics)
7. [Leave Management](#7-leave-management)
8. [Trial Priority & Overview](#8-trial-priority--overview)
9. [Free Instructor Finder](#9-free-instructor-finder)
10. [Master Schedule View](#10-master-schedule-view)
11. [Input Trial Leads](#11-input-trial-leads)
12. [Instructor Profiles](#12-instructor-profiles)
13. [API Endpoints](#13-api-endpoints)
14. [Admin Settings](#14-admin-settings)
15. [Cross-Cutting Behaviors](#15-cross-cutting-behaviors)
16. [Roadmap (What We Can Do Next)](#16-roadmap-what-we-can-do-next)
17. [Suggested Slide Talking Points](#17-suggested-slide-talking-points)

---

## 1. Authentication & Access

### 1.1 Firebase Authentication
- Email + password login.
- Username-only login auto-resolves to `{username}@schedule.local` for staff without a real email.
- Glassmorphism login screen with animated background blobs and password show/hide.
- Persistent session via Firebase Auth state listener — survives refresh.

### 1.2 Role-Based Access Control (RBAC)
- Five built-in roles: **Admin, SPA, EC, Instructor, Supervisor**.
- 12 sidebar items independently toggleable per role:
  Home, Conflict Report, Slot Checker, Workload, Leave Management, Trial Priority, Free Finder, Master Schedule, Input Trial Leads, Instructor Profiles, API Documentation, Admin Settings.
- Bulk **All / None** toggles per role.
- Shows `enabled / total` count per role at a glance.
- Auto-backfills new sidebar keys when features are added — no migration drama.

### 1.3 Global Feature Toggles (independent from role permissions)
Toggle entire features off the dashboard for everyone, e.g. hide Conflicts during a maintenance window. Six main features and three sub-column controls — full list in [§14.1 Internal Feature Toggles](#141-internal-feature-toggles). Sub-toggles for Slot Checker columns (Available / Busy / On Leave) and separate switches for Trial Priority and Trial Overview let you create partial views without removing whole pages.

### 1.4 User Management
- Create users without logging the admin out (uses a secondary Firebase app instance).
- Auto-creates Firestore instructor profile on Instructor account creation.
- One-click "Copy Login Credentials" to the clipboard for handoff.
- Send Firebase password-reset email by clicking a row.
- Search users by email, filter by role, paginated table.

---

## 2. Schedule Sync (Google Sheets → Pulse)

### 2.1 Multi-Branch Configuration
- Each branch = `{ id, name, Google Sheets Publish URL }`.
- Inline "Add Branch" form in the header sub-bar.
- Branch tabs at the top of every page; clicking switches the active branch.
- Disable branches without deleting them (preserves history, hides them from filters and sync).
- Disabled branches render greyed-out + struck-through with eye-off icon.
- Auto-failover to first enabled branch when the active one gets disabled.

### 2.2 Sync Operations
- **Sync This Branch** — fast single-branch refresh.
- **Sync All Branches** — parallel `Promise.allSettled` across all enabled branches; preserves data from disabled branches.
- Live progress bar across the top header during sync.
- Failed-branches strip with retry button when partial failure occurs.
- Auto-sync triggers if the cache is older than 2 hours on page load.
- Skip rule: refuses to sync a disabled branch with a friendly toast.

### 2.3 Diff Toast (after every sync)
- Compares before/after snapshots.
- Surfaces: **+N classes**, **−N classes**, **+N new conflicts**, **−N conflicts resolved**.
- Shows source-tab failures separately.
- Variant changes by outcome — success (green), warning (orange) on partial fail, error (red) on full fail.

### 2.4 Sheet Parser
- Reads Google Sheets `/pubhtml` to discover day tabs, supports both old HTML and new JS-array formats.
- Parses CSVs in parallel; recovers from partial failures.
- Smart time-string parser:
  - Handles `"10.00 - 11.00 am"`, `"11.00 - 12.00 pm"`, AM-implied/PM-implied combinations.
  - Auto-flips meridiem when start has no AM/PM and the same-meridiem reading would create a backwards interval (the morning-into-noon bug).
- Falls back to last-seen time / teacher / term values to handle merged-cell rows in source sheets.
- Handles "Lesson Arrange Date" column where assigned instructor differs from primary.

### 2.5 Caching
- Schedule, teachers, time slots, last-sync timestamp all persisted to localStorage.
- Restores immediately on page load — no white screen waiting for network.
- Mon–Sat only (Sunday is filtered at the read boundary even if cached data contains it).

---

## 3. Home Dashboard

### 3.1 KPI Strip (top)
- Total Instructors.
- Kinder Instructors (counted from Trial Priority).
- Coder Instructors (counted from Trial Priority).
- On Leave (today and all days, branch-aware).

### 3.2 Branch Carousel + Day/Time Selector
- ‹ All Branches › carousel with arrow buttons.
- Day pill (cycles through days with classes).
- Time slot dropdown — filtered to that day's actual times.
- When day + time selected: Available count and Busy count show below.

### 3.3 Weekly Schedule Trend (60% column)
- **Pill-bar chart** with active-day gradient (purple → indigo) and translucent inactive bars.
- **Hours / Sessions toggle** — switches metric live.
- **Branch dropdown** — independent from the dashboard branch carousel.
- **KPI sub-strip:** Weekly Total, Average / Day, Activity Index.
  - Activity Index = `peak day load ÷ daily average × 100` — green ≤120%, amber 120–160, red >160.
- **Peak chip** in header (e.g. "Peak: Saturday · 95h").
- **Dashed average reference line** crossing the chart.
- **Active-day rule:** selected day → today → busiest day, in that fallback order.
- Hover tooltip: hours, session count, student count, busiest time slot.
- "View Full Master ›" pill → navigates to Master Schedule.

### 3.4 Quick Actions (top-right column)
- Check Instructor Slot → navigates to Slot Checker.
- Request Leave Approval → navigates to Leave Management.
- Hover slide-right animation.

### 3.5 Activity Feed (below Quick Actions)
- Recent admin actions (login, sync, cache load).
- Color-coded dot per event type.
- Scrolls within column.

### 3.6 Instructors in Training (rightmost column)
- Lists every instructor whose `trainingProgress` has any module below its max.
- Sorted lowest progress first (most-needs-attention first).
- Each card shows: name, percentage (red <25%, amber <75%, green ≥75%), thin progress bar, earned/total points, modules-left count, branch location.
- Hover tooltip lists every incomplete module.
- Empty states: "No profiles yet" or "All instructors fully trained".
- "View all ›" → Instructor Profiles.

---

## 4. Conflict Report

### 4.1 Detection Engine
- Cross-branch teacher-time conflicts: same teacher, same day, overlapping intervals (interval-union math).
- Excludes exact-duplicate rows (same time + program + branch).
- Stable conflict identity for pre/post-sync diffing.

### 4.2 Filters & Browse
- Branch carousel (‹ Branch ›).
- Day filter pills (All + Mon–Sat).
- Pagination (5 per page).
- Each conflict card shows: teacher, day, both overlapping slots with branch tags.

### 4.3 Sync Integration
- New conflicts surface as chips in the post-sync toast.
- Conflicts that disappear since last sync also chip-tagged.

---

## 5. Slot Availability Checker

### 5.1 Three-Column Result View
- **Available** (green) — instructors free at the chosen day + time.
- **Busy** (red) — with the program they're teaching and which branch.
- **On Leave** (amber) — with leave reason.

### 5.2 Filters
- Branch dropdown.
- Day dropdown (only days with class data).
- Time dropdown (only times that exist on that day).

### 5.3 Each Column
- Independent pagination.
- Branch-aware instructor selection respecting profile location and disabled lists.

---

## 6. Workload Analytics

### 6.1 Definitions
- **Hours** computed via interval-union per instructor, summed across the school (instructor-hours).
- **Sessions** = distinct (day, time) tuples — group classes count as 1.
- **Students** = distinct student names.
- **Working window**: 10:30 am – 6:30 pm (8h/day).
- **Utilization %** = teaching hours ÷ (active days × 8h).
- **Status bands:** Light <20h/wk, Healthy 20–30h/wk, Overload >30h/wk.

### 6.2 KPI Cards
- Active Instructors.
- Total Teaching Hours.
- Average Hours / Instructor.
- Overloaded count (e.g. 3 / 27).

### 6.3 Top/Bottom Callouts
- Highest Load (instructor + hours).
- Lightest Load (instructor + hours).

### 6.4 Workload Table
- Sortable columns: Instructor, Branch, Weekly Hours (with bar), Sessions, Students, Avg Group Size, Active Days (n/6), Utilization %, Status.
- Center-aligned numeric columns.
- Branch tag pill (special "All Branches" styling).
- Status pill with hover tooltip explaining each band.
- Search + filter by status (All / Overload / Healthy / Light / Idle) with explanatory tooltips.
- Click any row to expand a per-day breakdown.

### 6.5 Per-Day Breakdown (expanded row)
- 6-day grid: hours, sessions, students, busiest start–end window for each day.
- "ON LEAVE" badge on leave days.
- Footer stats: avg session length, avg group size, avg gap between classes, total enrolments, list of overloaded days.

### 6.6 Daily Workload Heatmap
- Rows: top 25 instructors (by current sort).
- Columns: Mon–Sat.
- Color scale: gray (no class), light blue (<4h), amber (4–6h), red (>6h).
- Cell tooltip with hours and session count.
- Branch filter dropdown.
- Working window + threshold legend.

### 6.7 Parser Quality Banner
- Surfaces row count that couldn't be parsed (malformed time strings).
- Shows up to 5 sample rows: instructor · day · "raw time string".
- Lets staff fix the source sheet.

### 6.8 Snapshot History (Firestore-backed)
- **Save Snapshot** button captures every enabled branch's per-instructor totals into Firestore (one doc per branch per date).
- 90-day retention, cleanup-on-write.
- Confirms before overwriting same-day snapshots.
- Skips empty branches automatically.
- Respects parser warnings (unparsed rows excluded, like live view).

### 6.9 Workload History Card
- Lists last 90 days, shown as a clickable date strip + native date picker.
- Branch filter (or All Branches → table groups by branch).
- Snapshot table reuses the live workload columns for consistency.

### 6.10 Instructor Trend (inside History card)
- Single-instructor mode: bar chart of daily hours across history with totals/avg/peak.
- All-instructors mode: vertical bar chart with names at the bottom, totals on top, threshold reference lines (20h amber / 30h red), rotated labels for >8 instructors.
- "Branch taught at" filter — based on actual snapshot data, not just profile tag.
- Selecting a branch also restricts the hours math, not just the visible list.

---

## 7. Leave Management

### 7.1 Mark Leave
- Pick instructor, day, optional reason.
- Prevents duplicates (same person + same day).
- Filters out admin-disabled instructors.

### 7.2 Browse
- Paginated table (8 per page).
- Quick-remove per row.
- "N On Leave" badge in header.

### 7.3 Integration
- Slot Checker, Free Finder, Workload heatmap, Trial Overview all subtract leave from availability/active days.

---

## 8. Trial Priority & Overview

### 8.1 Add Priority Instructor
- Pick instructor (from any synced branch + Firestore profiles).
- Specialization: Kinder & Junior, or Junior & Coder (the latter unlocks Coder trials).
- Location: any branch or "All Branches".
- Working status: Full Time (all days) or Part Time (pick days).
- Auto-detects instructor's branch from profile or class data.
- Auto-creates Firebase auth + Firestore profile in the background.

### 8.2 Bulk Operations
- Multi-select rows with checkboxes.
- Page-wise "select all" + global bulk remove with confirmation.

### 8.3 Trial Overview Matrix
- Rows: 10 fixed 1-hour trial slots (1pm–6:30pm in 30-min increments).
- Columns: Mon–Sat.
- Cell: three colored chips (K / J / C) showing how many qualified trial instructors are free.
- Click any cell → modal showing exactly who's available and who's not (with reason).
- Branch carousel filter.

---

## 9. Free Instructor Finder

### 9.1 Card Grid
- Day tabs (Mon–Sat).
- Branch + Instructor filters.
- Per-time-slot card: ✓ Free list, ✗ Busy list (with the program & branch they're teaching).
- 3 cards per page with prev/next + page-dot navigation.
- Auto-selects first available day.

### 9.2 Cross-Branch Math
- Free across all enabled branches.
- Profile location overrides ("All Branches" instructors visible everywhere).

---

## 10. Master Schedule View

### 10.1 Filterable Table
- Search across teacher, student, program, remarks.
- Branch dropdown (enabled branches).
- Instructor dropdown.
- Day pills (All + Mon–Sat).

### 10.2 Display
- Columns: Day, Time, Program, Instructor, Student Name, Branch, Remarks.
- Pagination (8 per page).
- Hover row-highlight in primary blue.

---

## 11. Input Trial Leads

### 11.1 Three-Pane Workflow
- **Top:** Ready Instructors auto-filtered by program + specialization + active branch + availability.
- **Left:** Program selector (Kinder / Junior / Coder), date picker (month-scoped, Mon–Sat only), available time slots.
- **Right:** Form with auto-filled fields + chatbot quick-fill text area.

### 11.2 Quick Fill
- Paste raw chatbot transcript.
- Auto-extracts: Student name, Date, Day name, Age → Program, Time slot.
- Smart time inference: bare "1" or "5" assumed PM (afternoon hours).
- Random instructor assignment from available pool.

### 11.3 Submit
- Writes to Google Sheets via service account.
- Success/error inline status + toast.

---

## 12. Instructor Profiles

### 12.1 Profile Editor
- Full name, nickname, email, phone, location, specialization.
- 7 training modules with progress sliders:
  - Kinder Foundation (max 2)
  - Kinder Core (max 4)
  - Junior Foundation (max 2)
  - Junior Core (max 4)
  - Coder Basic (max 2)
  - Coder Intermediate (max 2)
  - Coder Advance (max 2)
- Total **18 possible training points**.

### 12.2 Storage
- Firestore `instructorProfiles` collection.
- Document ID = email (stable handle).
- Source of truth for branch tags and specializations across the app.

---

## 13. API Endpoints

### 13.1 `/api/schedule` (GET)
- Server-side Google Sheets scrape (no CORS hassle).
- Discovers day tabs, fetches CSV per tab in parallel.
- Returns parsed classes + teachers + per-day time sets + sync metadata.

### 13.2 `/api/slots` (GET)
- Parameters: `day`, `program` (or `age`), Bearer auth.
- Returns 1-hour trial slots filtered by busy instructors + leave + Trial Priority.
- Designed for chatbot integration (Qontak).

### 13.3 `/api/chatbot-book` (POST)
- Receives a complete booking from a chatbot, saves to Trial Leads sheet.
- Auto-determines program from age.
- Auto-assigns a free, prioritized, on-duty instructor.
- Bearer-token authenticated.

### 13.4 `/api/config` (GET/POST)
- Dual-storage backbone for shared config (branches, leaves, trial priority, role toggles, disabled lists, bug tracker).
- localStorage instant + background sync to Sheets.

### 13.5 In-App API Documentation
- Live page describing endpoints, Postman setup walkthrough, copy-URL buttons, JSON examples.

---

## 14. Admin Settings

### 14.1 Internal Feature Toggles
Hides or shows individual features inside pages, applied globally to every role. Each toggle defaults to ON; flipping one OFF removes the feature from sidebars, dropdowns, and dashboards across the app.

| Toggle | Effect when OFF |
|---|---|
| **Conflict Report** | Hides the Conflict Report page from the sidebar and removes conflict counts from the post-sync toast. |
| **Slot Availability Checker** | Hides the Slot Checker page entirely. |
| ↳ **Available Column** | Slot Checker still loads, but the green "Available" column is hidden. |
| ↳ **Busy Column** | Slot Checker still loads, but the red "Busy" column is hidden. |
| ↳ **On Leave Column** | Slot Checker still loads, but the amber "On Leave" column is hidden. |
| **Leave Management** | Hides the Leave Management page; existing leave data is preserved and still respected by other features. |
| **Trial Priority Instructors** | Hides the Trial Priority assignment table. |
| **Trial Availability Overview** | Hides the 10-slot weekly trial matrix. The Trial Priority page is hidden only when **both** of these are off. |
| **Instructor Workload** | Hides the Workload page (analytics, heatmap, history, snapshots) from every role. |

Sub-column toggles (the indented "↳" rows) let staff create partial Slot Checker views — for example, hide the Busy column to keep the screen focused on who can actually take a class. The two trial toggles work together: if either is on, the Trial Priority sidebar entry stays visible.

### 14.2 Branch Management
- Toggle each branch on/off, sync skips disabled, full disabled badge.

### 14.3 Instructor Management
- Search and disable instructors globally — excluded from finder, leave, trial, workload.

### 14.4 User Management
- Create accounts, assign roles, reset passwords, copy credentials (described in §1).

### 14.5 Role Permissions
- 12 features × 5 roles toggle matrix with bulk actions (described in §1).

### 14.6 Bug Tracker
- Add bugs with title, feature, description.
- Status flow: Not Started → In Progress → Solved.
- Auto-tracks `startedAt` and `solvedAt` timestamps.
- Counters in the tab badge for unresolved bugs.
- Persists via dual-storage to Sheets.

---

## 15. Cross-Cutting Behaviors

### 15.1 Toast System
- Stacked top-right.
- 4 variants: success, warning, error, info.
- Chip-array body for structured details (used by sync diff).
- Auto-dismiss + manual dismiss.
- Mounted at app shell so any view can publish.

### 15.2 Dual Storage Pattern
- Every shared config writes to localStorage (instant) and `/api/config` (background).
- Pulls from API on mount, merges with localStorage as fallback.
- Survives offline and Sheets misconfiguration.

### 15.3 Mon–Sat Workweek
- Hardcoded across the app — schedule API drops Sunday tabs, all loops use a 6-day `DAY_NAMES`, date pickers exclude Sundays.
- Defensive: leftover Sunday rows in cache get filtered at the read boundary.

### 15.4 Branch Identity Resolution
- 3-tier instructor-to-branch mapping:
  1. Firestore profile location wins.
  2. Most-classes branch (if no profile).
  3. First-seen branch (last fallback).
- "All Branches" profile location is honored everywhere.

### 15.5 Mobile/Responsive Posture
- All grids use `flex-wrap` and `auto-fit minmax` patterns.
- Tables horizontally scroll on narrow screens.

---

## 16. Roadmap (What We Can Do Next)

These are designed-for but not yet shipped:

### 16.1 Training Tracker (next big feature)
- Dedicated page expanding "In Training" widget.
- Module deadlines, certifications, badges.
- Reminders + notifications.
- Trainee-to-trainer pairing.
- Cohort view.

### 16.2 Notifications System
- Bell icon already in header (currently empty state).
- Wire in: new conflicts, overdue snapshots, leave approvals, training-due reminders.

### 16.3 Activity Feed (real)
- Replace hardcoded entries with actual event log persisted to Firestore.
- Filter by event type, by user.

### 16.4 Workload Auto-Snapshot
- Vercel cron at 6:30 PM daily as a future upgrade to the manual button.

### 16.5 Conflict Resolution Suggestions
- "Suggest fix" button per conflict using free-finder logic.
- One-click reassignment write-back to Sheets.

### 16.6 Instructor Recommendation Engine for Trials
- Auto-rank top-3 instructors per trial lead (specialization + training level + availability + recent workload).

### 16.7 Audit Log
- Snapshot `overallClasses` after each sync (rolling N versions).
- Diff page: classes added/removed/moved between any two syncs.

### 16.8 Mobile Sidebar
- Collapsible hamburger version.

### 16.9 Dark Mode
- CSS variable system makes this 1 day of work.

### 16.10 Multi-Language (Bahasa Indonesia)
- Project-wide string extraction + i18n provider.

---

## 17. Suggested Slide Talking Points

When you're presenting:

1. **Open** with the problem: "5 branches, 50+ instructors, weekly schedule chaos lived in Google Sheets."
2. **One-liner pitch:** "Pulse turns Google Sheets into live operations intelligence."
3. **Demo flow:** Sync → Diff toast → Conflict → Workload heatmap → Trial Booking via chatbot.
4. **Differentiators:**
   - Multi-branch with cross-branch conflict math.
   - Sub-second sync via parallel fetch.
   - Self-healing time parser (built specifically for your data quirks).
   - Audit-grade history (90-day Firestore snapshots).
   - Chatbot integration via documented API.
5. **Closing:** Training Tracker + Notifications coming next, building toward a full instructor-development platform.

---

*Last updated by maintainer when the catalog drifts from the codebase. Treat this file as source-of-truth for slide content.*
