// Feature: student-data-bulk-wipe, Property 1: The confirmation phrase gate opens only for the exact trimmed phrase
//
// Property 1 is an if-and-only-if statement, so both directions are covered:
//   - any amount of leading/trailing whitespace around the exact phrase passes;
//   - every other value fails, including case variants, inner-whitespace
//     variants, near misses, empty strings and non-string values.
//
// Expected outcomes come from how each value is constructed, never from calling
// `trim()` inside the test, so the test does not restate the implementation.
//
// **Validates: Requirements 3.5, 5.1, 5.3**

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  WIPE_CONFIRMATION_PHRASE,
  matchesConfirmationPhrase,
} from '@/lib/wipeConfirmation';

const PHRASE = WIPE_CONFIRMATION_PHRASE;

/**
 * Every code point that `String.prototype.trim` strips: the ECMAScript
 * WhiteSpace set (TAB, VT, FF, SP, NBSP, ZWNBSP, Unicode Zs) plus the
 * LineTerminator set (LF, CR, LS, PS).
 */
const TRIMMED_WHITESPACE = [
  ' ', '\t', '\n', '\r', '\v', '\f',
  '\u00a0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200a',
  '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
];

/** Characters that survive a trim, used to build near misses. */
const NON_WHITESPACE = ['a', 'x', 'Z', '0', '9', '!', '_', '-', '.', 'é', 'Δ', 'Ｄ', '\u200b'];

/** Indices of the alphabetic characters in the phrase, i.e. every position bar the two spaces. */
const LETTER_INDICES = [...PHRASE]
  .map((char, index) => (/[A-Za-z]/.test(char) ? index : -1))
  .filter((index) => index >= 0);

/** Possibly-empty run of trimmable whitespace. */
const whitespaceRun = fc
  .array(fc.constantFrom(...TRIMMED_WHITESPACE), { maxLength: 8 })
  .map((chars) => chars.join(''));

/** At least one trimmable whitespace character. */
const nonEmptyWhitespaceRun = fc
  .array(fc.constantFrom(...TRIMMED_WHITESPACE), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

const nonWhitespaceChar = fc.constantFrom(...NON_WHITESPACE);

/** The phrase with at least one letter lowercased — differs only in letter case. */
const caseVariant = fc
  .uniqueArray(fc.constantFrom(...LETTER_INDICES), { minLength: 1, maxLength: LETTER_INDICES.length })
  .map((indices) => {
    const chars = [...PHRASE];
    for (const index of indices) chars[index] = chars[index].toLowerCase();
    return chars.join('');
  });

/** Whitespace injected strictly inside the phrase, where a trim cannot reach it. */
const innerWhitespaceVariant = fc
  .tuple(fc.integer({ min: 1, max: PHRASE.length - 1 }), nonEmptyWhitespaceRun)
  .map(([at, run]) => `${PHRASE.slice(0, at)}${run}${PHRASE.slice(at)}`);

/** One character short of the phrase. */
const droppedCharVariant = fc
  .integer({ min: 0, max: PHRASE.length - 1 })
  .map((at) => `${PHRASE.slice(0, at)}${PHRASE.slice(at + 1)}`);

/** One phrase character doubled. */
const duplicatedCharVariant = fc
  .integer({ min: 0, max: PHRASE.length - 1 })
  .map((at) => `${PHRASE.slice(0, at)}${PHRASE[at]}${PHRASE.slice(at)}`);

/** One phrase character swapped for a different, non-whitespace character. */
const replacedCharVariant = fc
  .tuple(fc.integer({ min: 0, max: PHRASE.length - 1 }), nonWhitespaceChar)
  .filter(([at, char]) => PHRASE[at] !== char)
  .map(([at, char]) => `${PHRASE.slice(0, at)}${char}${PHRASE.slice(at + 1)}`);

/** Non-whitespace text bolted onto one end or both ends of the phrase. */
const extraTextVariant = fc
  .tuple(
    fc.array(nonWhitespaceChar, { maxLength: 4 }).map((chars) => chars.join('')),
    fc.array(nonWhitespaceChar, { maxLength: 4 }).map((chars) => chars.join('')),
  )
  .filter(([before, after]) => before.length > 0 || after.length > 0)
  .map(([before, after]) => `${before}${PHRASE}${after}`);

/** The empty string and strings made only of trimmable whitespace. */
const blankString = whitespaceRun;

/** Arbitrary text that is not the phrase in any padding. */
const unrelatedString = fc
  .string({ maxLength: 40 })
  .filter((value) => !value.includes(PHRASE));

/** Values that are not strings at all, including look-alikes that stringify to the phrase. */
const nonStringValue = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(Number.NaN),
  fc.object(),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.constant([PHRASE]),
  fc.constant({ confirm: PHRASE }),
  fc.constant({ toString: () => PHRASE }),
  fc.constant(new String(PHRASE)), // eslint-disable-line no-new-wrappers
  fc.constant(Symbol(PHRASE)),
  fc.constant(() => PHRASE),
);

/**
 * String values that are not the phrase surrounded by whitespace. Padding is
 * added freely: wrapping any string in trimmable whitespace cannot change what
 * a trim yields, so a non-matching core stays non-matching.
 */
const nonMatchingString = fc
  .tuple(
    whitespaceRun,
    fc.oneof(
      caseVariant,
      innerWhitespaceVariant,
      droppedCharVariant,
      duplicatedCharVariant,
      replacedCharVariant,
      extraTextVariant,
      blankString,
      unrelatedString,
    ),
    whitespaceRun,
  )
  .map(([before, core, after]) => `${before}${core}${after}`);

describe('Property 1: The confirmation phrase gate opens only for the exact trimmed phrase', () => {
  it('opens for the exact phrase under any surrounding whitespace', () => {
    fc.assert(
      fc.property(whitespaceRun, whitespaceRun, (before, after) => {
        expect(matchesConfirmationPhrase(`${before}${PHRASE}${after}`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('stays shut for every string that is not the padded phrase', () => {
    fc.assert(
      fc.property(nonMatchingString, (value) => {
        expect(matchesConfirmationPhrase(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('stays shut for every non-string value', () => {
    fc.assert(
      fc.property(nonStringValue, (value) => {
        expect(matchesConfirmationPhrase(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
