# Design: Employee Accounts in PostgreSQL

## Overview

Move employee accounts off Firebase into PostgreSQL, so login, roles and profile
data have one authoritative home, and so an Admin can read an employee's password
when they forget it.

Today one account is spread across three systems:

| What | Where it lives now |
|---|---|
| Credentials (email + password) | Firebase Auth |
| Profile (fullname, nickname, specialization, phone, location, training progress) | Firestore `profiles`, keyed by email |
| **Role** (`Admin` / `SPA` / `EC` / `Instructor` / `Supervisor`) | **the Google Sheet config store**, read via `/api/config` as `useSchedule().users` |

The five roles are `ROLES` in `AdminPage.jsx`. Note that `ProfilePage.jsx` only
recognises four of them — `EC` is absent from its supervisor check — so `EC`
currently behaves as an ordinary instructor there. That inconsistency is inherited,
not introduced here.

The role map living in a spreadsheet is the surprise, and it is why this feature
overlaps the planned config-store migration: `internal_users.role` absorbs that
map.

Scope is **employees only** — about 16 accounts (15 instructors plus admin).

### Scope exclusions

Stated explicitly because each looks like it belongs and does not:

- **Firestore `tasks`** (the "To-Do List") — an Old Operations feature, retires
  with it. Nothing migrated, nothing preserved.
- **Firestore `activityLogs`** — superseded by `internal_activity`.
- **Firestore `crmLeads`** — superseded by `new_crm_leads`.
- **Firestore `workloadSnapshots`** — workload history, not account data.
- **Student accounts** — covered separately by `student-portal-credentials`.

### The constraint that shapes everything

**Firebase password hashes cannot be reversed.** `firebase auth:export` emits
`passwordHash` and `salt`, but those are scrypt digests parameterised by the
project's `hash_config`. Even with the config, verification requires the user to
type the password — the original string is unrecoverable.

So no migration preserves existing passwords *and* satisfies "Admin can read
them".

**D1: the import sets every password to `thelab12345`**, and every employee is
prompted to change it on first login.

### Passwords are recoverable by deliberate choice

A per-row hide/show reveal rules out bcrypt: a hash cannot be shown.

**D2: store passwords encrypted, not hashed** — AES-256-GCM, key from the
environment, exactly as `student-portal-credentials` settled for student logins.
The two features must not invent two different credential stores.

A database dump, a read-only SQL user or a stolen backup yields **ciphertext
only**; the key is not in the database. It is **not** protection against a
compromised application server, which holds the key by necessity — see
*Residual risk*.

## Architecture

### There is no server-side identity today

`middleware.js` admits any same-origin request and carries **no per-user
identity**. `src/utils/roles.js` gating is applied in the UI only. The API cannot
tell an Admin from an instructor, and `NEW_OPS_API_KEY` grants full access to
whoever holds it.

A reveal endpoint on that foundation is not "slightly weak" — it is open to
anyone who can load the app.

**D5: real sessions ship *before* the reveal screen**, not after.

**D6: server-side session records, not self-contained tokens.** A signed cookie
carrying `{ email, role }` needs no table and is simpler, but cannot be revoked
before expiry — and the point of this table is that Admin can kill a compromised
credential *now*. Cost is one indexed lookup per request, irrelevant at this
scale.

Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. The token is 32 random bytes,
base64url; only its SHA-256 is stored, so reading the table yields no usable
tokens. Logout and password reset both delete the user's sessions.

### Key handling

**D3: a missing or wrong key fails closed.** If `EMPLOYEE_CREDENTIAL_KEY` is
absent, malformed, or fails GCM authentication, the reveal endpoint answers `503`
naming the misconfiguration. It must never fall back to plaintext, and never
write a row it cannot later read.

**D4: passwords never appear in a list payload** — not even as ciphertext.
Plaintext exists in exactly one response shape, from one endpoint, for one user.

### Cutover

Three stages, each with its own evidence of safety.

**Stage 1 — Firebase authoritative.** `internal_users` exists and is populated;
login unchanged. *Safe when:* the import ran, row count matches Firebase's user
count, and the Admin users list renders without reveal.

**Stage 2 — PostgreSQL first, Firebase fallback.** `POST /api/new/auth/login`
tries `internal_users`; on no match it falls back to
`signInWithEmailAndPassword`, and on Firebase success writes the password into
`internal_users` so the account self-migrates. *Safe when:* `last_login_at` is
non-null for every row.

**Stage 3 — Firebase removed.** Fallback deleted, `AuthContext` talks only to
`/api/new/auth/*`, Firebase Auth and its env vars go.

`AuthContext` keeps its existing convenience: a bare username expands to
`username@schedule.local`, so nobody's login habit changes.

## Data Models

```
internal_users
  id                   SERIAL PRIMARY KEY
  username             VARCHAR(150) NOT NULL      -- local part, e.g. "helen"
  email                VARCHAR(255) NOT NULL      -- "helen@schedule.local"
  role                 VARCHAR(50)  NOT NULL DEFAULT 'Instructor'
                         CHECK (role IN ('Admin','SPA','EC','Instructor','Supervisor'))
  password_encrypted   TEXT                       -- AES-256-GCM, base64
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE
  status               VARCHAR(50) NOT NULL DEFAULT 'Active'
  firebase_uid         VARCHAR(128)               -- provenance during transition
  fullname             VARCHAR(255)
  nickname             VARCHAR(255)
  specialization       VARCHAR(255)
  phone_number         VARCHAR(255)
  location             VARCHAR(255)               -- branch name, or "All Branches"
  training_progress    JSONB NOT NULL DEFAULT '{}'::jsonb
  last_login_at        TIMESTAMPTZ
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  CONSTRAINT internal_users_email_key    UNIQUE (email)
  CONSTRAINT internal_users_username_key UNIQUE (username)

internal_sessions
  id           SERIAL PRIMARY KEY
  token_hash   CHAR(64) NOT NULL UNIQUE   -- SHA-256 of the cookie value
  user_id      INTEGER NOT NULL
  expires_at   TIMESTAMPTZ NOT NULL
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  last_seen_at TIMESTAMPTZ
```

- **Profile is columns on `internal_users`, not a companion table.** Unlike
  `internal_students`, this table is created by the application's own DB user and
  can be altered freely; `profiles` was already one-to-one with an account, so a
  join would buy nothing.
- `role` is a `CHECK` list because those four values are hardcoded in
  `ProfilePage` and `roles.js`. A typo'd role must not silently become
  unprivileged-but-accepted.
- `training_progress` stays `JSONB` — a free-form program→count map that nothing
  queries inside.
- Provisioned through `ensureSchema.js`, following the existing pattern:
  `CREATE TABLE IF NOT EXISTS` plus idempotent `ALTER TABLE ... ADD COLUMN IF NOT
  EXISTS` for anything added later.

## Components and Interfaces

### API

| Route | Who | Notes |
|---|---|---|
| `POST /api/new/auth/login` | anyone | sets session cookie; generic failure, never "no such user" |
| `POST /api/new/auth/logout` | session | deletes the session row |
| `GET /api/new/auth/me` | session | current user and role, for the client |
| `POST /api/new/auth/change-password` | session | own password only |
| `GET /api/new/users` | Admin session | list; **no password field** (D4) |
| `POST /api/new/users/:id/reveal-password` | Admin session | one user, one password, audit row written |
| `POST /api/new/users/:id/reset-password` | Admin session | back to `thelab12345`, sets the change flag, kills their sessions |
| `PUT /api/new/users/:id` | Admin session | role, status, profile |

`mapRow` is a module-level whitelist as elsewhere, with `password_encrypted`
absent from it — so the column cannot leak through the ordinary list path even by
accident.

Reveal is `POST`, not `GET`, deliberately: it must not land in browser history,
server logs or a prefetch.

### `src/lib/employeeCredentials.js`

`encryptPassword(plain)` / `decryptPassword(stored)`, fresh IV per call, key read
once from `EMPLOYEE_CREDENTIAL_KEY`. Mirrors the student-credentials module so
there is one encryption idiom in the codebase.

### `scripts/importEmployeeAccounts.cjs`

Run by hand, not a route. Inputs: `firebase auth:export` JSON, a Firestore
`profiles` export, and the role map from `/api/config`.

Mapping: `email` → `email`; username = lowercased local part; `localId` →
`firebase_uid`; `createdAt`/`lastLoginAt` → `created_at`/`last_login_at`;
`password_encrypted` = encrypt(`thelab12345`); profile fields from
`profiles[email]`; `role` from the config map, defaulting to `Instructor`.

**D7: idempotent, upsert on `email`.** `ON CONFLICT (email) DO UPDATE` refreshes
profile and role but **does not** overwrite `password_encrypted` or
`must_change_password`, so re-running after someone changed their password does
not reset them.

### Admin users screen

Columns: username, fullname, role, location, status, last login, password.
Password renders as dots with a per-row eye toggle; the value is fetched on
demand and held only in component state. Actions: reset to `thelab12345`, edit
role/status/profile. A non-Admin does not see the screen in the nav, and the
endpoints refuse them independently of the UI.

### First-login change

While `must_change_password` is true the app routes to a change-password screen
and refuses to render anything else. Changing it writes a new
`password_encrypted`, clears the flag, and deletes the user's other sessions.

## Error Handling

| Situation | Response |
|---|---|
| `EMPLOYEE_CREDENTIAL_KEY` missing or malformed | `503`, naming the misconfiguration. Never plaintext (D3) |
| GCM authentication fails on decrypt | `500`; the row is reported as unreadable, never returned as garbage |
| Wrong password, or unknown email | `401` with one generic message for both — no account enumeration |
| Non-Admin calls reveal or the user list | `403`, no password in the body |
| No session, or expired session | `401`; the client routes to login |
| Reveal for an id that does not exist | `404` |
| Password fails policy on change | `400` naming the rule; nothing written |
| Import: email in Auth but not `profiles` | imported with empty profile fields, listed under "profile missing" |
| Import: email in `profiles` but not Auth | **not** created; printed as "orphan profile, skipped" |
| Import: role for an unknown account | printed as "role for unknown account" |

Validation follows `evaluationValidation.js` — return exactly one of
`{ value }` or `{ error }`, reject rather than coerce or clamp.

## Correctness Properties

### Property 1: Encryption round-trips
For any password, `decrypt(encrypt(p)) === p` — unicode, emoji, spaces and 200+
characters included. *Validates the credential store is lossless.*

### Property 2: Ciphertext is non-deterministic
Encrypting one password twice yields different ciphertext (fresh IV), so two
employees sharing a password are not detectable by comparing columns.

### Property 3: Tampered ciphertext fails closed
Flipping any byte of stored ciphertext makes decrypt throw, never return wrong
plaintext. *GCM authentication.*

### Property 4: `mapRow` is a whitelist
For a row carrying arbitrary extra columns, output keys are exactly the documented
set and never include `password_encrypted` or any snake_case key.

### Property 5: No password in the list payload
For any set of users, the serialised `GET /api/new/users` body contains none of
their passwords.

### Property 6: Import is idempotent
Running the import twice leaves the row count unchanged and never resets a
password changed between runs.

### Property 7: Username derivation is total
Every email yields a non-empty username, and two different emails never silently
collide into one username without the import reporting it.

### Property 8: Sessions are single-purpose
A token authenticates at most one user, and a deleted session authenticates
nobody.

### Property 9: Role gating is total
For every non-Admin role, the reveal endpoint returns 403 and no password.

### Property 10: Reveal is audited
Every 200 from reveal writes exactly one audit row naming actor, subject and time.

## Testing Strategy

Vitest with fast-check, matching the repo's conventions: pure-function properties
at `numRuns: 100`, DOM-driven properties at `numRuns: 20`, each carrying a
`// Feature: employee-accounts-postgres, Property N: <title>` header.

- **Unit** — encryption module, username derivation, validation messages, the
  role `CHECK` list, session expiry arithmetic.
- **Property** — the ten above; 1–3 and 6–7 are pure and cheap.
- **Route** — reveal returns 403 for each non-Admin role and 401 with no session;
  login answers identically for wrong-password and unknown-email; `mapRow`
  omits the credential column.
- **Integration** (guarded exactly as `studentEvaluations.integration.test.js`:
  requires a separate test database URL, refuses if it equals `DATABASE_URL`,
  requires "test" in the name, skips when unset) — import idempotency against a
  real table, unique constraints, session delete-on-reset.
- **Manual** — first-login forced change; reveal audit row appears; a second
  browser is logged out when Admin resets that user's password.

**Never point any of this at `DATABASE_URL`.** It is the live operational
database.

## Residual risk

**An Admin account becomes a single point of total credential compromise.** With
D2, whoever holds an Admin session reads every employee password. Previously
Firebase held one-way hashes and nobody could read anything.

Included: encryption at rest, admin-only reveal, one user per request, no
password in list payloads, an audit row per reveal, revocable sessions.

Deliberately **not** included, and worth knowing:

- No rate limit on reveal — 16 accounts is few enough to click through.
- No second factor on reveal.
- The application server holds the key, so a server compromise reads everything
  regardless of at-rest encryption.

If any of that is unacceptable, the alternative is bcrypt plus a
reset-to-`thelab12345` button, which serves the real workflow ("they forgot, fix
it") without a readable store. The readable store is the user's explicit choice;
this section exists so it is made with open eyes.

## Open Questions

1. **Where does `EMPLOYEE_CREDENTIAL_KEY` live, and who holds a copy?** It is
   needed in Vercel and in local `.env`. Losing it makes every stored password
   unreadable, recoverable only by resetting everyone. Should it be recorded in a
   password manager?
2. **Session lifetime?** Proposal: 12 hours idle, 30 days absolute, so a shared
   branch computer does not stay logged in overnight.
3. **Does the role map move in this feature or with the config-store migration?**
   Roles come from the Sheet today, so taking them here means
   `useSchedule().users` reads `internal_users` — which touches Old Operations,
   since it reads the same context.
4. **FK from `internal_sessions.user_id` to `internal_users.id`?** The app owns
   both tables, so `ON DELETE CASCADE` is available. Worth it only if deleting a
   user should irreversibly drop their sessions.
5. **Does `SPA` outrank `Supervisor`?** `ProfilePage` treats `Supervisor`, `SPA`
   and `Admin` as equivalent for one check. Confirm `SPA` must **not** see
   passwords.
6. **What happens to a departing employee** — `status = 'Inactive'`, or delete the
   row? Inactive preserves the audit trail of who did what.
