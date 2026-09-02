import { describe, it, expect } from 'vitest';
import {
  parseStudentLeave,
  formatStudentLeaveRemark,
  clearStudentLeaveRemark,
  isMemberOnLeaveOnDate,
  formatDatePretty,
  formatDateShort
} from '../studentLeaveUtils';

describe('studentLeaveUtils', () => {
  describe('formatDatePretty and formatDateShort', () => {
    it('formats ISO date to human friendly string', () => {
      expect(formatDatePretty('2026-09-08')).toBe('8 Sep 2026');
      expect(formatDateShort('2026-09-08')).toBe('8 Sep');
    });

    it('handles edge cases and invalid formats', () => {
      expect(formatDatePretty('')).toBe('');
      expect(formatDatePretty('invalid')).toBe('invalid');
    });
  });

  describe('parseStudentLeave', () => {
    it('parses date range with reason', () => {
      const parsed = parseStudentLeave('[Izin: 2026-09-08 to 2026-09-22 | Family holiday]');
      expect(parsed.isIzin).toBe(true);
      expect(parsed.mode).toBe('range');
      expect(parsed.startDate).toBe('2026-09-08');
      expect(parsed.endDate).toBe('2026-09-22');
      expect(parsed.reason).toBe('Family holiday');
      expect(parsed.displayText).toBe('8 Sep 2026 – 22 Sep 2026');
      expect(parsed.shortText).toBe('8 Sep – 22 Sep');
      expect(parsed.isGeneric).toBe(false);
    });

    it('parses unbracketed date range', () => {
      const parsed = parseStudentLeave('Izin: 2026-09-08 - 2026-09-22');
      expect(parsed.isIzin).toBe(true);
      expect(parsed.startDate).toBe('2026-09-08');
      expect(parsed.endDate).toBe('2026-09-22');
    });

    it('parses single date with reason', () => {
      const parsed = parseStudentLeave('[Izin: 2026-09-08 | Sick]');
      expect(parsed.isIzin).toBe(true);
      expect(parsed.mode).toBe('single');
      expect(parsed.startDate).toBe('2026-09-08');
      expect(parsed.endDate).toBe('2026-09-08');
      expect(parsed.reason).toBe('Sick');
      expect(parsed.displayText).toBe('8 Sep 2026');
      expect(parsed.shortText).toBe('8 Sep');
    });

    it('parses generic Izin without date', () => {
      const parsed = parseStudentLeave('Izin');
      expect(parsed.isIzin).toBe(true);
      expect(parsed.mode).toBe('indefinite');
      expect(parsed.isGeneric).toBe(true);
      expect(parsed.startDate).toBeNull();
    });

    it('parses member object with isIzin: true', () => {
      const parsed = parseStudentLeave({ isIzin: true, remarks: '' });
      expect(parsed.isIzin).toBe(true);
      expect(parsed.isGeneric).toBe(true);
    });

    it('returns isIzin: false for normal remark', () => {
      const parsed = parseStudentLeave('Term 3 - L2');
      expect(parsed.isIzin).toBe(false);
    });
  });

  describe('formatStudentLeaveRemark and clearStudentLeaveRemark', () => {
    it('formats single date leave preserving existing remarks', () => {
      const existing = 'Term 3 - L2';
      const formatted = formatStudentLeaveRemark(
        { isIzin: true, mode: 'single', startDate: '2026-09-08', reason: 'Sick' },
        existing
      );
      expect(formatted).toBe('Term 3 - L2 [Izin: 2026-09-08 | Reason: Sick]');
    });

    it('formats date range leave', () => {
      const formatted = formatStudentLeaveRemark({
        isIzin: true,
        mode: 'range',
        startDate: '2026-09-08',
        endDate: '2026-09-22',
        reason: 'Trip'
      });
      expect(formatted).toBe('[Izin: 2026-09-08 to 2026-09-22 | Reason: Trip]');
    });

    it('clears leave remark while preserving other remark content', () => {
      const raw = 'Term 3 - L2 [Izin: 2026-09-08 to 2026-09-22 | Reason: Trip] [Zoho: 123]';
      const cleared = clearStudentLeaveRemark(raw);
      expect(cleared).toBe('Term 3 - L2 [Zoho: 123]');
    });

    it('clears plain Izin text', () => {
      expect(clearStudentLeaveRemark('Izin')).toBe('');
      expect(clearStudentLeaveRemark('Term 2 | Izin')).toBe('Term 2');
    });
  });

  describe('isMemberOnLeaveOnDate', () => {
    it('correctly evaluates date within range', () => {
      const member = { remarks: '[Izin: 2026-09-08 to 2026-09-22]' };
      expect(isMemberOnLeaveOnDate(member, '2026-09-07')).toBe(false);
      expect(isMemberOnLeaveOnDate(member, '2026-09-08')).toBe(true);
      expect(isMemberOnLeaveOnDate(member, '2026-09-15')).toBe(true);
      expect(isMemberOnLeaveOnDate(member, '2026-09-22')).toBe(true);
      expect(isMemberOnLeaveOnDate(member, '2026-09-23')).toBe(false);
    });

    it('evaluates generic leave as always on leave', () => {
      const member = { remarks: 'Izin' };
      expect(isMemberOnLeaveOnDate(member, '2026-09-07')).toBe(true);
      expect(isMemberOnLeaveOnDate(member, '2026-10-15')).toBe(true);
    });
  });
});
