/**
 * Old Operations sunset arithmetic, kept free of React, the DOM and the clock so
 * the parts that are easy to get wrong — which calendar day a deadline falls on,
 * how many days are left, what the notice is allowed to say — can be tested from
 * any day at all.
 *
 * The current instant is always a parameter. Nothing in here calls `Date.now()`,
 * `Date.parse` or any host-timezone getter, because the school's day is the unit
 * of measure, not the viewer's.
 */

/** Asia/Jakarta is UTC+7 with no DST, so a fixed offset is correct here. */
export const WIB_OFFSET_MINUTES = 420;

/** The shipped retirement date. Overridable via /api/new/config oldOpsSunset. */
export const OLD_OPS_SUNSET_ISO = '2026-09-01';

/** Phase names, ordered from least to most urgent. `past` is terminal. */
export const SUNSET_PHASES = ['notice', 'warning', 'urgent', 'final', 'past'];

/** localStorage key for the dismissal record. */
export const DISMISS_KEY = 'opsSunset.dismissed';

/** One day, in milliseconds. Every day index is measured in these. */
const MS_PER_DAY = 86400000;

/** The WIB offset in milliseconds, applied to every instant conversion. */
const WIB_OFFSET_MS = WIB_OFFSET_MINUTES * 60000;

/** `YYYY-MM-DD` with the three fields captured, so they can be read singly. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The WIB calendar day an instant falls on, as an integer count of days from the
 * epoch.
 *
 * Shifting the instant forward by the offset turns midnight in Jakarta into
 * midnight UTC, so flooring gives the school's calendar day rather than the
 * viewer's. Every instant between 00:00:00.000 and 23:59:59.999 WIB gives the
 * same index, and the next WIB midnight gives exactly one more.
 *
 * @param   {number} instantMs epoch milliseconds
 * @returns {number|null} an integer day index, or `null` for anything that is
 *                        not a finite number. Never `NaN`.
 */
export function wibDayIndex(instantMs) {
  if (typeof instantMs !== 'number' || !Number.isFinite(instantMs)) return null;
  return Math.floor((instantMs + WIB_OFFSET_MS) / MS_PER_DAY);
}

/**
 * The day index of a `"YYYY-MM-DD"` date, on the same scale as `wibDayIndex`.
 *
 * Read field by field and built in UTC, never through `Date.parse`: a bare ISO
 * date is parsed as UTC midnight and then lands on the previous day anywhere west
 * of Greenwich, so the same deadline would be a different day depending on who
 * was looking.
 *
 * The fields are round-tripped afterwards because the date constructor
 * normalises overflow in silence — `2026-02-30` becomes 1 March, `2026-13-01`
 * becomes January 2027 — and counting down to a date nobody named is worse than
 * showing nothing.
 *
 * @param   {*} iso a candidate date string; any other type is a normal input
 * @returns {number|null} an integer day index, or `null` for a malformed string,
 *                        a non-string, or a date that does not exist.
 */
export function isoDayIndex(iso) {
  if (typeof iso !== 'string') return null;

  const match = ISO_DATE_RE.exec(iso);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Built from the epoch and set through the four-digit-year setter rather than
  // `Date.UTC(year, ...)`, which maps years 0–99 into the 1900s and would reject
  // every date before 0100 on the round-trip below.
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  const utcMs = probe.getTime();
  if (!Number.isFinite(utcMs)) return null;

  const rolled =
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day;
  if (rolled) return null;

  // `utcMs` is midnight UTC, hence an exact multiple of MS_PER_DAY.
  return utcMs / MS_PER_DAY;
}

/**
 * Whole WIB calendar days from `nowMs` to the retirement date: `0` throughout the
 * deadline's own day, `1` throughout the day before, `-1` throughout the day
 * after.
 *
 * Two integers subtracted, never a millisecond difference divided, so the answer
 * cannot drift with the time of day and ticks over at midnight in Jakarta rather
 * than in the viewer's timezone.
 *
 * @param   {*} sunsetISO the retirement date; malformed input is a normal case
 * @param   {number} nowMs the current instant, in epoch milliseconds
 * @returns {number|null} an integer, or `null` when either side is unreadable.
 */
export function daysUntilSunset(sunsetISO, nowMs) {
  const target = isoDayIndex(sunsetISO);
  if (target === null) return null;

  const today = wibDayIndex(nowMs);
  if (today === null) return null;

  return target - today;
}
/**
 * Full English month names, indexed by month number minus one.
 *
 * A local table rather than `toLocaleDateString`, so the notice reads the same on
 * a machine set to `de-DE` as on one set to `en-GB`: the deadline is one
 * organisational fact and it should not be spelled two ways.
 */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The retirement date to count down to: the configured value when it names a real
 * calendar date, otherwise the shipped constant, otherwise nothing.
 *
 * The precedence runs that way round so a malformed config value can never
 * suppress the notice. Anything the Config_Service hands back that is not a real
 * date — a number, an object, `"1 Sept"`, `"2027-02-29"` — falls through to the
 * fallback and the countdown carries on, because a broken setting silently
 * cancelling the deadline is the one failure this feature cannot afford.
 *
 * Derived from the two arguments alone: no Storage entry, no host timezone and no
 * clock, so every browser given the same pair resolves the same date.
 *
 * @param   {*} fallbackISO the shipped default, normally `OLD_OPS_SUNSET_ISO`
 * @param   {*} configuredISO the Config_Service value; any type is a normal input
 * @returns {string|null} whichever argument names a real calendar date, preferring
 *                        `configuredISO`, or `null` when neither does. Never
 *                        throws.
 */
export function resolveSunsetISO(fallbackISO, configuredISO) {
  if (isoDayIndex(configuredISO) !== null) return configuredISO;
  if (isoDayIndex(fallbackISO) !== null) return fallbackISO;
  return null;
}

/**
 * A retirement date written out for people: `'2026-09-01'` → `'1 September 2026'`.
 *
 * The three fields are read straight off the validated string and the month name
 * comes from `MONTH_NAMES`, so there is no `Date` in the output path at all —
 * nothing to shift the date backwards for a viewer west of Greenwich, and nothing
 * to render the month in the host's language. No leading zero on the day and no
 * weekday name, because the sentence it sits in reads as prose.
 *
 * @param   {*} iso a candidate `"YYYY-MM-DD"` date; any other value is normal
 * @returns {string} the formatted date, or `''` for anything that is not a real
 *                   calendar date. Never contains `NaN`, `undefined` or
 *                   `Invalid`, and never throws.
 */
export function formatSunsetDate(iso) {
  if (isoDayIndex(iso) === null) return '';

  const match = ISO_DATE_RE.exec(iso);
  const day = Number(match[3]);
  const monthName = MONTH_NAMES[Number(match[2]) - 1];
  if (!monthName) return '';

  return `${day} ${monthName} ${match[1]}`;
}

/**
 * Which phase a day count falls in.
 *
 * The comparisons run most-past first so the chain is total over the integers:
 * a machine whose clock is set to 1970 or to 2400 still lands in exactly one
 * branch, and there is no gap between the branches for a stray value to fall
 * through. Severity therefore never decreases as the count goes down, which is
 * the one ordering property the banner depends on.
 *
 * @param   {*} days the day count, normally from `daysUntilSunset`
 * @returns {string|null} one member of `SUNSET_PHASES`, or `null` for anything
 *                        that is not an integer, including `null`, `NaN`,
 *                        `Infinity`, `2.5`, `"3"`, booleans, arrays and objects.
 *                        Never throws.
 */
export function sunsetPhase(days) {
  if (!Number.isInteger(days)) return null;

  if (days < 0) return 'past';
  if (days === 0) return 'final';
  if (days <= 3) return 'urgent';
  if (days <= 14) return 'warning';
  return 'notice';
}

/**
 * The severity ordering of a phase name: `0` for `notice` through `4` for `past`.
 *
 * Exact string match only. `'Warning'`, `' warning'` and `'warning '` are all
 * unknown values rather than near-misses, because a rank derived from a
 * mistyped phase would compare as less urgent than it is and quietly soften the
 * notice.
 *
 * @param   {*} phase a candidate phase name; any type is a normal input
 * @returns {number} the zero-based position in `SUNSET_PHASES`, or `-1`.
 *                   Never throws.
 */
export function phaseRank(phase) {
  if (typeof phase !== 'string') return -1;
  return SUNSET_PHASES.indexOf(phase);
}

/**
 * Whether a phase may be dismissed.
 *
 * `final` and `past` may not: neither is a reminder about a future event any
 * more, they are the current status of the screen the user is looking at, and a
 * status is not something you close (D4).
 *
 * @param   {*} phase a candidate phase name
 * @returns {boolean} `true` for `notice`, `warning` and `urgent`, `false` for
 *                    `final`, `past` and every other value.
 */
export function isDismissible(phase) {
  return phaseRank(phase) >= 0 && phase !== 'final' && phase !== 'past';
}

/**
 * A day count with the noun agreeing with it: `1 day`, `2 days`, `0 days`.
 *
 * @param   {number} days an integer day count
 * @returns {string} the count and its noun
 */
function dayCount(days) {
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
}

/**
 * Everything each phase says, in one table.
 *
 * `tone` is the phase name, so the CSS class and the phase can never drift
 * apart. The icons repeat once by design — `urgent` and `final` share
 * `AlertCircle` — and those two are told apart by their wording and by whether
 * they can be dismissed rather than by their icon, since one glyph for "this is
 * serious" is clearer than inventing a second one (Req 3.11).
 *
 * The five headlines are different sentences, not the same sentence with a
 * different number in it, so the phase is legible with every colour stripped
 * out and with the number read aloud on its own. No copy names a colour: the
 * tone class is decoration on top of wording that already carries the meaning.
 *
 * Every rendered `detail` stays inside 240 characters, the same cap
 * `tourSteps.test.js` puts on tour step bodies, so any of this copy can be
 * lifted into a tour step without breaking that test.
 *
 * @type {Record<string, {
 *   tone: string,
 *   icon: string,
 *   headline: (days: number, date: string) => string,
 *   detail: (days: number, date: string) => string,
 * }>}
 */
export const PHASE_COPY = {
  notice: {
    tone: 'notice',
    icon: 'Info',
    headline: (days, date) => `Old Operations closes on ${date}.`,
    detail: (days, date) =>
      `${dayCount(days)} left. New Operations is where work happens from now on, `
      + `and anything started in Old Operations after ${date} will not be carried over.`,
  },
  warning: {
    tone: 'warning',
    icon: 'AlertTriangle',
    headline: (days, date) => `Old Operations closes in ${dayCount(days)}, on ${date}.`,
    detail: (days, date) =>
      `${dayCount(days)} left. Move anything you still need into New Operations. `
      + `Work started in Old Operations after ${date} will not be carried over.`,
  },
  urgent: {
    tone: 'urgent',
    icon: 'AlertCircle',
    headline: (days) => `Only ${dayCount(days)} left in Old Operations.`,
    detail: (days, date) =>
      `${dayCount(days)} left. Anything you still need should be in New Operations `
      + `before ${date}. Old Operations work after that date will not be carried over.`,
  },
  final: {
    tone: 'final',
    icon: 'AlertCircle',
    headline: () => 'Today is the last day of Old Operations.',
    detail: (days) =>
      `${dayCount(days)} left. Old Operations stays open and nothing has been deleted, `
      + 'but from tomorrow it is unsupported, so start new work in New Operations.',
  },
  past: {
    tone: 'past',
    icon: 'Archive',
    headline: (days, date) => `Old Operations closed on ${date}.`,
    detail: () =>
      'Old Operations is unsupported and nothing new should be started here. '
      + 'It still opens and nothing has been deleted, but New Operations is where '
      + 'work happens now.',
  },
};

/**
 * The compact label for the Old Operations switcher tab: `'28d'` while the
 * deadline is ahead, `'retired'` once it has passed.
 *
 * Short on purpose — it sits inside a control, so it labels the thing being
 * retired rather than interrupting anyone, and every fact it carries is also in
 * the banner. `past` drops the digits entirely, because a negative day count in
 * a pill reads as a fault rather than as a date that has gone by.
 *
 * At most 8 characters for any day count a real clock can produce: `'retired'`
 * is 7, and a 6-digit count is 2,700 years out.
 *
 * @param   {*} phase one member of `SUNSET_PHASES`
 * @param   {*} days the integer day count for that phase
 * @returns {string} the badge text, or `''` when either argument is unusable —
 *                   the Sidebar renders no badge for an empty string.
 */
export function badgeFor(phase, days) {
  if (phaseRank(phase) < 0) return '';
  if (phase === 'past') return 'retired';
  if (!Number.isInteger(days)) return '';
  return `${days}d`;
}
/**
 * The dismissal record, if there is a usable one.
 *
 * Storage is passed in rather than reached for, the same way `tour.js` does it,
 * so this is testable without a browser and a private-mode lockdown cannot throw
 * out of a render. `null` storage is a normal input, not an error.
 *
 * Every failure — no storage, a `getItem` that throws, a missing key, JSON that
 * does not parse, a value that is not an object, a phase nobody has heard of, an
 * `at` that is not a finite number — returns `null`, which the callers read as
 * "not dismissed". That direction is deliberate: showing the banner one more
 * time costs a glance, and hiding a deadline costs a migration (Req 13.3).
 *
 * @param   {*} storage a `localStorage`-like object, or `null`
 * @returns {{ phase: string, at: number }|null} the stored record, narrowed to
 *          those two fields, or `null`. Never throws.
 */
export function readDismissal(storage) {
  if (!storage) return null;

  let raw;
  try {
    raw = storage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }

  if (typeof raw !== 'string') return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  if (phaseRank(parsed.phase) < 0) return null;
  if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;

  return { phase: parsed.phase, at: parsed.at };
}

/**
 * Record that the user dismissed the notice in `phase`, at `nowMs`.
 *
 * One key, overwritten, so exactly one record exists however many times the
 * banner is dismissed: the record is "the last thing they closed", not a history.
 * The phase is what scopes it — the notice comes back as soon as the phase
 * escalates, because at that point it has something new to say (D4).
 *
 * @param   {*} phase the phase being dismissed; must be in `SUNSET_PHASES`
 * @param   {*} nowMs the current instant, in epoch milliseconds
 * @param   {*} storage a `localStorage`-like object, or `null`
 * @returns {boolean} `true` when the record was written, `false` when storage is
 *                    absent, throws, or the arguments are unusable. Never throws.
 */
export function recordDismissal(phase, nowMs, storage) {
  if (!storage) return false;
  if (phaseRank(phase) < 0) return false;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;

  try {
    storage.setItem(DISMISS_KEY, JSON.stringify({ phase, at: nowMs }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the dismissal, so the notice returns. Used by tests and by anything
 * that wants to re-offer the banner without waiting for the phase to escalate.
 *
 * @param   {*} storage a `localStorage`-like object, or `null`
 * @returns {boolean} `true` when the key was removed, `false` when storage is
 *                    absent or throws. Never throws.
 */
export function clearDismissal(storage) {
  if (!storage) return false;

  try {
    storage.removeItem(DISMISS_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is `phase` currently dismissed, given the record we have and the instant we
 * are at?
 *
 * Pure: the record is handed in, so this reads no storage and no clock, and the
 * caller decides what "now" means.
 *
 * The record has to name this exact phase. A `warning` dismissal says nothing
 * about `urgent`, which is the whole of D4 — dismissal is scoped to the wording
 * that was dismissed, so escalation always re-surfaces the notice.
 *
 * A record stamped after `nowMs` is discarded rather than honoured. It can only
 * have come from a clock that was wrong when it was written, and a dismissal
 * dated in 2031 would otherwise hide the deadline on that machine for good.
 *
 * @param   {*} phase the current phase
 * @param   {*} dismissal a record, normally from `readDismissal`, or `null`
 * @param   {*} nowMs the current instant, in epoch milliseconds
 * @returns {boolean} `true` only for a well-formed record whose `phase` matches
 *                    and whose `at` is finite and no later than `nowMs`.
 *                    Never throws, whatever shape `dismissal` has.
 */
export function isDismissed(phase, dismissal, nowMs) {
  if (typeof dismissal !== 'object' || dismissal === null) return false;
  if (phaseRank(phase) < 0) return false;
  if (dismissal.phase !== phase) return false;

  const at = dismissal.at;
  if (typeof at !== 'number' || !Number.isFinite(at)) return false;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;

  return at <= nowMs;
}
/**
 * The whole notice, assembled: one object the banner and the switcher badge can
 * render without arithmetic, a lookup or a `null` check of their own.
 *
 * Two ways out early, and both return `{ visible: false }` with no other field
 * at all (Req 10.10), so there is nothing for a caller to read by accident and
 * nothing half-populated to render:
 *
 * - the date does not parse, or the instant is not finite — a broken setting
 *   shows nothing rather than "closes in NaN days", because a visibly wrong
 *   countdown costs more trust than an absent one;
 * - the current phase has been dismissed. Only a dismissible phase can be, so a
 *   hand-written record naming `final` or `past` is ignored and those two stay on
 *   screen (Req 5.15) — by then the notice is the status of the screen the user
 *   is looking at, not a reminder they can close.
 *
 * Otherwise every field is filled from `PHASE_COPY`, with the day count and the
 * written-out date interpolated, so `tone`, `icon` and wording cannot drift apart
 * from the phase they belong to. `days` is whatever `daysUntilSunset` returned,
 * an integer, negative once the date has gone by.
 *
 * The instant is a parameter and storage is handed in, so this reads no clock and
 * reaches for no global: a test can sit on any day it likes, and a private-mode
 * lockdown that throws on `getItem` reads as "not dismissed" rather than throwing
 * out of a render (Req 13.5).
 *
 * @param   {object} [options] the inputs; an absent argument is a normal case
 * @param   {*} [options.sunsetISO] the resolved retirement date, from
 *          `resolveSunsetISO`; any type is a normal input
 * @param   {*} [options.nowMs] the current instant, in epoch milliseconds
 * @param   {*} [options.storage] a `localStorage`-like object, or `null`
 * @returns {{ visible: boolean, phase?: string, days?: number, sunsetISO?: string,
 *          dismissible?: boolean, tone?: string, icon?: string, headline?: string,
 *          detail?: string, badge?: string }} the view model: either
 *          `{ visible: false }` alone, or every field populated. Never throws.
 */
export function sunsetNotice(options) {
  const { sunsetISO, nowMs, storage } =
    typeof options === 'object' && options !== null ? options : {};

  const days = daysUntilSunset(sunsetISO, nowMs);
  if (days === null) return { visible: false };

  const phase = sunsetPhase(days);
  if (phase === null) return { visible: false };

  const dismissible = isDismissible(phase);
  if (dismissible && isDismissed(phase, readDismissal(storage), nowMs)) {
    return { visible: false };
  }

  const copy = PHASE_COPY[phase];
  const date = formatSunsetDate(sunsetISO);

  return {
    visible: true,
    phase,
    days,
    sunsetISO,
    dismissible,
    tone: copy.tone,
    icon: copy.icon,
    headline: copy.headline(days, date),
    detail: copy.detail(days, date),
    badge: badgeFor(phase, days),
  };
}
