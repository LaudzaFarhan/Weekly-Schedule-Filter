# New Operations API — Integration Guide for Hermes

Live REST API for The Lab Operation System. Backed by PostgreSQL, JSON in and
JSON out.

**Base URL** `https://weekly-schedule-filter.vercel.app`
**OpenAPI spec** `https://weekly-schedule-filter.vercel.app/api/new/openapi.json`
**Auth** `Authorization: Bearer <API_KEY>` on every `/api/new/*` call

> There is a second API at `/api/old/*` backed by Google Sheets. It holds
> **different data** and is not part of this integration. Ignore it.

---

## 1. Quick start

Point Hermes at the spec URL — it lists every operation, parameter and schema,
so no tool definitions need writing by hand. The spec is public; everything else
needs the key.

```bash
BASE=https://weekly-schedule-filter.vercel.app
KEY=<your key>

# Discovery — no auth
curl $BASE/api/new/openapi.json

# Any data call — auth required
curl -H "Authorization: Bearer $KEY" "$BASE/api/new/instructors?limit=5"
```

If a client cannot set `Authorization`, send `x-api-key: <API_KEY>` instead.

**Responses:** `200` with a JSON array or object. Errors return
`{ "error": "..." }` with a 4xx/5xx status. `401` means the key is missing or
wrong.

---

## 2. Live data snapshot

Verified against production:

| Resource | Records |
|---|---|
| Instructors | 15 (9 Kinder and Junior · 6 Junior and Coder) |
| Classes | 21 |
| Students | 26 |
| CRM leads | 2 |
| Leave records | 0 |
| Operational rules | 0 — trial windows fall back to the standard grid, see §7 |

Classes currently run Tuesday, Wednesday, Friday, Saturday and Sunday, almost
all at Bekasi. Workload reports 3 active instructors totalling 27 hours.

---

## 3. Data conventions

| Thing | Format | Example |
|---|---|---|
| Day | Full English name | `"Monday"` |
| Class time slot | Human string | `"1.00 pm - 3.00 pm"` |
| Operating hours / slot times | 24-hour `HH:MM` | `"13:00"` |
| Date | ISO | `"2026-08-03"` |

### Business rules

| Rule | Detail |
|---|---|
| Class length | Kinder 90 min · Junior and Coder 120 min |
| Students per class | Kinder 4 · Junior and Coder 6 |
| Instructor level | Exactly `"Kinder and Junior"` or `"Junior and Coder"` |
| Capability | An instructor may only teach a category named in their level |
| Leave | A class where *every* student is on leave (`izin`) is excluded from taught hours |

### Program codes

Kinder and Junior use a code plus a lesson number (1–10) after a dot:

- Kinder Foundation `KF1`, `KF2` → `KF1.9`
- Kinder Core `K1`–`K4` → `K1.1`
- Junior Foundation `JF1`, `JF2` → `JF1.1`
- Junior Core `J1`–`J4` → `J1.1`

Coder uses level names with no lesson number: `Coder Foundation 1`–`4`,
`Coder Basic 1`–`2`, `Coder Intermediate 1`–`2`, `Coder Advance 1`–`3`.

### Branches

| Branch | Open days |
|---|---|
| Gading Serpong · Puri Indah · Pluit Village · Kelapa Gading · Pondok Indah | Mon–Sat |
| Bintaro · Bekasi | **Tue–Sun** |

Bintaro and Bekasi close Monday and open Sunday; the other five are the reverse.
An instructor may be assigned `"All Branches"`. Ignore the `Default Branch`
placeholder.

---

## 4. Endpoints

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/new/schedule` | GET POST PUT DELETE | Weekly classes |
| `/api/new/students` | GET POST PUT DELETE | Student registry |
| `/api/new/instructors` | GET POST PUT DELETE | Instructors and capability |
| `/api/new/crm` | GET POST PUT DELETE | Trial leads pipeline |
| `/api/new/operationals` | GET POST PUT DELETE | Branch hours + class slot plan |
| `/api/new/leave` | GET POST PUT DELETE | Instructor leave |
| `/api/new/activity` | GET POST DELETE | Audit trail |
| `/api/new/student-history` | GET POST DELETE | Student branch moves |
| `/api/new/workload` | GET | **Derived** — instructor hours |
| `/api/new/trial-availability` | GET | **Derived** — bookable slots + reasons |

Method convention: `GET` list · `POST` create · `PUT` update (body needs `id`) ·
`DELETE ?id=`. Send `Content-Type: application/json` on writes.

### Query parameters

Every list endpoint accepts `search` (partial, case-insensitive) and `limit`
(max 500). **Always send `limit`** — omitting it returns every match.

| Endpoint | Filters |
|---|---|
| `schedule` | `day`, `branch`, `teacher`, `classType` |
| `students` | `branch`, `status` |
| `instructors` | `branch` (also matches `All Branches`), `level`, `status` |
| `crm` | `status`, `branch` |
| `leave` | `instructor`, `from`, `to`, `status` |
| `operationals` | `branch`, `day`, `openOnly` |
| `activity` | `source`, `action` |
| `workload` | `branch`, `day`, `instructor` |
| `trial-availability` | `branch`, `day`, `category` |

---

## 5. Use the derived endpoints for questions

These apply all the business rules for you. Do **not** try to work capacity or
availability out by joining raw tables — the result will be wrong.

### `GET /api/new/workload` — "who is overloaded?"

```bash
curl -H "Authorization: Bearer $KEY" "$BASE/api/new/workload?branch=Bekasi"
```

```json
{
  "instructorCount": 3,
  "totalHours": 27,
  "data": [{
    "instructor": "Angel",
    "branches": ["Bekasi"],
    "totalSessions": 6,
    "leaveSessions": 1,
    "totalHours": 12,
    "hoursByDay": { "Saturday": 6, "Friday": 6 },
    "sessions": []
  }]
}
```

`leaveSessions` are classes where everyone was on leave; they are already
excluded from `totalHours`.

### `GET /api/new/trial-availability` — "when can a new student come in?"

```bash
curl -H "Authorization: Bearer $KEY" \
  "$BASE/api/new/trial-availability?branch=Bekasi&category=Coder"
```

Real response from production (`?branch=Bekasi&day=Saturday&category=Kinder`):

```json
{
  "windowSources": ["standard"],
  "configuredRules": 0,
  "total": 10,
  "availableCount": 7,
  "data": [{
    "branchName": "Bekasi", "day": "Saturday", "source": "standard",
    "start": "13:00", "end": "14:00",
    "slotType": "any",
    "available": false,
    "reason": "All qualified instructors busy and no open seats",
    "freeInstructors": [],
    "joinableClasses": [],
    "existingSlots": [{ "teacher": "Angel", "time": "1.00 pm - 3.00 pm", "program": "KF1.9", "studentCount": 4, "maxStudents": 4, "seatsLeft": 0 }]
  }]
}
```

When `available` is `false`, `reason` explains why:

- `No instructors assigned to this branch`
- `No Coder instructor at this branch`
- `All qualified instructors busy and no open seats`
- `Reserved for break` / `training` / `meeting`
- `Kinder Class slot — student is Coder`

`joinableClasses` lists existing classes that still have seats within the 4/6
limits. Joining one is often better than creating a new class — the reason reads
`Can join an existing class (5 seats left)` in that case.

`joinableClasses` lists existing classes that still have seats within the 4/6
limits. Joining one is often better than creating a new class.

---

## 6. Record shapes

### Class — `/api/new/schedule`

```json
{
  "day": "Tuesday",
  "time": "1.00 pm - 3.00 pm",
  "program": "JF1.5",
  "student": "Dave Kingsley",
  "teacher": "Angel",
  "branchName": "Bekasi",
  "classType": "Regular",
  "remarks": ""
}
```

Required: `day`, `time`, `program`, `student`, `teacher`, `branchName`.
`classType` is `Regular` or `Trial`. Put `izin` in `remarks` when a student is on
leave for that session.

### Student — `/api/new/students`

```json
{
  "name": "Dave Kingsley",
  "level": "Coder Advance 1",
  "branchName": "Bekasi",
  "parentName": "Jane Doe",
  "contact": "+62 812-3456-789",
  "status": "Active",
  "remarks": ""
}
```

Required: `name`, `level`, `branchName`.

### Instructor — `/api/new/instructors`

```json
{
  "name": "Angel",
  "level": "Kinder and Junior",
  "branches": ["Gading Serpong", "Puri Indah"],
  "contact": "+62 812-9166-5690",
  "status": "Active",
  "remarks": ""
}
```

Required: `name`, `level`, `branches`, `contact`.

### Lead — `/api/new/crm`

```json
{
  "name": "Mom Eny (Parent of Budi)",
  "phone": "628123456789",
  "message": "asking about Coder trial",
  "status": "interest_trial",
  "branch": "Bekasi",
  "trialDate": "2026-08-18",
  "notes": ""
}
```

Required: `name`, `phone`. Status: `interest_trial`, `trial_booked`,
`trial_done`, `closed`.

### Leave — `/api/new/leave`

```json
{
  "name": "Angel",
  "startDate": "2026-08-03",
  "endDate": "2026-08-07",
  "reason": "Annual leave",
  "status": "Approved"
}
```

Required: `name`, `startDate`, `endDate`. Status: `Approved`, `Pending`,
`Rejected`. An identical range for the same instructor returns `409`.

`from`/`to` on GET match any leave **overlapping** the window:

```bash
curl -H "Authorization: Bearer $KEY" \
  "$BASE/api/new/leave?from=2026-08-01&to=2026-08-31"
```

### Operational rule — `/api/new/operationals`

One row per branch + day. `POST` upserts on `(branchName, day)`.

```json
{
  "branchName": "Bekasi",
  "day": "Tuesday",
  "isOpen": true,
  "openTime": "11:00",
  "closeTime": "18:30",
  "slots": [
    { "type": "kinder", "start": "11:00", "end": "12:30", "label": "" },
    { "type": "break",  "start": "12:30", "end": "13:00", "label": "Lunch" },
    { "type": "junior", "start": "13:00", "end": "15:00", "label": "" },
    { "type": "coder",  "start": "15:00", "end": "17:00", "label": "" }
  ]
}
```

Slot types: `kinder`, `junior`, `coder`, `any`, `break`, `training`, `meeting`.
The last three block the time instead of holding a class. A slot whose `end` is
not after `start` is rejected with `400`.

**Breaks.** A daily break is just a `break` slot, so it needs no special
handling. `trial-availability` reports it as unavailable with the reason
`Reserved for break — Lunch`, and no class can be booked inside it. Each day has
at most one break when set from the app, though the API accepts more.

---

## 7. Limitations

### Where trial windows come from

`trial-availability` works whether or not Operationals has been configured. Each
result carries a `source` telling you which was used, and the response lists
`windowSources` plus `configuredRules`:

| `source` | Meaning |
|---|---|
| `plan` | The branch's Class Operation slot plan — typed slots, breaks, training and meetings all respected |
| `hours` | Hourly windows inside the branch's operating hours |
| `standard` | Default 1:00pm–6:30pm one-hour trial windows |

Availability itself always comes from live instructors and classes, so it is
accurate regardless of source. Configuring Operationals makes the *windows* match
your real timetable; without it you get the standard trial grid.

### Other limits

- **No dates on classes.** The schedule is a recurring weekly pattern, so you
  can answer "what happens on Tuesdays" but not "what happens on the 12th".
  `classType: "Trial"` marks one-off sessions.
- **Activity and student-history** are written by the app to browser storage as
  well, so those two endpoints may not match what the web UI displays.
- **The key is a single shared secret** with full read and write access,
  including delete.

- **No dates on classes.** The schedule is a recurring weekly pattern, so you
  can answer "what happens on Tuesdays" but not "what happens on the 12th".
  `classType: "Trial"` marks one-off sessions.
- **Activity and student-history** are written by the app to browser storage as
  well, so those two endpoints may not match what the web UI displays.
- **The key is a single shared secret** with full read and write access,
  including delete.

---

## 8. System prompt for Hermes

Paste this into the Hermes system prompt.

```text
You have tools for The Lab Operation System, a multi-branch coding school
(Kinder, Junior and Coder programs). Data comes from its New Operations API.

DATA RULES
- Days are full names ("Monday"). Dates are YYYY-MM-DD.
- Class length: Kinder 90 minutes, Junior and Coder 120 minutes.
- Seats per class: Kinder 4, Junior and Coder 6.
- Instructor level is "Kinder and Junior" or "Junior and Coder". An instructor
  can only teach a category named in their level.
- Program codes: Kinder/Junior use a code plus lesson number (KF1.9, K1.1,
  JF1.1, J1.1). Coder uses level names (Coder Basic 1) with no lesson number.
- Branches: Gading Serpong, Puri Indah, Pluit Village, Kelapa Gading and
  Pondok Indah run Mon-Sat. Bintaro and Bekasi run Tue-Sun.

HOW TO ANSWER
- "Who is free" / "when can a new student start": call trial-availability. It
  already accounts for branch hours, breaks, instructor capability, existing
  bookings and seat limits, and returns a reason when a slot is unavailable.
  Do not work this out yourself from the schedule.
- "Who is busy" / "who is overloaded": call workload.
- Always pass limit (5-20 is plenty). Never fetch a whole table.
- Use search= to find people by name instead of listing everything.
- If a name matches more than one record, ask which one before acting.
- The schedule is a weekly pattern with no calendar dates. If asked about a
  specific date, answer for that weekday and say so.

WRITES
- You may create CRM leads for new enquiries without asking.
- Before creating, changing or deleting a class, student, instructor or leave
  record, state exactly what will change and get confirmation.
- Never call DELETE unless the user explicitly asks and confirms.

WHEN UNSURE
- Report what the API returned. Never guess schedule, availability or capacity.
- trial-availability results carry a "source" field. When it is "standard" the
  branch has no timetable configured, so the windows are the default 1pm-6:30pm
  grid. Availability is still accurate; mention the times are indicative.
```

---

## 9. Recommended tool restrictions

The key allows full write access, so restrict what Hermes can call:

**Allow:** all `GET` endpoints, plus `POST /api/new/crm`.
**Block:** every `DELETE`, and `PUT`/`POST` on schedule, students, instructors,
operationals and leave unless an admin workflow needs them.

This keeps a misread message from deleting records while still letting the bot
log enquiries and answer questions.
