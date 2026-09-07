import { describe, it, expect } from 'vitest';
import {
  calculatePredictedEndDate,
  calculateSubscriptionStatus,
  parseProgressDetails,
  formatDateISO,
  DEFAULT_TARGET_MEETINGS,
  calculateCoveredTerms,
  formatCoveredTermsSummary,
  inferStartingTerm,
} from '../subscriptionUtils';

describe('subscriptionUtils', () => {
  describe('calculatePredictedEndDate', () => {
    it('calculates predicted end date correctly with 12 meetings + 14 days buffer', () => {
      // Jan 1, 2026 + (12 * 7 = 84 days) + 14 days buffer = 98 days total
      // Jan 1 + 98 days -> April 9, 2026
      const start = '2026-01-01';
      const end = calculatePredictedEndDate(start, 12, 2);
      expect(formatDateISO(end)).toBe('2026-04-09');
    });

    it('returns null for missing or invalid dates', () => {
      expect(calculatePredictedEndDate('')).toBeNull();
      expect(calculatePredictedEndDate('invalid-date')).toBeNull();
    });
  });

  describe('calculateSubscriptionStatus', () => {
    it('returns Completed if attended meetings >= target meetings', () => {
      const res = calculateSubscriptionStatus({
        startDateStr: '2026-01-01',
        targetMeetings: 12,
        attendedCount: 12,
      });
      expect(res.status).toBe('Completed');
      expect(res.isOverdue).toBe(false);
    });

    it('returns Overdue if current date > predicted end date', () => {
      const start = '2026-01-01'; // Predicted end: April 9, 2026
      const currentDate = new Date('2026-05-01'); // Past April 9
      const res = calculateSubscriptionStatus({
        startDateStr: start,
        targetMeetings: 12,
        attendedCount: 5,
        currentDate,
      });
      expect(res.status).toBe('Overdue');
      expect(res.isOverdue).toBe(true);
    });

    it('returns Active if within predicted timeline with remaining meetings', () => {
      const start = '2026-01-01';
      const currentDate = new Date('2026-02-01'); // Early in subscription
      const res = calculateSubscriptionStatus({
        startDateStr: start,
        targetMeetings: 12,
        attendedCount: 4,
        currentDate,
      });
      expect(res.status).toBe('Active');
      expect(res.isOverdue).toBe(false);
    });
  });

  describe('parseProgressDetails', () => {
    it('extracts total attended count and earliest meeting date', () => {
      const record = {
        attendance: {
          1: { date: '2026-01-10', note: 'Lesson 1' },
          2: { date: '2026-01-03', note: 'Lesson 2' }, // Earliest
          3: { date: '2026-01-17', note: 'Lesson 3' },
        },
      };
      const { attendedCount, firstMeetingDate } = parseProgressDetails(record);
      expect(attendedCount).toBe(3);
      expect(firstMeetingDate).toBe('2026-01-03');
    });

    it('handles empty or missing progress records', () => {
      const { attendedCount, firstMeetingDate } = parseProgressDetails(null);
      expect(attendedCount).toBe(0);
      expect(firstMeetingDate).toBeNull();
    });
  });

  describe('calculateCoveredTerms', () => {
    it('calculates single term correctly', () => {
      const terms = calculateCoveredTerms(3, 2026, 1);
      expect(terms).toEqual([
        { termNumber: 3, year: 2026, label: 'T3 2026', fullLabel: 'Term 3 (2026)' },
      ]);
    });

    it('calculates 2 terms within same year (e.g. Term 3 & Term 4 2026)', () => {
      const terms = calculateCoveredTerms(3, 2026, 2);
      expect(terms).toEqual([
        { termNumber: 3, year: 2026, label: 'T3 2026', fullLabel: 'Term 3 (2026)' },
        { termNumber: 4, year: 2026, label: 'T4 2026', fullLabel: 'Term 4 (2026)' },
      ]);
    });

    it('rolls over to next year when spanning past Term 4', () => {
      const terms = calculateCoveredTerms(3, 2026, 3);
      expect(terms).toEqual([
        { termNumber: 3, year: 2026, label: 'T3 2026', fullLabel: 'Term 3 (2026)' },
        { termNumber: 4, year: 2026, label: 'T4 2026', fullLabel: 'Term 4 (2026)' },
        { termNumber: 1, year: 2027, label: 'T1 2027', fullLabel: 'Term 1 (2027)' },
      ]);
    });

    it('handles count 0 or invalid inputs safely', () => {
      expect(calculateCoveredTerms(1, 2026, 0)).toEqual([]);
    });
  });

  describe('formatCoveredTermsSummary', () => {
    it('formats single term', () => {
      expect(formatCoveredTermsSummary([{ termNumber: 3, year: 2026 }])).toBe('Term 3 (2026)');
    });

    it('formats two terms in same year', () => {
      expect(formatCoveredTermsSummary([
        { termNumber: 3, year: 2026 },
        { termNumber: 4, year: 2026 },
      ])).toBe('Term 3 & Term 4 (2026)');
    });

    it('formats terms across year boundary', () => {
      expect(formatCoveredTermsSummary([
        { termNumber: 3, year: 2026 },
        { termNumber: 4, year: 2026 },
        { termNumber: 1, year: 2027 },
      ])).toBe('Term 3 & Term 4 (2026), Term 1 (2027)');
    });
  });

  describe('inferStartingTerm', () => {
    it('infers next term after paid terms in internal_student_terms', () => {
      const existingTerms = [
        { termNumber: 1, year: 2026, paid: true },
        { termNumber: 2, year: 2026, paid: true },
      ];
      const res = inferStartingTerm({ existingTerms, defaultYear: 2026 });
      expect(res.termNumber).toBe(3);
      expect(res.year).toBe(2026);
    });

    it('rolls year forward if Term 4 was paid', () => {
      const existingTerms = [
        { termNumber: 4, year: 2026, paid: true },
      ];
      const res = inferStartingTerm({ existingTerms, defaultYear: 2026 });
      expect(res.termNumber).toBe(1);
      expect(res.year).toBe(2027);
    });

    it('infers from student level if no paid terms exist', () => {
      const res = inferStartingTerm({ student: { level: 'K3 (Kinder 3)' }, defaultYear: 2026 });
      expect(res.termNumber).toBe(3);
      expect(res.year).toBe(2026);
    });

    it('infers from liveProgress termHistory if present', () => {
      const liveProgress = { termHistory: [{ id: 1 }, { id: 2 }] };
      const res = inferStartingTerm({ liveProgress, defaultYear: 2026 });
      expect(res.termNumber).toBe(3);
      expect(res.year).toBe(2026);
    });
  });
});
