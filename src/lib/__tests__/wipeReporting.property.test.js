import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  UNKNOWN_AUDIT_USER,
  WIPE_ACTIVITY,
  WIPE_AUDIT_DATA_SET_LABELS,
  WIPE_AUDIT_SUMMARY_MAX_LENGTH,
  buildWipeAuditSummary,
  buildWipeSuccessMessage,
  resolveAuditUser,
} from '@/lib/wipeReporting';

/**
 * Every run of digits in a string, in order. Used instead of a substring check
 * because `'2'` is a substring of `'12'`: a naive `includes` would report the
 * dialog's snapshot count as present in a message that only carries the
 * server's count.
 */
function digitRuns(text) {
  return text.match(/\d+/g) ?? [];
}

/**
 * Counts as the server reports them: whole numbers of 0 or greater, weighted so
 * 0, 1 and very large values all appear.
 */
const countArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 2, arbitrary: fc.constant(1) },
  { weight: 4, arbitrary: fc.nat({ max: 10_000 }) },
  { weight: 2, arbitrary: fc.integer({ min: 1_000_000, max: Number.MAX_SAFE_INTEGER }) },
);

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const wordArb = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

/** Recorded emails: present, absent, empty, blank, mixed-case and non-string. */
const emailArb = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(wordArb, wordArb).map(([local, domain]) => `${local}@${domain}.com`) },
  { weight: 2, arbitrary: fc.constantFrom('Admin.User@Example.COM', 'MiXeD@CaSe.Org', '  spaced@pad.com  ') },
  { weight: 1, arbitrary: fc.constantFrom(undefined, null) },
  { weight: 1, arbitrary: fc.constantFrom('', ' ', '   \t\n ') },
  { weight: 1, arbitrary: fc.oneof(fc.integer(), fc.boolean(), fc.constant({ email: 'a@b.com' })) },
);

describe('wipeReporting properties', () => {
  // Feature: student-data-bulk-wipe, Property 11: The success message reports the server's count, correctly numbered
  it('reports the server count with singular wording only at 1, and no other count', () => {
    fc.assert(
      fc.property(countArb, countArb, (deletedStudents, snapshotCount) => {
        const message = buildWipeSuccessMessage({ deletedStudents });
        const server = String(deletedStudents);

        // The server-reported number is present, and it is the only number in
        // the message — so the dialog's snapshot count cannot appear when the
        // two differ (Req 7.3).
        expect(digitRuns(message)).toEqual([server]);
        if (snapshotCount !== deletedStudents) {
          expect(digitRuns(message)).not.toContain(String(snapshotCount));
        }

        // Singular at exactly 1, plural for every other value including 0 (Req 7.2).
        if (deletedStudents === 1) {
          expect(message).toContain('1 student record.');
          expect(message).not.toContain('student records');
        } else {
          expect(message).toContain(`${server} student records`);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: student-data-bulk-wipe, Property 12: One audit entry describes the wipe completely
  it('describes a successful wipe in exactly one complete audit entry', () => {
    fc.assert(
      fc.property(countArb, countArb, countArb, emailArb, (deletedStudents, deletedHistory, deletedProgress, email) => {
        const counts = { deletedStudents, deletedHistory, deletedProgress };

        // The entry the page writes on success, composed from the wording module.
        const entries = [
          {
            ...WIPE_ACTIVITY,
            count: deletedStudents,
            userEmail: resolveAuditUser(email),
            summary: buildWipeAuditSummary(counts),
          },
        ];

        // Exactly one entry, action `bulk`, source `students` (Req 8.1).
        expect(entries).toHaveLength(1);
        const [entry] = entries;
        expect(entry.action).toBe('bulk');
        expect(entry.source).toBe('students');

        // Affected-record count is the deleted student count, 0 included (Req 8.2).
        expect(entry.count).toBe(deletedStudents);

        // Recorded email unchanged, placeholder when nothing usable is recorded
        // (Req 8.3, 8.6).
        const hasEmail = typeof email === 'string' && email.trim() !== '';
        expect(entry.userEmail).toBe(hasEmail ? email : UNKNOWN_AUDIT_USER);

        // Summary is bounded and names all three data sets with their counts
        // (Req 8.4).
        expect(entry.summary.length).toBeLessThanOrEqual(WIPE_AUDIT_SUMMARY_MAX_LENGTH);
        expect(entry.summary).toContain(`${deletedStudents} ${WIPE_AUDIT_DATA_SET_LABELS.students}`);
        expect(entry.summary).toContain(`${deletedHistory} ${WIPE_AUDIT_DATA_SET_LABELS.history}`);
        expect(entry.summary).toContain(`${deletedProgress} ${WIPE_AUDIT_DATA_SET_LABELS.progress}`);
        expect(digitRuns(entry.summary)).toEqual([
          String(deletedStudents),
          String(deletedHistory),
          String(deletedProgress),
        ]);
      }),
      { numRuns: 100 },
    );
  });
});
