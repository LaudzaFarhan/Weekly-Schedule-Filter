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

Coder uses level names with no lesson number, one per stage: `Coder Basic`,
`Coder Intermediate`, `Coder Advance`.

Records written before the stages were unnumbered may still hold values like
`Coder Advance`. These are read as their stage, so no migration is required
for the app to behave correctly.

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
| `/api/new/student-evaluations` | GET POST PUT DELETE | Daily five-competency evaluations |
| `/api/new/student-terms` | GET POST PUT DELETE | Term subscriptions — which of T1–T4 are paid |
| `/api/new/workload` | GET | **Derived** — instructor hours |
| `/api/new/trial-availability` | GET | **Derived** — bookable slots + reasons |
| `/api/new/auth/login` | POST | Sign in. **Not** behind the API key — see below |
| `/api/new/auth/session` | GET DELETE | Who am I · sign out |
| `/api/new/users` | GET POST PUT DELETE | Employee accounts. **Admin only.** Never returns passwords |
| `/api/new/users/password` | GET PUT | Read a password back, or set one. **Admin only, every read audited** |
| `/api/new/users/provision` | GET POST | Give every instructor a login. GET previews, POST creates |
| `/api/new/config` | GET PUT DELETE | App settings. Replaces reading config from the Sheet |
| `/api/new/rubric-competencies` | GET POST PUT DELETE | Report-card competencies per category |

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
| `student-evaluations` | `studentId`, `instructorName`, `from`, `to` |
| `student-terms` | `studentId`, `year` |
| `workload` | `branch`, `day`, `instructor` |
| `trial-availability` | `branch`, `day`, `category` |
| `users` | `role`, `status` |
| `config` | `key` |
| `rubric-competencies` | `category`, `includeInactive` |

### Identity and roles

Two kinds of caller reach these routes:

| Caller | How | Role it gets |
|---|---|---|
| A person | `lab_session` cookie from `POST /api/new/auth/login` | Whatever their account says |
| A machine | `NEW_OPS_API_KEY` bearer, as everywhere else | `Admin` |

The key counts as `Admin` deliberately. Whoever holds it can already read and
write every record through the other endpoints, so refusing it the accounts API
would protect nothing while making the first account impossible to create.

`/api/new/auth/*` is exempt from the shared-key gate in `src/middleware.js`.
Gating it would be backwards — nobody could sign in until they already held the
key, which would make per-user sessions useless as a replacement for that gate.
The login route fails closed on its own. **There is no rate limiting on it yet.**

**Bootstrap.** While `internal_users` is empty, `POST /api/new/users` needs no
identity and is forced to create an `Admin`. Otherwise the first account could
never be made. The emptiness check and the insert share one transaction, so two
simultaneous requests cannot both take that window. It closes the moment the
first row exists.

```bash
# First account, on a fresh database
curl -X POST "$BASE/api/new/users" -H 'Content-Type: application/json' \
  -d '{"username":"admin","email":"admin@thelab.id"}'
# -> 201, role forced to Admin, temporaryPassword: "thelab12345"
```

**Instructor accounts.** New Operations accounts are separate from the Firebase
accounts Old Operations uses — the same person can exist in one, the other, or
both, and one does not imply the other. Instructors get theirs from the registry:

```bash
curl "$BASE/api/new/users/provision" -H "Authorization: Bearer $KEY"   # preview
curl -X POST "$BASE/api/new/users/provision" -H "Authorization: Bearer $KEY"
```

Usernames are derived from the name — `Felix Wijaya` → `felix.wijaya`, accents
folded to base letters, punctuation collapsed to dots. Lowercase and dotted
rather than the raw name because it gets typed at a login prompt every morning.
Two instructors folding to the same username get `felix` and `felix2`, so the
first holder keeps the name they already learned.

The link is stored as `internal_users.instructor_id`, which is what makes this
idempotent. Matching on name or username would not: both get edited, and either
would hand a renamed instructor a second account.

Starter passwords depend on the role, so the reset button gives an instructor
something their colleagues already know:

| Role | Default |
|---|---|
| `Instructor` | `instructor12345` |
| everything else | `thelab12345` |

On reset the role is read from the database rather than taken from the request, so
a caller cannot choose which default applies.

**Passwords** are encrypted, not hashed, so an Admin can read one back for an
employee who forgot theirs. That needs `EMPLOYEE_CREDENTIAL_KEY` set, or login
and reveal both answer `503`. `GET /api/new/users` never includes a password on
any role; reading one is `GET /api/new/users/password?id=`, which writes an
`accounts` entry to the activity log naming the Admin who read it and whose it
was. That log is the control — the reveal cannot be prevented, since the design
requires it, so what is guaranteed is that it cannot be done quietly.

Setting a password deletes every session for that account. If the reason was a
suspected compromise, leaving the attacker signed in would defeat the point.
Suspending an account does the same.

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
  "level": "Coder Advance",
  "branchName": "Bekasi",
  "parentName": "Jane Doe",
  "contact": "+62 812-3456-789",
  "status": "Active",
  "remarks": ""
}
```

Required: `name`, `level`, `branchName`.

**Deleting students — two different operations on one method.** A `DELETE` with
`?id=` removes one record. A `DELETE` with **no** `?id=` and a confirmation
phrase in the body removes **every** student record, and cannot be undone.

```bash
# One student. The id wins, so any body sent is ignored.
curl -X DELETE -H "Authorization: Bearer $KEY" "$BASE/api/new/students?id=42"

# EVERY student. Irreversible — export the registry first.
curl -X DELETE -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "confirm": "DELETE ALL STUDENTS" }' "$BASE/api/new/students"
```

Bulk request body:

```json
{ "confirm": "DELETE ALL STUDENTS" }
```

Bulk success response. All three counts are always present, zeros included:

```json
{ "success": true, "deletedStudents": 26, "deletedHistory": 14, "deletedProgress": 9 }
```

The wipe clears the student registry, the branch-history rows keyed to those
students, and the live lesson progress rows whose student name matches one of
them — in a single transaction, so either all of it goes or none of it does.
Classes, instructors, leave, operational rules and CRM leads are untouched, and
class rows keep their student names as plain text, so those names outlive the
records they came from.

Before calling the bulk form:

- The phrase is **mandatory** and is compared character for character,
  case-sensitively, after leading and trailing whitespace is trimmed.
  `"delete all students"` is rejected.
- `?id=` takes precedence over the body. A request carrying an id is always a
  single-record delete, even when its body holds a valid phrase, so a
  one-student delete can never be escalated into a wipe.
- A wipe against an already-empty registry succeeds and reports zeros.

| Status | When |
|---|---|
| `400` | No `?id=`, and the body is missing, unparseable, or holds a blank `confirm` — the error names both legal request shapes |
| `400` | `confirm` present but not exactly the phrase, including case variants. No database call is made |
| `404` | The `?id=` given matches no student record |
| `500` | The wipe failed or passed its 30-second limit. It is rolled back, so nothing is deleted |

### Evaluation — `/api/new/student-evaluations`

One record per student per **lesson**. `POST` upserts on
`(studentId, lessonNumber)`, so re-posting a lesson **replaces** that lesson's
report rather than adding a second one.

Keyed by lesson and **not** by day, because the lessons do not run in sequence and
two can be graded on the same day. `date` records when the lesson was taught; it
does not identify the record. Two reports may share a `date`.

```json
{
  "studentId": 42,
  "date": "2026-08-03",
  "lessonNumber": 5,
  "lessonTopic": "Loops and repetition",
  "concept": 4,
  "building": 5,
  "problemSolving": 4,
  "focus": 3,
  "attitude": 5,
  "instructorNotes": "Worked through the repeat block on his own.",
  "instructorName": "Angel"
}
```

Required: `studentId`, `lessonNumber`, and all five competency scores —
`concept`, `building`, `problemSolving`, `focus`, `attitude`. Each score is an
integer from 1 to 5.

- `lessonNumber` is an integer from 1 to 10 and is **required**, because it is
  what identifies the report. An absent one is a `400` rather than a default:
  guessing lesson 1 would upsert onto a report that already exists. Out of range
  or non-integer is a `400` naming the field and carrying the value received —
  rejected, never clamped, exactly as the scores are.

- **Scores are rejected, never clamped.** A missing, non-integer or out-of-range
  score is a `400` naming the competency and carrying the value received. Nothing
  is rounded into range and nothing is defaulted, because a report card a parent
  keeps must not hold a score no instructor entered. If a score is rejected, ask
  for the real rating instead of sending a corrected guess.
- `date` is optional. Omitted or blank, the server's current calendar date is
  used. A shape that is not `YYYY-MM-DD`, and a shaped-but-unreal date such as
  `2026-02-30`, are both a `400`. The API field is `date`; it is stored in the
  `eval_date` column, which is what list ordering and `from`/`to` compare against.
- `lessonTopic`, `instructorNotes` and `instructorName` are optional.
  `instructorName` is free text of at most 255 characters and is not checked
  against `/api/new/instructors`, so a record naming a departed instructor stays
  editable.
- Lists come back oldest first, by date and then by id. `search` matches the
  lesson topic, the instructor remarks and the instructor name. Note that the
  report card orders by `lessonNumber`, not by this list order, since the lessons
  are not taught in sequence.
- Records created before `lessonNumber` existed carry `null`. PostgreSQL treats
  NULLs as distinct in a unique constraint, so several such rows coexist; they
  are readable and deletable but cannot be reached by lesson.
- `PUT` revalidates the whole record, so it is a replace and not a patch: an
  omitted score is a `400`, not "leave it as it was". `DELETE ?id=` removes one
  record and there is no bulk form.

| Status | When |
|---|---|
| `400` | A competency score missing, non-integer or outside 1–5; `studentId` not a positive integer; an unreal `date`; a `from`/`to` that is not `YYYY-MM-DD`. Nothing is written and no records are returned |
| `404` | The `?id=` or body `id` matches no evaluation. Nothing is changed |
| `409` | A `PUT` would move a record onto a date the same student already holds. Both records keep their values — open the existing day to edit it |

### Student term — `/api/new/student-terms`

One row per student per term per year. `POST` upserts on
`(studentId, year, termNumber)`, so marking a term paid is one request whether or
not the row already exists.

```json
{
  "studentId": 42,
  "year": 2026,
  "termNumber": 2,
  "paid": true,
  "paidAt": "2026-08-01",
  "note": "Parent asked for a receipt"
}
```

Required: `studentId`, `year` (2000–2100), `termNumber` (1–4). A value outside
those bounds is a `400` naming the field and its bounds, and no row is written.

- **Omitting `paid` is not the same as `paid: false`.** Only the keys a payload
  actually carries are written, so a request that leaves `paid` out says nothing
  about payment and leaves the stored flag as it was; send `paid: false` when you
  mean unpaid. Treating an absent key as false would let a note-only edit flip a
  settled subscription to unpaid, and an administrator would then chase money
  that had already arrived. A first insert with no `paid` key stores `false`.
- `paidAt` and `note` follow the same rule: absent keeps the stored value,
  explicit `null` clears it.
- `paid` is read strictly — `true`/`false`, `1`/`0`, or the strings `"true"`,
  `"false"`, `"1"`, `"0"`. Anything else is a `400`, so `"false"` can never
  arrive as true.
- The API field `year` is stored in the `term_year` column.
- There is no current-term or start-term field. Both are derived on read from the
  term rows — the start term is the earliest row, the current term is the latest
  **paid** row — so a student with two current terms cannot be stored.
- No price, currency or invoice reference is held here or in the table. Billing is
  out of scope.
- `PUT` edits only `paid`, `paidAt` and `note`, by body `id`, and needs at least
  one of the three; the identifying triple is not editable, so a `PUT` can never
  move a row onto another student's term. Re-filing a term is a `POST` of the new
  triple plus a `DELETE` of the old row.

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

### Evaluation and term rows outlive the student

Deleting a student leaves that student's `student-evaluations` and `student-terms`
rows behind as **orphans**. Both hold `studentId` as a plain integer with no
foreign key, because the application's database user does not own
`internal_students` and so cannot create a constraint that references it — the
same reason `student-history` behaves this way.

- Neither single-record `DELETE /api/new/students?id=` nor the bulk wipe touches
  the two tables.
- The orphans are unreachable through the web UI, which lists only students
  returned by `/api/new/students`. They stay readable through the API by
  `studentId`.
- Re-registering a student produces a **new** id, so the old evaluations do not
  reattach to the new record.
- The bulk wipe keeps its existing contract unchanged by this feature: the same
  three data sets — students, branch history, live lesson progress — and the same
  three counts, `deletedStudents`, `deletedHistory`, `deletedProgress`. Evaluations
  and terms are deliberately **not** added to it, because changing that response
  shape belongs to the `student-data-bulk-wipe` specification and its tests assert
  the three counts. Clear stale rows with `DELETE /api/new/student-evaluations?id=`
  and `DELETE /api/new/student-terms?id=`, one row per request.

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
  JF1.1, J1.1). Coder uses level names (Coder Basic) with no lesson number.
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

### "Every `DELETE`" includes the bodied bulk form

`DELETE /api/new/students` has two forms (see §6): `?id=` deletes one student,
and no `?id=` plus `{ "confirm": "DELETE ALL STUDENTS" }` in the body empties the
entire registry. A rule that only matches `?id=` therefore does **not** cover the
destructive one. Block the method on the path outright, query string or not.

The confirmation phrase is enforced on **every** caller the API admits — both
same-origin browser requests and `Authorization`/`x-api-key` callers. There is no
caller class that gets a bulk delete without it. But that guard only stops a
*stray* call; it cannot tell an authorised mistake from an intended wipe, so it
is not a substitute for restricting the tool. If an admin workflow genuinely
needs the wipe, keep it behind the app's Admin-only screen, which requires an
`.xlsx` export of the registry and a typed confirmation before it fires.
