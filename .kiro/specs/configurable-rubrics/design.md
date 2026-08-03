# Design: Configurable Rubrics per Program Category

## Overview

Let an admin add, remove, rename and reorder the competencies an evaluation is
scored against, independently for each of the three program categories — Kinder,
Junior and Coder. Today all three share one hardcoded set of five.

Scope key is **category**, not level: three setups, matching the K / J / C tabs
the Report Cards page already uses. Seven per-level rubrics were considered and
rejected as more to maintain than the school needs.

### What is fixed today, and why that blocks it

`COMPETENCIES` in `src/lib/reportCardRubric.js` is a literal array of five, and
those five are **five `NOT NULL` columns** on `internal_student_evaluations`:
`concept`, `building`, `problem_solving`, `focus`, `attitude`.

They are also assumed by:

- `competencyAverages` and `overallGrade` in `reportCard.js`
- `lessonSeries`, which means each point over `COMPETENCIES.length`
- `validateEvaluationPayload`, which requires exactly those five
- `CompetencyRadarChart` — five axes
- `ReportCardDocument` — five printed mastery rows
- `mapRow` in the evaluations route, which whitelists them by name

So a configurable set is a data-model change, not a settings screen.

### The 1–5 scale stays fixed

Only the *set of competencies* becomes configurable. Every competency is still
scored 1–5, and `GRADE_BANDS` is unchanged, because the grade bands are defined
over a mean in `[1,5]`. Making the scale configurable too would invalidate every
stored score and every printed report; it is explicitly out of scope.

## Architecture

### Scores move from columns to JSONB

**D1: `internal_student_evaluations.scores JSONB`** replaces the five columns,
keyed by competency key: `{"concept": 4, "creativity": 5}`.

The alternative was a normalised `internal_evaluation_scores` table, one row per
score. That keeps a database `CHECK` on each value, but turns reading one
evaluation into a join plus aggregation and every save into a delete-and-reinsert.
For 5–8 scores per evaluation that is a lot of machinery, and the page, the radar
and the printed report all want one evaluation as one row.

**The cost, stated plainly:** the `BETWEEN 1 AND 5` guarantee moves out of
PostgreSQL and into `validateEvaluationPayload`. A write that bypasses the API
could store a 9, or a key no rubric defines. Everything writes through the API
today, and Property 4 below pins the validator to compensate.

### The old columns are kept, not dropped

**D2: the five columns stay, nullable, and are no longer read.**

Dropping them would make the migration irreversible against a database holding
real evaluations. Keeping them costs five nullable columns and buys a way back if
the JSONB read path turns out wrong in production. They are removed in a later,
separate change once the new path has been running.

The migration backfills `scores` from the columns, so nothing is lost and nothing
looks different until a rubric is actually edited.

### A rubric is versioned by nothing — deliberately

**D3: editing a rubric does NOT rewrite stored evaluations.**

If Kinder drops "Focus" today, evaluations recorded last month keep their focus
score in `scores`. They simply stop being displayed, because display is driven by
the *current* rubric.

The alternative — snapshotting the rubric onto each evaluation — was rejected as
premature: it doubles the storage and makes "what is this student's average"
ambiguous across a rubric change. The consequence to accept is that **a printed
report card reflects today's rubric, not the rubric in force when it was
scored.** For a school report that is the desired reading: parents compare
like with like.

**D4: removing a competency is a soft delete** (`active = false`), so its stored
scores remain interpretable and it can be restored. Only an unused competency —
no evaluation carries its key — can be deleted outright.

### Averages over a changing set

`competencyAverages` currently returns a fixed-shape object. It becomes a
function of the rubric:

- Only competencies **active for that category** are averaged.
- A competency with no score in an evaluation is **skipped, not counted as zero** —
  the same rule as `NOT_ASSESSED`: a missing score is not a bad score.
- An evaluation predating a newly-added competency therefore contributes to the
  others and abstains on the new one.

## Data Models

```
internal_rubric_competencies
  id            SERIAL PRIMARY KEY
  category      VARCHAR(20)  NOT NULL CHECK (category IN ('Kinder','Junior','Coder'))
  key           VARCHAR(50)  NOT NULL      -- stable id used in scores JSONB
  label         VARCHAR(100) NOT NULL      -- "Problem Solving"
  color         VARCHAR(20)  NOT NULL DEFAULT '#4f46e5'
  sort_order    INTEGER      NOT NULL DEFAULT 0
  descriptors   JSONB        NOT NULL DEFAULT '{}'::jsonb  -- {"1":"…", … ,"5":"…"}
  active        BOOLEAN      NOT NULL DEFAULT TRUE
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
  CONSTRAINT internal_rubric_competencies_cat_key UNIQUE (category, key)
```

```
internal_student_evaluations   -- added
  scores JSONB NOT NULL DEFAULT '{}'::jsonb
  -- concept, building, problem_solving, focus, attitude: kept, made NULLable,
  -- no longer read (D2)
```

- `key` is **immutable once created**, because it is the join to every stored
  score. The label is what an admin edits; renaming "Focus" to "Attention"
  changes the label and leaves the key alone, so history stays readable.
- `descriptors` is JSONB rather than five columns because it is always read and
  written whole, and five is not guaranteed to stay five if the scale ever changes.
- `UNIQUE (category, key)` lets the same key mean the same thing across
  categories — "concept" in Kinder and in Coder — while keeping each category's
  row independent.
- Provisioned through `ensureSchema.js`: `CREATE TABLE IF NOT EXISTS` plus
  idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `scores`, following
  the pattern the `lesson_number` migration established.

### Seeding and migration

One idempotent step, safe to re-run:

1. Insert the current five competencies for **each** of the three categories,
   with today's labels, colours and descriptors from `reportCardRubric.js`.
2. Backfill `scores` from the five columns for every row where `scores = '{}'`.
3. Relax the `NOT NULL` on the five columns.

**The seeded keys are the existing camelCase API keys**, not the column names:
`concept`, `building`, `problemSolving`, `focus`, `attitude`. `COMPETENCIES`
already carries both — `key` and `column` — and they differ only for
`problem_solving` → `problemSolving`. Seeding from `key` means the JSONB keys
equal the keys the client already reads and writes, so the backfill is the only
place the column-to-key mapping is needed and no component changes what it calls
a competency.

After it runs, nothing on screen changes — the three categories all carry the
same five competencies, which is exactly the current behaviour.

## Components and Interfaces

### API

| Route | Notes |
|---|---|
| `GET /api/new/rubric-competencies?category=` | list, ordered by `sort_order, id`; omit `category` for all three |
| `POST /api/new/rubric-competencies` | create; `key` derived from `label` when absent, uniqueness enforced per category |
| `PUT /api/new/rubric-competencies` | update label, colour, order, descriptors, `active`. **`key` and `category` are not editable** |
| `DELETE /api/new/rubric-competencies?id=` | hard delete **only** when no evaluation carries the key; otherwise `409` telling the caller to deactivate instead (D4) |

`mapRow` is a module-level whitelist as elsewhere. The evaluations route's
`mapRow` gains `scores` and stops emitting the five named keys once the read path
switches.

### `src/lib/reportCardRubric.js`

Stops being the source of truth and becomes the **fallback**: the five defaults,
used to seed, and used if the rubric table is empty or unreachable so the
evaluator never renders zero rating rows. `descriptorFor` takes a competency
object rather than looking up a module constant.

### `src/lib/reportCard.js`

`competencyAverages(evaluations, competencies)` — the second argument is the
active set. `overallGrade` is unchanged; it already consumes averages.

### UI

**Rubrics and Setup** (`report-cards-rubric`, already exists) gains a category
tab strip — Kinder / Junior / Coder, reusing the K/J/C letter buttons — and per
competency: label, colour, five descriptor fields, drag or arrows to reorder,
deactivate, and an "Add competency" row.

**`EvaluationForm`** renders one rating row per active competency of the selected
student's category, instead of a hardcoded five.

**`CompetencyRadarChart`** takes a variable number of axes. A radar with fewer
than three axes is geometrically meaningless, so **with one or two competencies it
renders the numeric summary instead** — reusing the existing chart-failure
fallback rather than drawing a degenerate shape.

**`ReportCardDocument`** prints one mastery row per active competency.

## Error Handling

| Situation | Response |
|---|---|
| Rubric table empty or unreachable | fall back to the five defaults; the evaluator never shows zero rows |
| `DELETE` on a competency with stored scores | `409` naming the count and pointing at deactivate (D4) |
| `POST` with a `key` already used in that category | `409` naming the existing competency |
| Attempt to edit `key` or `category` via `PUT` | `400`; both are identity |
| Score for a key no active competency defines | ignored on read, rejected on write, naming the key |
| Score outside 1–5, or non-integer | `400` naming the competency. Rejected, never clamped — unchanged rule |
| Save with fewer scores than active competencies | `400` listing the unrated ones. Unchanged behaviour, variable set |
| A category ends with zero active competencies | `400` on the deactivation that would cause it; a category must keep at least one |

## Correctness Properties

The `Validates: Requirements` references below are **resolved**. `requirements.md` was
derived from this document and adopted the grouping below unchanged, so no renumbering
was needed; the references point at specific acceptance criteria in that file.

### Property 1: Averages cover exactly the active set
For any evaluations and any rubric, `competencyAverages` returns one entry per
active competency of that category and no others.

**Validates: Requirements 4.1, 4.8**

### Property 2: A missing score abstains, it does not score zero
Adding a competency to a rubric never lowers the average of the competencies that
were already there, and never introduces a 0.

**Validates: Requirements 4.3, 4.4**

### Property 3: Editing a rubric never mutates a stored evaluation
For any sequence of rubric edits, the `scores` of every existing evaluation are
byte-identical afterwards.

**Validates: Requirements 1.7, 3.12**

### Property 4: The validator is the only score guard
Any score that is not an integer in `[1,5]`, and any key not defined for the
category, is rejected — never clamped, never coerced, never written.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 5: Keys are immutable and unique per category
No API path changes a `key` or `category`; two competencies in one category never
share a key.

**Validates: Requirements 1.1, 1.3, 1.4, 1.5**

### Property 6: The migration is idempotent and lossless
Running seed-and-backfill twice leaves the competency count and every `scores`
value unchanged, and every pre-migration column value is present in `scores`.

**Validates: Requirements 3.7, 3.8, 3.9**

### Property 7: The chart and the printed summary carry the same numbers
Unchanged in intent from the current Property 16, now over a variable set: every
value plotted appears in the printed mastery rows to one decimal.

**Validates: Requirements 5.6, 5.7**

### Property 8: Deactivation is reversible
Deactivating then reactivating a competency restores the same averages, because
the scores were never removed.

**Validates: Requirements 1.8, 1.9**

### Property 9: A category always has at least one competency
No sequence of API calls leaves a category with zero active competencies.

**Validates: Requirements 1.6, 1.12**

### Property 10: `mapRow` is a whitelist
For any stored row carrying arbitrary extra keys — including the five legacy score
columns — no unknown key appears in the mapped record.

**Validates: Requirements 3.11, 6.1**

### Property 11: The list query stays parameterised
For any combination of list parameters, the built clause's placeholder count equals
the bind-parameter count and no supplied value appears as literal text.

**Validates: Requirements 6.3**

## Testing Strategy

Vitest with fast-check, repo conventions: pure-function properties at
`numRuns: 100`, DOM-driven at `numRuns: 20`, each carrying
`// Feature: configurable-rubrics, Property N: <title>`.

- **Unit** — key derivation from a label, descriptor lookup, the "at least one
  active" rule, the radar's fewer-than-three-axes fallback.
- **Property** — the eleven above. 1–6 and 8–11 are pure and cheap.
- **Route** — the `409` paths, `key`/`category` immutability, `mapRow` whitelist.
- **Integration** (guarded as `studentEvaluations.integration.test.js` is:
  separate test database URL, refuses if equal to `DATABASE_URL`, requires "test"
  in the name, skips when unset) — the migration's idempotency and backfill
  against a real table.
- **Regression** — the existing report-card suites must pass unchanged once the
  seeded rubric matches today's five, which is the strongest evidence the
  migration is behaviour-preserving.

**Never point tests at `DATABASE_URL`.** It is the live operational database.

## Migration and rollout

1. Ship the table, the `scores` column, and the seed. Nothing reads `scores` yet.
2. Switch reads to `scores`, keeping the five columns populated on write.
3. Switch writes to `scores` only; columns become nullable and stale.
4. Later, separately, drop the five columns.

Stage 2 is the reversible one: if the read path is wrong, revert the deploy and
the columns are still authoritative.

## Open Questions

1. **Who may edit a rubric?** *Deferred, recorded as Requirement 6.8.* Admin only,
   or Supervisor/SPA too? Changing a rubric changes every report card in that
   category, so this reads as Admin-only — but the API cannot enforce that until
   the sessions work in `employee-accounts-postgres` lands, so the restriction is
   written down to be added with that feature rather than forgotten.
2. **Is a per-category competency limit wanted?** *Settled as Requirement 1.12:*
   soft-warn at 8 active competencies, hard-refuse above 12, because the radar
   becomes unreadable past roughly eight axes.
3. **Should the report card print the rubric it was scored against?** D3 means a
   printed card reflects today's rubric. If a parent keeps two cards a year apart
   and the rubric changed between them, nothing on paper explains the difference.
4. **What happens to `Coder` if it genuinely needs a different 1–5 scale**, not
   just different competencies? Out of scope here; worth knowing if it is coming.
