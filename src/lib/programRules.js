/**
 * Program identity and slot-combination rules for New Operations.
 *
 * A teaching slot is one instructor + day + time + branch. Whether several
 * students may share that slot depends on configurable rules, because the
 * restriction differs by category:
 *
 *   Kinder — Kinder Foundation and Kinder Core cannot be combined.
 *   Junior — Junior Foundation and Junior Core may be combined.
 *   Coder  — any levels may be combined.
 *
 * Nothing here is hardcoded as policy; these are just the defaults used until
 * an admin changes them under Operationals → Schedule Rules.
 */

/** Program families, keyed by the code prefix pattern. */
const FAMILIES = [
  { family: 'Kinder Foundation', category: 'Kinder', test: (c) => /^kf\d*$/i.test(c) },
  { family: 'Kinder Core',       category: 'Kinder', test: (c) => /^k\d+$/i.test(c) },
  { family: 'Junior Foundation', category: 'Junior', test: (c) => /^jf\d*$/i.test(c) },
  { family: 'Junior Core',       category: 'Junior', test: (c) => /^j\d+$/i.test(c) },
  { family: 'Coder',             category: 'Coder',  test: (c) => /coder/i.test(c) },
];

export const CATEGORIES = ['Kinder', 'Junior', 'Coder'];

/**
 * Coder levels, one per stage.
 *
 * Kinder and Junior name their two stages without numbering them, and the
 * workload and profile screens have always counted Coder the same way — Basic,
 * Intermediate, Advance. Only the student and program dropdowns carried numbered
 * variants, and they disagreed with each other: one listed Coder Foundation 1-4
 * as well, the other did not. Neither Foundation nor Intermediate was ever used.
 * So the numbering is dropped and this is the single list everything reads.
 */
export const CODER_LEVELS = ['Coder Basic', 'Coder Intermediate', 'Coder Advance'];

/** Every level a student can be enrolled at, in curriculum order. */
export const STUDENT_LEVELS = [
  'Kinder Foundation',
  'Kinder Core',
  'Junior Foundation',
  'Junior Core',
  ...CODER_LEVELS,
];

/**
 * Program codes offered in each category, in curriculum order.
 *
 * Kinder and Junior codes carry a lesson number when stored ("J1.3"); the code
 * itself is the level. Coder levels are stored whole and have no lessons.
 */
export const CATEGORY_LEVELS = {
  Kinder: ['KF1', 'KF2', 'K1', 'K2', 'K3', 'K4'],
  Junior: ['JF1', 'JF2', 'J1', 'J2', 'J3', 'J4'],
  Coder: CODER_LEVELS,
};

/** The level codes a category runs, for progress tracking and video flags. */
export function levelsForCategory(category) {
  return CATEGORY_LEVELS[category] || [];
}

/** Lessons in one level — the default span of the attendance ticks. */
export const LESSONS_PER_LEVEL = 10;

/** Lessons in one level / subscription period for a given category. Coder runs 12 meetings (3-month subscription); Kinder and Junior run 10. */
export function lessonsForCategory(category) {
  const cat = String(category || '').trim();
  if (/^coder/i.test(cat)) return 12;
  return 10;
}

/**
 * How likely a student is to carry on after their current level.
 *
 * "Not Decide Yet" leads because it is the honest default for a student nobody
 * has spoken to yet; treating no answer as "Continue" would overstate retention.
 */
export const CONTINUATION_OPTIONS = [
  'Not Decide Yet',
  'Continue',
  'Uncertain',
  'Break',
  'Not Continue',
];

/**
 * Fold a legacy numbered Coder level onto its stage: "Coder Advance 2" reads as
 * "Coder Advance". Records written before the numbering was dropped stay
 * meaningful, so nothing has to be migrated for the app to behave correctly.
 * Anything that is not a Coder level is returned untouched.
 */
export function normaliseCoderLevel(value) {
  const raw = String(value || '').trim();
  if (!/^coder/i.test(raw)) return raw;
  const stripped = raw.replace(/\s*\d+\s*$/, '').trim();
  const match = CODER_LEVELS.find((l) => l.toLowerCase() === stripped.toLowerCase());
  return match || raw;
}

/**
 * Parse a stored program value into its parts.
 *
 *   "KF1.2"           -> code KF1, lesson 2, family Kinder Foundation
 *   "K2.3"            -> code K2,  lesson 3, family Kinder Core
 *   "Coder Advance"   -> code Coder Advance, no lesson, family Coder
 */
export function parseProgram(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw, code: '', lesson: null, family: null, category: null, lessonKey: '' };

  // Kinder/Junior codes carry a lesson number after a dot: "JF1.5".
  const dotted = raw.match(/^([A-Za-z]+\d*)\.(\d+)$/);
  const code = dotted ? dotted[1] : raw;
  const lesson = dotted ? dotted[2] : null;

  const match = FAMILIES.find((f) => f.test(code));

  return {
    raw,
    code,
    lesson,
    family: match?.family || null,
    category: match?.category || null,
    // Identity of the lesson being taught — what the "distinct lessons" cap counts.
    lessonKey: lesson ? `${code}.${lesson}` : code,
  };
}

/** Default rules, matching how the school actually operates today. */
export const DEFAULT_RULES = {
  Kinder: { allowMixFamilies: false, maxDistinctLessons: 2, maxStudents: 4, enforcement: 'block' },
  Junior: { allowMixFamilies: true,  maxDistinctLessons: 2, maxStudents: 6, enforcement: 'block' },
  Coder:  { allowMixFamilies: true,  maxDistinctLessons: 0, maxStudents: 6, enforcement: 'block' },
  // Applies across categories, e.g. a Kinder student joining a Junior slot.
  allowMixCategories: false,
};

/**
 * Seats available in a class running this program, per the configured rules.
 * Falls back to the Kinder 4 / others 6 convention for unknown programs.
 */
export function maxStudentsFor(program, rules) {
  const cfg = withDefaults(rules);
  const { category } = parseProgram(program);
  if (!category) return 6;
  return Number(cfg[category]?.maxStudents) || DEFAULT_RULES[category].maxStudents;
}

/** Merge stored rules over the defaults so missing keys stay sane. */
export function withDefaults(rules) {
  const out = {
    allowMixCategories: rules?.allowMixCategories ?? DEFAULT_RULES.allowMixCategories,
  };
  for (const cat of CATEGORIES) {
    out[cat] = { ...DEFAULT_RULES[cat], ...(rules?.[cat] || {}) };
  }
  return out;
}

/**
 * Can `candidate` be taught in a slot that already contains `existing`?
 *
 * @param {string[]} existing  program values already in the slot
 * @param {string}   candidate program value being added
 * @param {object}   rules     from withDefaults()
 * @returns {{ ok: boolean, severity: 'ok'|'warn'|'block', reason: string }}
 */
export function canCombine(existing, candidate, rules) {
  const cfg = withDefaults(rules);
  const next = parseProgram(candidate);
  const current = (existing || []).map(parseProgram).filter((p) => p.raw);

  if (!next.raw || current.length === 0) {
    return { ok: true, severity: 'ok', reason: 'Slot is empty' };
  }

  // Unknown program codes can't be reasoned about — allow, but say so.
  if (!next.category) {
    return { ok: true, severity: 'warn', reason: `Unrecognised program "${next.raw}" — rules not applied` };
  }

  const categories = new Set(current.map((p) => p.category).filter(Boolean));
  const families = new Set(current.map((p) => p.family).filter(Boolean));

  // 1. Cross-category mixing.
  if (!cfg.allowMixCategories) {
    const other = [...categories].find((c) => c !== next.category);
    if (other) {
      return {
        ok: false,
        severity: 'block',
        reason: `Slot is ${other} — cannot add a ${next.category} student`,
      };
    }
  }

  const rule = cfg[next.category] || DEFAULT_RULES[next.category];
  const severity = rule.enforcement === 'warn' ? 'warn' : 'block';

  // 2. Seat capacity. One entry in `existing` is one enrolled student.
  const capacity = Number(rule.maxStudents) || DEFAULT_RULES[next.category].maxStudents;
  if (current.length >= capacity) {
    return {
      ok: severity === 'warn',
      severity,
      reason: `Slot is full — ${current.length}/${capacity} students for ${next.category}`,
    };
  }

  // 3. Family mixing within the category.
  if (!rule.allowMixFamilies) {
    const otherFamily = [...families].find((f) => f && f !== next.family);
    if (otherFamily) {
      return {
        ok: severity === 'warn',
        severity,
        reason: `Slot runs ${otherFamily} — ${next.family} cannot be combined with it`,
      };
    }
  }

  // 4. Distinct lesson cap (0 or less means unlimited).
  const max = Number(rule.maxDistinctLessons) || 0;
  if (max > 0) {
    const lessons = new Set(current.map((p) => p.lessonKey));
    if (!lessons.has(next.lessonKey) && lessons.size >= max) {
      return {
        ok: severity === 'warn',
        severity,
        reason: `Slot already runs ${lessons.size} lesson${lessons.size === 1 ? '' : 's'} (${[...lessons].join(', ')}) — limit is ${max}`,
      };
    }
  }

  return { ok: true, severity: 'ok', reason: 'Compatible with this slot' };
}

/**
 * Check a whole slot for rule violations — used to audit classes that were
 * entered before the rules existed.
 *
 * @param {string[]} programs every program value in the slot
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateSlot(programs, rules) {
  const list = (programs || []).filter(Boolean);
  for (let i = 1; i < list.length; i += 1) {
    const result = canCombine(list.slice(0, i), list[i], rules);
    if (result.severity === 'block' && !result.ok) {
      return { ok: false, reason: result.reason };
    }
  }
  return { ok: true, reason: '' };
}

/**
 * Walk a list of programs into a slot one at a time, reporting the verdict for
 * each. Powers the "simulate a class" tool so the rules can be tried out
 * without touching real data.
 *
 * @returns {{ steps: Array, accepted: string[], capacity: number|null, category: string|null }}
 */
export function simulateSlot(programs, rules) {
  const accepted = [];
  const steps = [];

  for (const program of (programs || []).filter(Boolean)) {
    const verdict = canCombine(accepted, program, rules);
    const admitted = verdict.ok;
    if (admitted) accepted.push(program);
    steps.push({
      program,
      admitted,
      severity: verdict.severity,
      reason: verdict.reason,
      seatsUsed: accepted.length,
    });
  }

  // Report capacity for whichever category ended up in the slot.
  const first = accepted[0] || (programs || [])[0];
  const parsed = first ? parseProgram(first) : null;
  return {
    steps,
    accepted,
    category: parsed?.category || null,
    capacity: first ? maxStudentsFor(first, rules) : null,
  };
}
