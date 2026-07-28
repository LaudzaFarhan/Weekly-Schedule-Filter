# New Operations API — Integration Guide

Everything an agent (Hermes) needs to call The Lab Operation System.
Backed by PostgreSQL. All requests and responses are JSON.

> Old Operations (`/api/old/*`, Google Sheets) is a **separate** API over
> **different data**. A student here is not the same record as a student there.
> Never mix them. See `/api/old/openapi.json` if you need it.

---

## 1. Connection

| | Value |
|---|---|
| Base URL | `https://weekly-schedule-filter.vercel.app` |
| Spec (auto-discovery) | `https://weekly-schedule-filter.vercel.app/api/new/openapi.json` |
| Auth header | `Authorization: Bearer <NEW_OPS_API_KEY>` |
| Alternative header | `x-api-key: <NEW_OPS_API_KEY>` |

The spec is public so discovery works before authenticating.

### Live status — verified

All 10 endpoints respond `200` in production and are serving real data:

| Check | Result |
|---|---|
| `/api/new/openapi.json` | 200 — spec published |
| Instructors | 15 records |
| Classes | 21 records |
| Students | 26 records |
| `/api/new/workload` | 3 instructors, 27 hours |
| `/api/new/operationals` | **0 rules — see §8** |
| `/api/new/trial-availability` | **0 slots, blocked by the above** |

### ⚠️ The API is currently unauthenticated

`NEW_OPS_API_KEY` is **not set on Vercel**. Every endpoint answers without a
token, so anyone with the URL can read all student and instructor data and issue
`DELETE`. Fix this before giving the URL to anything:

1. Generate a key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Vercel → Project → Settings → Environment Variables → add
   `NEW_OPS_API_KEY` for Production.
3. Redeploy (env changes need a new deployment to take effect).
4. Confirm the gate is live — step 2 below must return `401`.

The browser UI keeps working after this; same-origin requests are exempt.

**Environment variables on Vercel:**

| Variable | Status | Purpose |
|---|---|---|
| `DATABASE_URL` | set (API returns data) | PostgreSQL connection |
| `NEW_OPS_API_KEY` | **missing** | The token Hermes sends |
| `DATABASE_SSL` | not needed | Only if Postgres requires SSL |

### Smoke test

```bash
KEY=your-key-here
BASE=https://weekly-schedule-filter.vercel.app

# 1. Spec reachable without a key
curl $BASE/api/new/openapi.json

# 2. Key enforced — must return 401
curl -i $BASE/api/new/instructors

# 3. Key accepted — returns JSON
curl -H "Authorization: Bearer $KEY" \
  "$BASE/api/new/instructors?limit=5"
```

If step 2 returns data instead of `401`, the key is not set and the API is open.

---

## 2. Conventions

- **Days**: full English names — `Monday` … `Sunday`.
- **Operating hours and slot times**: 24-hour `"HH:MM"` — `"13:00"`.
- **Class time slots**: human strings — `"1.00 pm - 3.00 pm"`.
- **Dates**: `"YYYY-MM-DD"`.
- **Methods**: `GET` list · `POST` create · `PUT` update (body needs `id`) ·
  `DELETE ?id=`.
- Send `Content-Type: application/json` on writes.
- Errors return `{ "error": "..." }` with a 4xx/5xx status.

### Business rules the API enforces

| Rule | Detail |
|---|---|
| Class length | Kinder 90 min · Junior and Coder 120 min |
| Students per slot | Kinder 4 · Junior and Coder 6 |
| Instructor levels | `"Kinder and Junior"` or `"Junior and Coder"` |
| Capability | An instructor may only teach a category named in their level |
| Leave | A slot where *every* student is on leave (`izin`) does not count as taught hours |

### Branches

Live configuration, all open 6 days a week:

| Branch | Open days |
|---|---|
| Gading Serpong | Mon–Sat |
| Puri Indah | Mon–Sat |
| Pluit Village | Mon–Sat |
| Kelapa Gading | Mon–Sat |
| Pondok Indah | Mon–Sat |
| Bintaro | **Tue–Sun** |
| Bekasi | **Tue–Sun** |

Bintaro and Bekasi are closed Monday and open Sunday; the other five are the
reverse. An instructor may be assigned `"All Branches"` instead of named ones.
There is also a `Default Branch` placeholder with no open days — ignore it.

---

## 3. Endpoints

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

### List parameters

All list endpoints accept:

- `search` — partial, case-insensitive match across the main text columns
- `limit` — max rows, capped at 500

**Always send `limit`.** Omitting it returns every match, which is slow and
expensive in a chat context.

Per-endpoint filters:

| Endpoint | Filters |
|---|---|
| `schedule` | `day`, `branch`, `teacher`, `classType` |
| `students` | `branch`, `status` |
| `instructors` | `branch` (also matches `All Branches`), `level`, `status` |
| `crm` | `status`, `branch` |
| `leave` | `instructor`, `from`, `to`, `status` |
| `operationals` | `branch`, `day`, `openOnly` |
| `activity` | `source`, `action`, `limit` |
| `workload` | `branch`, `day`, `instructor` |
| `trial-availability` | `branch`, `day`, `category` |

---

## 4. Prefer the derived endpoints

These answer a whole question in one call, with the business rules already
applied. Do **not** reconstruct this logic by joining raw tables — it will be
wrong.

### `GET /api/new/workload`

"Who is overloaded?" Returns per-instructor hours, hours per day, and the
session list. Slots where every student is on leave appear as `leaveSessions`
and are excluded from `totalHours`.

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/workload?branch=Bekasi"
```

```json
{
  "instructorCount": 2,
  "totalHours": 25.5,
  "data": [
    {
      "instructor": "Angel",
      "branches": ["Gading Serpong"],
      "totalSessions": 6,
      "leaveSessions": 1,
      "totalHours": 12,
      "hoursByDay": { "Saturday": 6, "Friday": 6 },
      "sessions": [ /* … */ ]
    }
  ]
}
```

### `GET /api/new/trial-availability`

"When can a new student come in?" Returns each planned slot with whether it can
take a student and, when it cannot, **why**.

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/trial-availability?branch=Bekasi&category=Coder"
```

```json
{
  "total": 12,
  "availableCount": 4,
  "data": [
    {
      "branchName": "Bekasi", "day": "Monday",
      "start": "13:00", "end": "15:00",
      "slotType": "coder",
      "available": true,
      "reason": "Coder Class · 2 instructors free",
      "freeInstructors": [{ "name": "Yovi", "level": "Junior and Coder" }],
      "joinableClasses": []
    }
  ]
}
```

Reasons you may see when `available` is `false`:

- `Reserved for break` / `training` / `meeting`
- `No Coder instructor at this branch`
- `All qualified instructors busy and no open seats`
- `Kinder Class slot — student is Coder`
- `Too short — Coder needs 120m`

`joinableClasses` lists existing lessons that still have seats, respecting the
4/6 limits — often the right answer instead of creating a new slot.

---

## 5. Record shapes

### Class — `/api/new/schedule`

```json
{
  "day": "Monday",
  "time": "1.00 pm - 3.00 pm",
  "program": "JF1.5",
  "student": "Dave Kingsley",
  "teacher": "Angel",
  "branchName": "Gading Serpong",
  "classType": "Regular",
  "remarks": ""
}
```

Required: `day`, `time`, `program`, `student`, `teacher`, `branchName`.
`classType` is `Regular` or `Trial`. Put `izin` in `remarks` when a student is
on leave for that session.

**Program codes**: Kinder Foundation `KF1`–`KF2`, Kinder Core `K1`–`K4`,
Junior Foundation `JF1`–`JF2`, Junior Core `J1`–`J4`, each with a lesson number
1–10 appended after a dot (`JF1.5`). Coder uses level names:
`Coder Foundation 1`–`4`, `Coder Basic 1`–`2`, `Coder Intermediate 1`–`2`,
`Coder Advance 1`–`3` (no lesson number).

### Student — `/api/new/students`

```json
{
  "name": "Dave Kingsley",
  "level": "Coder Advance 1",
  "branchName": "Gading Serpong",
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
`level` must be exactly `"Kinder and Junior"` or `"Junior and Coder"`.

### Lead — `/api/new/crm`

```json
{
  "name": "Mom Eny (Parent of Budi)",
  "phone": "628123456789",
  "message": "WhatsApp lead",
  "status": "interest_trial",
  "branch": "Bekasi",
  "trialDate": "2026-07-18",
  "notes": ""
}
```

Required: `name`, `phone`. Status values: `interest_trial`, `trial_booked`,
`trial_done`, `closed`.

### Operational rule — `/api/new/operationals`

One row per branch + day. `POST` upserts on `(branchName, day)`.

```json
{
  "branchName": "Bekasi",
  "day": "Monday",
  "isOpen": true,
  "openTime": "11:00",
  "closeTime": "18:30",
  "slots": [
    { "type": "kinder",  "start": "11:00", "end": "12:30", "label": "" },
    { "type": "break",   "start": "12:30", "end": "13:00", "label": "Lunch" },
    { "type": "junior",  "start": "13:00", "end": "15:00", "label": "" },
    { "type": "coder",   "start": "15:00", "end": "17:00", "label": "" }
  ]
}
```

Slot types: `kinder`, `junior`, `coder`, `any` (any class),
`break`, `training`, `meeting`. The last three block the time instead of
holding a class. A slot whose `end` is not after `start` is rejected with 400.

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
`Rejected`. Posting an identical range for the same instructor returns `409`.

`from`/`to` on GET match any leave **overlapping** the window, not only leave
fully inside it:

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/leave?from=2026-08-01&to=2026-08-31"
```

---

## 6. Common tasks

**Find a student and their classes**

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/students?search=Dave&limit=5"

curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/schedule?search=Dave%20Kingsley&limit=10"
```

**Who teaches on Saturday at Bekasi**

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/schedule?day=Saturday&branch=Bekasi&limit=20"
```

**Who is away next week**

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/leave?from=2026-08-03&to=2026-08-09"
```

**Log an inbound WhatsApp enquiry**

```bash
curl -X POST -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Mom Eny","phone":"628123456789","message":"asking about Coder trial","branch":"Bekasi"}' \
  https://weekly-schedule-filter.vercel.app/api/new/crm
```

**Book a trial** — check availability first, then create the class:

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://weekly-schedule-filter.vercel.app/api/new/trial-availability?branch=Bekasi&category=Coder"

curl -X POST -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"day":"Monday","time":"1.00 pm - 3.00 pm","program":"Coder Basic 1","student":"Budi","teacher":"Yovi","branchName":"Bekasi","classType":"Trial"}' \
  https://weekly-schedule-filter.vercel.app/api/new/schedule
```

---

## 7. Agent instructions

Paste this into the Hermes system prompt.

```text
You have tools for The Lab Operation System — a multi-branch coding school.
Authenticate every call with the bearer token; the OpenAPI spec is at
/api/new/openapi.json.

DATA RULES
- Days are full names ("Monday"). Dates are YYYY-MM-DD.
- Class length: Kinder 90 minutes, Junior and Coder 120 minutes.
- Seats per class: Kinder 4, Junior and Coder 6.
- Instructor level is "Kinder and Junior" or "Junior and Coder". An instructor
  can only teach a category named in their level.

HOW TO ANSWER
- For "who is free / when can a student come in", call trial-availability.
  It already accounts for branch hours, breaks, capability and seat limits, and
  returns a reason when a slot is unavailable. Do not work this out yourself.
- For "who is busy / overloaded", call workload.
- Always pass limit (5-20 is usually enough). Never fetch a whole table.
- Use search= to find people by name rather than listing everything.
- If a name matches several records, ask which one before acting.

WRITES
- You may create CRM leads for new enquiries without asking.
- Confirm with the user before creating, changing or deleting a class,
  student, instructor, or leave record. State exactly what will change.
- Never call DELETE unless the user explicitly asks and confirms.

WHEN UNSURE
- Report what the API returned. Do not guess schedule, availability or capacity.
```

---

## 8. Known gaps — read before testing

### `trial-availability` returns nothing until Operationals is seeded

Confirmed in production: `GET /api/new/operationals` returns `0` rules, so
`trial-availability` returns `total: 0` with the note
`"No operational rules found"`.

The cause: the Operationals page writes its open days, hours and class slot plan
to the **shared branch config** (Google Sheets), not to the
`internal_operationals` table the API reads. The page looks correctly filled in
while the API sees nothing.

Seed it by POSTing each branch/day. `POST` upserts on `(branchName, day)`, so
re-running is safe:

```bash
BASE=https://weekly-schedule-filter.vercel.app

curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{
    "branchName": "Bekasi",
    "day": "Tuesday",
    "isOpen": true,
    "openTime": "11:00",
    "closeTime": "18:30",
    "slots": [
      { "type": "kinder", "start": "11:00", "end": "12:30" },
      { "type": "junior", "start": "13:00", "end": "15:00" },
      { "type": "coder",  "start": "15:00", "end": "17:00" }
    ]
  }' \
  $BASE/api/new/operationals
```

Repeat per open day. Remember Bintaro and Bekasi run Tue–Sun while the other
five run Mon–Sat.

### Activity and student-history are UI-local

Both endpoints work, but the Schedule and Students pages still write their
history to browser `localStorage`. So `GET /api/new/activity` will be empty even
though the Activity page shows entries. Anything POSTed to the API is stored
properly and shared; it just won't appear in the UI yet, and vice versa.

### Other limits

- **The token is a single shared secret.** Anyone holding it has full read and
  write access, including delete. Restrict the agent's tool list rather than
  relying on the model to behave.
- **`internal_classes` has no date column.** The schedule is a recurring weekly
  pattern, so per-date or per-week filtering is not possible — you can ask
  "what's on Tuesdays", not "what's on the 12th". `classType: Trial` marks
  one-off sessions.
- Tables are created automatically on first request, so no manual migration is
  needed.
- `/api/old/*` is a different API over Google Sheets with its own keys
  (`CHATBOT_API_KEY`, `CRM_API_KEY`). Three of those endpoints have no auth at
  all, including `/api/old/config`, which can write branch settings.

---

## 9. Setup checklist

- [ ] Set `NEW_OPS_API_KEY` on Vercel and redeploy — **the API is open right now**
- [ ] Confirm `curl -i $BASE/api/new/instructors` returns `401`
- [ ] Seed `/api/new/operationals` so `trial-availability` works
- [ ] Give Hermes the base URL, the spec URL, and the key
- [ ] Paste the §7 prompt into the Hermes system prompt
- [ ] Restrict Hermes to the read endpoints plus `POST /api/new/crm`
