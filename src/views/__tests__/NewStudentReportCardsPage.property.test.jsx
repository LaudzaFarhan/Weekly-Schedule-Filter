// @vitest-environment jsdom
// This file mounts component trees, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Report-document and page-level property tests.
 *
 *   Property 16 — the five numbers handed to the radar chart are the five
 *                 numbers printed in the Competency Mastery Summary (Req 3.7).
 *   Property 17 — saving merges the returned record into the local list without
 *                 duplicating a day (Req 3.11).
 *   Property 18 — every free-text value is rendered as text, never as markup
 *                 (Req 5.13).
 *
 * What is replaced, and why:
 *
 *   - `chart.js` and `react-chartjs-2` — jsdom implements no canvas, so the real
 *     library cannot construct a chart here. The stub also records the props
 *     handed to `<Radar>`, which is the only way to read the values a chart was
 *     actually given. Property 16 compares those recorded values against the
 *     printed lines, so the two renderers are checked against each other rather
 *     than both against the test's own arithmetic.
 *   - `next/dynamic` — the page loads both charts through it with `ssr: false`.
 *     The replacement hands back a prop-recording stub, so Property 17 can read
 *     the `LessonSeries` the page derived from its merged list, one point per
 *     record, which is the observable that shows whether a day was duplicated.
 *   - the two contexts, the four services and the students poll — the real
 *     `ScheduleContext` pulls in the whole application data layer, and the poll
 *     would otherwise fire real 3-second timers underneath the assertions. No
 *     request leaves the process and no test touches a database.
 *
 * Property 17 recomputes the expected merged list, the expected per-lesson means
 * and the expected overall grade in the test, from the generated inputs alone,
 * never through `src/lib/reportCard.js` — so the property cannot pass by
 * agreeing with the module it is checking.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import fc from 'fast-check';

import { COMPETENCIES } from '@/lib/reportCardRubric';

/* ------------------------------------------------------------------- mocks */

/** Every `<Radar>` / `<Line>` render, in order: `{ kind, props }`. */
const chartRenders = vi.hoisted(() => []);
/** Every render of a chart the page loaded through `next/dynamic`. */
const dynamicRenders = vi.hoisted(() => []);

vi.mock('chart.js', () => ({
  // The chart components call `ChartJS.register(...)` at module scope.
  Chart: { register: vi.fn() },
  RadialLinearScale: { id: 'radialLinear' },
  CategoryScale: { id: 'category' },
  LinearScale: { id: 'linear' },
  PointElement: { id: 'point' },
  LineElement: { id: 'line' },
  Filler: { id: 'filler' },
  Tooltip: { id: 'tooltip' },
  Legend: { id: 'legend' },
}));

vi.mock('react-chartjs-2', async () => {
  const { createElement } = await import('react');

  const stub = (kind) => {
    const Stub = (props) => {
      chartRenders.push({ kind, props });
      return createElement('div', { 'data-testid': `chart-${kind}` });
    };
    Stub.displayName = `${kind}Stub`;
    return Stub;
  };

  return { Radar: stub('radar'), Line: stub('line') };
});

vi.mock('next/dynamic', async () => {
  const { createElement } = await import('react');

  // The loader is deliberately never called: the point of the stub is to record
  // the props the page derived, not to exercise a chunk load. The trend chart is
  // the only one given a `series`, which is how the two are told apart.
  const dynamicStub = () => {
    const Stub = (props) => {
      dynamicRenders.push({ kind: props.series === undefined ? 'radar' : 'trend', props });
      return createElement('div', { 'data-testid': 'dynamic-chart' });
    };
    Stub.displayName = 'DynamicChartStub';
    return Stub;
  };

  return { __esModule: true, default: dynamicStub };
});

const ctx = vi.hoisted(() => ({ email: 'ada@schedule.local', branchNames: ['Bintaro'] }));

const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const getAllInternalInstructors = vi.hoisted(() => vi.fn());
const getEvaluations = vi.hoisted(() => vi.fn());
const saveEvaluation = vi.hoisted(() => vi.fn());
const getTerms = vi.hoisted(() => vi.fn());
const saveTerm = vi.hoisted(() => vi.fn());
const logActivity = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  ScheduleProvider: ({ children }) => children,
  useSchedule: () => ({
    enabledBranches: ctx.branchNames.map((name) => ({ name })),
    branches: ctx.branchNames.map((name) => ({ name })),
    users: {},
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: ctx.email ? { email: ctx.email } : null }),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({ showToast, dismissToast: () => {} }),
}));

vi.mock('@/services/internalStudentService', () => ({ subscribeToInternalStudents }));
vi.mock('@/services/internalInstructorService', () => ({ getAllInternalInstructors }));
vi.mock('@/services/studentEvaluationService', () => ({
  getEvaluations,
  saveEvaluation,
  updateEvaluation: vi.fn(),
  deleteEvaluation: vi.fn(),
}));
vi.mock('@/services/studentTermService', () => ({
  getTerms,
  saveTerm,
  deleteTerm: vi.fn(),
}));
vi.mock('@/services/newActivityService', () => ({
  logActivity,
  getActivity: vi.fn(async () => []),
  subscribeToActivity: vi.fn(() => () => {}),
  deleteActivity: vi.fn(async () => ({})),
  displayUser: (email) => (email ? String(email).split('@')[0] : 'Unknown user'),
}));

// Imported after the mock declarations; `vi.mock` is hoisted above all of them.
const { default: ReportCardDocument } = await import(
  '@/components/reportcards/ReportCardDocument'
);
const { default: CompetencyRadarChart } = await import(
  '@/components/reportcards/CompetencyRadarChart'
);
const { default: NewStudentReportCardsPage } = await import(
  '@/views/NewStudentReportCardsPage'
);
const { competencyAverages, overallGrade, termSummary } = await import('@/lib/reportCard');

/* ----------------------------------------------------------------- helpers */

const INSTRUCTOR = 'Ada';
// A `Kinder` level, so this student is the first student of the tab the page
// opens on and is therefore selected without a navigation parameter (Req 6.6).
const STUDENT = { id: 41, name: 'Nadia', level: 'Kinder Core', branchName: 'Bintaro', status: 'Active' };

/** `2019-06-` plus a two-digit day. Far from today, so no day pre-fills the form. */
const isoDay = (day) => `2019-06-${String(day).padStart(2, '0')}`;

const score = fc.integer({ min: 1, max: 5 });

/** The five Competency_Scores of one Evaluation_Record. */
const scoresArb = fc.record(
  Object.fromEntries(COMPETENCIES.map((competency) => [competency.key, score]))
);

/** One Evaluation_Record on `day`, carrying `id`. */
const evaluationOn = (id, day) =>
  scoresArb.map((scores) => ({
    id,
    studentId: STUDENT.id,
    date: isoDay(day),
    lessonTopic: `Lesson ${day}`,
    instructorNotes: `Notes ${day}`,
    instructorName: INSTRUCTOR,
    ...scores,
  }));

/** The mean of one record's five scores, computed here and not by the module. */
const meanOf = (row) =>
  COMPETENCIES.reduce((total, competency) => total + Number(row[competency.key]), 0) /
  COMPETENCIES.length;

const masteryRows = (container) =>
  Array.from(container.querySelectorAll('.report-mastery-row')).map((row) => ({
    label: row.querySelector('.report-mastery-label')?.textContent,
    value: row.querySelector('.report-mastery-value')?.textContent,
  }));

const lastRender = (kind) => chartRenders.filter((entry) => entry.kind === kind).at(-1);
const lastDynamic = (kind) => dynamicRenders.filter((entry) => entry.kind === kind).at(-1);

/** The page's own count line, which appears only once the data has loaded. */
const countText = (n) => `${n} evaluation${n === 1 ? '' : 's'} on record`;

beforeEach(() => {
  chartRenders.length = 0;
  dynamicRenders.length = 0;
  showToast.mockReset();
  logActivity.mockReset().mockResolvedValue({ id: 1 });
  getAllInternalInstructors.mockReset().mockResolvedValue([{ id: 1, name: INSTRUCTOR }]);
  getEvaluations.mockReset();
  saveEvaluation.mockReset();
  getTerms.mockReset().mockResolvedValue([]);
  saveTerm.mockReset();
  subscribeToInternalStudents.mockReset().mockImplementation((callback) => {
    callback([STUDENT]);
    return () => {};
  });
});

/* ------------------------------------------------------ Property 16 inputs */

/** One to six records on distinct days, so the averages are a real mean. */
const evaluationSet = fc
  .uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 6 })
  .chain((days) => fc.tuple(...days.map((day, index) => evaluationOn(index + 1, day))));

describe('ReportCardDocument numbers', () => {
  // Feature: student-report-cards, Property 16: The chart and the printed summary carry the same numbers
  it('prints each Competency Mastery Summary value as the value handed to the radar, to one decimal followed by " / 5.0"', () => {
    fc.assert(
      fc.property(evaluationSet, (evaluations) => {
        try {
          // Req 3.7 — ONE call of the derivation module for this student, whose
          // result both renderers are given. The document is handed the same
          // object the chart is handed, so a disagreement can only come from a
          // renderer, which is exactly what this property looks for.
          const averages = competencyAverages(evaluations);
          const { container } = render(
            <ReportCardDocument
              student={{ name: STUDENT.name }}
              averages={averages}
              grade={overallGrade(averages)}
              terms={termSummary([])}
              latest={evaluations[evaluations.length - 1]}
              radar={<CompetencyRadarChart averages={averages} size={{ width: 300, height: 300 }} />}
            />
          );

          // What the radar was actually given to plot, in rubric order.
          const plotted = lastRender('radar').props.data.datasets[0].data;
          expect(plotted).toHaveLength(COMPETENCIES.length);

          const printed = masteryRows(container);
          expect(printed).toHaveLength(COMPETENCIES.length);

          COMPETENCIES.forEach((competency, index) => {
            // Same five competencies, same order, on paper as on the axis.
            expect(printed[index].label).toBe(competency.label);

            // Req 3.7 — the printed line is the plotted value to one decimal,
            // then ` / 5.0`. Nothing is recomputed between the two renderers.
            expect(printed[index].value).toBe(`${plotted[index].toFixed(1)} / 5.0`);

            // And the plotted value is the average the module returned, so the
            // agreement above is agreement about the right number.
            expect(plotted[index]).toBe(averages[competency.key]);
          });
        } finally {
          cleanup();
        }
      }),
      // DOM-driven: every example mounts a component tree, so this runs at the
      // repo's mounting-test count rather than the pure-function 100.
      { numRuns: 20 }
    );
  }, 120000);
});

/* ------------------------------------------------------ Property 18 inputs */

/**
 * Free text that would become markup if it were ever written as HTML. Every
 * fragment uses a tag the report itself never renders, so finding one of those
 * elements in the tree is unambiguous evidence of an element created from text.
 */
const MARKUP_TAGS = ['script', 'img', 'iframe', 'b', 'i', 'svg', 'style', 'a', 'marquee'];
const MARKUP_FRAGMENTS = [
  '<script>window.__reportCardPwned = true;</script>',
  '<img src=x onerror="window.__reportCardPwned = true">',
  '<b>bold</b> & <i>italic</i>',
  '<iframe src="https://example.com/"></iframe>',
  '</div><svg onload="window.__reportCardPwned = true"></svg>',
  '<style>#report-card-print { display: none }</style>',
  '<a href="javascript:void 0">tap here</a>',
  '<marquee>5 / 5.0</marquee>',
  '&lt;already escaped&gt; & "quoted"',
];

const freeText = fc
  .tuple(fc.constantFrom('Gears', 'Loops', 'Great effort', 'Sam O’Neill'), fc.constantFrom(...MARKUP_FRAGMENTS))
  .map(([lead, markup]) => `${lead} ${markup}`);

/** How the DOM serialises a text node holding `value`. */
const escapeText = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('ReportCardDocument free text', () => {
  // Feature: student-report-cards, Property 18: Free text is rendered as text
  it('renders every lesson topic, remark and name as text content, creating no element and no script from it', async () => {
    // Req 5.13 — no element content is ever set from unescaped markup, which is
    // a claim about the source as well as about one render.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');

    const componentsDir = resolve(process.cwd(), 'src/components/reportcards');
    const files = [
      ...readdirSync(componentsDir)
        .filter((name) => name.endsWith('.jsx'))
        .map((name) => join(componentsDir, name)),
      resolve(process.cwd(), 'src/views/NewStudentReportCardsPage.jsx'),
    ];

    for (const file of files) {
      // Comments are stripped first: these files DISCUSS the rule in prose, and a
      // naive grep would match the sentence saying the API is not used.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join('\n');
      expect(code, `${file} sets element content from markup`).not.toMatch(
        /dangerouslySetInnerHTML/
      );
    }

    fc.assert(
      fc.property(
        evaluationSet,
        fc.record({
          studentName: freeText,
          instructorName: freeText,
          lessonTopic: freeText,
          instructorNotes: freeText,
        }),
        (evaluations, texts) => {
          try {
            delete globalThis.__reportCardPwned;

            const averages = competencyAverages(evaluations);
            const { container } = render(
              <ReportCardDocument
                student={{ name: texts.studentName }}
                averages={averages}
                grade={overallGrade(averages)}
                terms={termSummary([])}
                latest={{
                  ...evaluations[evaluations.length - 1],
                  lessonTopic: texts.lessonTopic,
                  instructorNotes: texts.instructorNotes,
                  instructorName: texts.instructorName,
                }}
                radar={<div data-testid="radar-slot" />}
              />
            );

            for (const value of Object.values(texts)) {
              // Req 5.13 — present, and present as text a parent can read.
              expect(container.textContent).toContain(value);
              // Serialised as escaped text, so the markup never reached the parser.
              expect(container.innerHTML).toContain(escapeText(value));
            }

            // Req 5.13 — no element was created from any fragment. These tags
            // appear nowhere in the report, so one existing means one was parsed.
            expect(container.querySelectorAll(MARKUP_TAGS.join(', '))).toHaveLength(0);

            // Nothing executed, either: an injected handler would have set this.
            expect(globalThis.__reportCardPwned).toBeUndefined();
          } finally {
            cleanup();
          }
        }
      ),
      // DOM-driven: `{ numRuns: 20 }`, as above.
      { numRuns: 20 }
    );
  }, 120000);
});

/* ------------------------------------------------------ Property 17 inputs */

/**
 * A starting list of nought to four records on distinct days, together with the
 * record the API returns from the save: either a replacement for one of those
 * days, carrying that day's id as an upsert does, or a record for a day the list
 * does not hold yet.
 */
const mergeCase = fc
  .oneof(
    // The already-empty list is its own branch: it is the state a new student is
    // in, and left to a free draw it would not reliably appear in 20 examples.
    { arbitrary: fc.constant([]), weight: 1 },
    { arbitrary: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 4 }), weight: 4 }
  )
  .chain((days) =>
    fc.tuple(
      days.length === 0 ? fc.constant([]) : fc.tuple(...days.map((day, i) => evaluationOn(i + 1, day))),
      fc.integer({ min: 0, max: Math.max(0, days.length) })
    )
  )
  .chain(([existing, pick]) => {
    // `pick === existing.length` is the new-day case; anything lower replaces
    // the record already held for that day, keeping its id (Req 2.2 upsert).
    const replacing = pick < existing.length ? existing[pick] : null;
    const freeDay = [13, 14, 15, 16, 17].find(
      (day) => !existing.some((row) => row.date === isoDay(day))
    );
    const savedId = replacing ? replacing.id : existing.length + 1;
    const savedDay = replacing ? Number(replacing.date.slice(-2)) : freeDay;

    return fc.tuple(fc.constant(existing), evaluationOn(savedId, savedDay));
  });

/** Set the five ratings, choose the instructor and save. */
async function driveSave() {
  await waitFor(() =>
    expect(screen.getByLabelText(/instructor \*/i).querySelectorAll('option').length).toBeGreaterThan(1)
  );
  fireEvent.change(screen.getByLabelText(/instructor \*/i), { target: { value: INSTRUCTOR } });

  // One option per row, all five rows. `fireEvent` rather than `userEvent`: the
  // rating options are plain buttons, and this property mounts the whole page
  // once per example, so the cheaper click keeps the run affordable.
  for (const competency of COMPETENCIES) {
    const option = screen.getByRole('radio', {
      name: new RegExp(`^${competency.label}, 4 of 5,`),
    });
    fireEvent.click(option);
  }

  fireEvent.click(screen.getByRole('button', { name: /save evaluation/i }));
}

describe('NewStudentReportCardsPage save merge', () => {
  // Feature: student-report-cards, Property 17: Saving merges without duplicating a day
  it('merges the returned record into the local list, replacing any record for the same day and disturbing no other day', async () => {
    // Coverage counters: both the replaced-day and the new-day case must occur.
    const seen = { replaced: 0, added: 0, emptyStart: 0 };

    await fc.assert(
      fc.asyncProperty(mergeCase, async ([existing, saved]) => {
        // Per example, not per test: `beforeEach` runs once for the whole
        // property, so without this the call counts would accumulate across
        // examples and across shrinking.
        chartRenders.length = 0;
        dynamicRenders.length = 0;
        getEvaluations.mockClear().mockResolvedValue(existing.map((row) => ({ ...row })));
        saveEvaluation.mockClear().mockResolvedValue({ ...saved });
        logActivity.mockClear();

        const replaces = existing.some((row) => row.date === saved.date);
        replaces ? (seen.replaced += 1) : (seen.added += 1);
        if (existing.length === 0) seen.emptyStart += 1;

        /**
         * The merged list this test expects, computed from the generated inputs
         * alone: every record for another day survives untouched, the saved
         * record is the only one for its own day, and the order is date order.
         */
        const expected = existing
          .filter((row) => row.date !== saved.date)
          .concat([saved])
          .sort((a, b) => a.date.localeCompare(b.date));

        try {
          const { container } = render(<NewStudentReportCardsPage />);

          // The load has landed when the page reports holding this student's
          // records — waited for before saving, so the merge is never racing an
          // in-flight load.
          await waitFor(() =>
            expect(screen.getByText(countText(existing.length))).toBeInTheDocument()
          );
          expect(lastDynamic('trend').props.series.dates).toEqual(
            existing.map((row) => row.date).sort((a, b) => a.localeCompare(b))
          );

          await driveSave();

          await waitFor(() => expect(saveEvaluation).toHaveBeenCalledTimes(1));
          await waitFor(() => {
            expect(lastDynamic('trend').props.series.dates).toEqual(
              expected.map((row) => row.date)
            );
          });

          const series = lastDynamic('trend').props.series;

          // Req 3.11 — at most one point per date: a day was replaced, not joined.
          expect(new Set(series.dates).size).toBe(series.dates.length);
          expect(series.dates).toHaveLength(expected.length);
          expect(series.values).toHaveLength(expected.length);
          // Contiguous true ordinals over the merged list.
          expect(series.labels).toEqual(expected.map((_row, index) => `L${index + 1}`));

          // The saved record's values are the ones present for its date, and no
          // other date's value moved. Both means are computed here, from the
          // generated records, never through the derivation module.
          expected.forEach((row, index) => {
            expect(series.values[index]).toBeCloseTo(meanOf(row), 6);
          });

          // Req 3.11 — the whole set recomputed: the score on screen is the mean
          // of every score in the merged list, rounded for display. Compared as a
          // rounding rather than as a string, so an exact halfway mean (85/20 is
          // reachable from integer scores) cannot fail on which way a float
          // landed one ulp from the tie.
          const totalScore = expected.reduce(
            (total, row) => total + COMPETENCIES.reduce((sum, c) => sum + Number(row[c.key]), 0),
            0
          );
          const grandMean = totalScore / (COMPETENCIES.length * expected.length);
          const shown = container.textContent.match(/(\d\.\d) \/ 5\.0/);
          expect(shown).not.toBeNull();
          expect(Math.abs(Number(shown[1]) - grandMean)).toBeLessThanOrEqual(0.05 + 1e-9);

          // …and the list the page reports holding is the merged one.
          expect(screen.getByText(countText(expected.length))).toBeInTheDocument();
        } finally {
          cleanup();
        }
      }),
      // DOM-driven: every example mounts the page, drives five ratings and a
      // save, so `{ numRuns: 20 }` per the repo convention. The two examples run
      // first (and count toward the 20) pin the replaced-day and new-day cases
      // into the budget rather than leaving both to a weighted draw.
      { numRuns: 20 }
    );

    expect(seen.replaced).toBeGreaterThan(0);
    expect(seen.added).toBeGreaterThan(0);
    expect(seen.emptyStart).toBeGreaterThan(0);
  }, 300000);
});
