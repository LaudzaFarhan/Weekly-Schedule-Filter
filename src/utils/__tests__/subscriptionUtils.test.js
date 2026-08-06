import { describe, it, expect } from 'vitest';
import {
  calculatePredictedEndDate,
  calculateSubscriptionStatus,
  parseProgressDetails,
  formatDateISO,
  DEFAULT_TARGET_MEETINGS,
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
});
