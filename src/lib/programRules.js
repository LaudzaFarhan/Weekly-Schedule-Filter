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
  { family: 'Kinder Foundation', category: 'Kinder', test: (c) => /^kf\d*$/i.test(c) || /^kinder\s*foundation/i.test(c) },
  { family: 'Kinder Core',       category: 'Kinder', test: (c) => /^k\d+$/i.test(c) || /^k$/i.test(c) || /^kinder/i.test(c) },
  { family: 'Junior Foundation', category: 'Junior', test: (c) => /^jf\d*$/i.test(c) || /^junior\s*foundation/i.test(c) },
  { family: 'Junior Core',       category: 'Junior', test: (c) => /^j\d+$/i.test(c) || /^j$/i.test(c) || /^junior/i.test(c) },
  { family: 'Coder',             category: 'Coder',  test: (c) => /coder|basic|intermediate|advance|python|web|app|scratch|roblox/i.test(c) || (/foundation/i.test(c) && !/kinder|junior|^kf|^jf/i.test(c)) },
];

export const CATEGORIES = ['Kinder', 'Junior', 'Coder'];

/**
 * Coder levels:
 * - Foundation 1-4
 * - Basic 1-2
 * - Intermediate 1-2
 * - Advance 1-3
 * Each numbered level is a separated level.
 */
export const CODER_LEVELS = [
  'Foundation 1',
  'Foundation 2',
  'Foundation 3',
  'Foundation 4',
  'Basic 1',
  'Basic 2',
  'Intermediate 1',
  'Intermediate 2',
  'Advance 1',
  'Advance 2',
  'Advance 3',
];

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
 * Calculate expected target meetings for a subscription package.
 * Coder:
 *   1 Month  -> 4 Meetings
 *   3 Months -> 12 Meetings (Standard package)
 *   6 Months -> 24 Meetings
 *   9 Months -> 36 Meetings
 *   1 Year / 12 Months -> 48 Meetings
 * Kinder / Junior:
 *   10 Lessons per Term
 */
export function meetingsForSubscription(subscription, category = 'Coder') {
  const sub = String(subscription || '').toLowerCase();
  const cat = String(category || '').toLowerCase();

  if (cat.includes('coder')) {
    if (sub.includes('1 month') || sub.includes('1 bulan')) return 4;
    if (sub.includes('6 month') || sub.includes('6 bulan')) return 24;
    if (sub.includes('9 month') || sub.includes('9 bulan')) return 36;
    if (sub.includes('1 year') || sub.includes('12 month') || sub.includes('1 tahun')) return 48;
    return 12; // default standard 3-month package
  }

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
 * Normalise a Coder level value onto one of the 11 separated levels:
 * Foundation 1-4, Basic 1-2, Intermediate 1-2, Advance 1-3.
 * Preserves specific level numbers, strips redundant "Coder " prefix if present,
 * and maps legacy unnumbered stage names onto stage 1.
 * Non-coder levels are returned untouched.
 */
export function normaliseCoderLevel(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  // Exact or case-insensitive match on canonical CODER_LEVELS
  const exactMatch = CODER_LEVELS.find((l) => l.toLowerCase() === raw.toLowerCase());
  if (exactMatch) return exactMatch;

  // Strip leading "Coder " or "Coder-" if present (e.g. "Coder Basic 2" -> "Basic 2")
  const withoutCoder = raw.replace(/^coder\s*[-–—:]?\s*/i, '').trim();
  const matchWithoutCoder = CODER_LEVELS.find((l) => l.toLowerCase() === withoutCoder.toLowerCase());
  if (matchWithoutCoder) return matchWithoutCoder;

  // Spaced numbers: "Foundation-1", "Basic2"
  const spaced = withoutCoder.replace(/^([a-z]+)\s*[-_]?\s*(\d+)$/i, '$1 $2');
  const matchSpaced = CODER_LEVELS.find((l) => l.toLowerCase() === spaced.toLowerCase());
  if (matchSpaced) return matchSpaced;

  // Legacy unnumbered stages map to stage 1:
  if (/^(?:coder\s*)?foundation$/i.test(raw)) return 'Foundation 1';
  if (/^(?:coder\s*)?basic$/i.test(raw)) return 'Basic 1';
  if (/^(?:coder\s*)?intermediate$/i.test(raw)) return 'Intermediate 1';
  if (/^(?:coder\s*)?advance$/i.test(raw)) return 'Advance 1';

  return raw;
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
