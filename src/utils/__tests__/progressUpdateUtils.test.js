import { describe, it, expect } from 'vitest';
import {
  getProgressUpdateStatus,
  PROGRESS_UPDATE_STATUSES,
  PROGRESS_UPDATE_BADGES,
  suggestNextProgramCode,
  buildTermHistoryEntry,
} from '../progressUpdateUtils';

describe('progressUpdateUtils', () => {
  it('defines correct status constants and badge configurations', () => {
    expect(PROGRESS_UPDATE_STATUSES.NEED_UPDATE).toBe('Need update progress');
    expect(PROGRESS_UPDATE_STATUSES.UPDATE_OFFER).toBe('Update Offer');
    expect(PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED).toBe('Update Scheduled');
    expect(PROGRESS_UPDATE_STATUSES.WAIT_PAYMENT).toBe('Wait Payment');
    expect(PROGRESS_UPDATE_BADGES['Need update progress']).toBeDefined();
    expect(PROGRESS_UPDATE_BADGES['Update Offer']).toBeDefined();
    expect(PROGRESS_UPDATE_BADGES['Update Scheduled']).toBeDefined();
    expect(PROGRESS_UPDATE_BADGES['Wait Payment']).toBeDefined();
    expect(PROGRESS_UPDATE_BADGES['Wait Payment'].shortLabel).toBe('Wait Payment');
  });

  describe('getProgressUpdateStatus', () => {
    it('returns null for empty or missing student', () => {
      expect(getProgressUpdateStatus(null)).toBeNull();
      expect(getProgressUpdateStatus(undefined)).toBeNull();
    });

    it('auto-triggers Need update progress for Kinder at 7 meetings', () => {
      const student6 = { student: 'Alice', program: 'K1.6' };
      const student7 = { student: 'Bob', program: 'K1.7' };

      expect(getProgressUpdateStatus(student6)).toBeNull();
      expect(getProgressUpdateStatus(student7)).toBe(PROGRESS_UPDATE_STATUSES.NEED_UPDATE);
    });

    it('auto-triggers Need update progress for Junior at 7 meetings', () => {
      const student6 = { student: 'Charlie', program: 'J2.6' };
      const student7 = { student: 'David', program: 'J2.7' };

      expect(getProgressUpdateStatus(student6)).toBeNull();
      expect(getProgressUpdateStatus(student7)).toBe(PROGRESS_UPDATE_STATUSES.NEED_UPDATE);
    });

    it('auto-triggers Need update progress for Coder at 9 meetings', () => {
      const student8 = { student: 'Eve', program: 'Coder Basic', attendanceCount: 8 };
      const student9 = { student: 'Frank', program: 'Coder Basic', attendanceCount: 9 };

      expect(getProgressUpdateStatus(student8)).toBeNull();
      expect(getProgressUpdateStatus(student9)).toBe(PROGRESS_UPDATE_STATUSES.NEED_UPDATE);
    });

    it('uses liveProgress attendance map length if available', () => {
      const student = { student: 'Grace', program: 'Kinder Core' };
      const liveProgress7 = {
        attendance: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
      };
      expect(getProgressUpdateStatus(student, liveProgress7)).toBe(PROGRESS_UPDATE_STATUSES.NEED_UPDATE);
    });

    it('respects explicit manual status overrides including Wait Payment', () => {
      const student = {
        student: 'Hank',
        program: 'K1.2',
        progressUpdateStatus: 'Update Offer',
      };
      expect(getProgressUpdateStatus(student)).toBe('Update Offer');

      const studentScheduled = {
        student: 'Ivy',
        program: 'K1.2',
        progressUpdateStatus: 'Update Scheduled',
      };
      expect(getProgressUpdateStatus(studentScheduled)).toBe('Update Scheduled');

      const studentWaitPayment = {
        student: 'Mandy',
        program: 'K1.10',
        progressUpdateStatus: 'Wait Payment',
      };
      expect(getProgressUpdateStatus(studentWaitPayment)).toBe('Wait Payment');

      const studentRescheduled = {
        student: 'Kevin',
        program: 'K1.3',
        progressUpdateStatus: 'Update Reschedule',
      };
      expect(getProgressUpdateStatus(studentRescheduled)).toBe('Update Reschedule');

      const studentUpdateDone = {
        student: 'Laura',
        program: 'K1.7',
        progressUpdateStatus: 'Update Done',
      };
      expect(getProgressUpdateStatus(studentUpdateDone)).toBe('Update Done');

      const studentDone = {
        student: 'Jack',
        program: 'K1.7',
        progressUpdateStatus: 'Completed',
      };
      expect(getProgressUpdateStatus(studentDone)).toBeNull();
    });
  });

  describe('suggestNextProgramCode', () => {
    it('advances to next program level for Kinder and Junior', () => {
      expect(suggestNextProgramCode('K1.10', 'Kinder')).toBe('K2');
      expect(suggestNextProgramCode('K1', 'Kinder')).toBe('K2');
      expect(suggestNextProgramCode('KF1.10', 'Kinder')).toBe('KF2');
      expect(suggestNextProgramCode('J1.10', 'Junior')).toBe('J2');
      expect(suggestNextProgramCode('J2.10', 'Junior')).toBe('J3');
    });

    it('advances to next program level for Coder', () => {
      expect(suggestNextProgramCode('Coder Basic', 'Coder')).toBe('Coder Intermediate');
      expect(suggestNextProgramCode('Coder Intermediate', 'Coder')).toBe('Coder Advance');
    });

    it('graduates to next category after K4 and J4', () => {
      expect(suggestNextProgramCode('K4', 'Kinder')).toBe('J1');
      expect(suggestNextProgramCode('J4', 'Junior')).toBe('Coder Basic');
    });

    it('returns base code for final curriculum level or empty string', () => {
      expect(suggestNextProgramCode('Coder Advance', 'Coder')).toBe('Coder Advance');
      expect(suggestNextProgramCode('')).toBe('');
    });
  });

  describe('buildTermHistoryEntry', () => {
    it('creates an archived term snapshot object', () => {
      const attendance = { 1: { date: '2026-08-01' }, 2: { date: '2026-08-08' } };
      const entry = buildTermHistoryEntry({
        termName: 'Term 1',
        termNumber: 1,
        program: 'K1.10',
        category: 'Kinder',
        startDate: '2026-08-01',
        completedDate: '2026-09-02',
        attendedCount: 2,
        totalMeetings: 10,
        attendance,
        paymentType: 'Upfront Paid',
        spaNote: 'Paid advance for 2 terms',
        confirmedBy: 'Admin User',
      });

      expect(entry.id).toMatch(/^term_/);
      expect(entry.termName).toBe('Term 1');
      expect(entry.termNumber).toBe(1);
      expect(entry.program).toBe('K1.10');
      expect(entry.attendedCount).toBe(2);
      expect(entry.paymentType).toBe('Upfront Paid');
      expect(entry.spaNote).toBe('Paid advance for 2 terms');
      expect(entry.confirmedBy).toBe('Admin User');
      expect(entry.attendance).toEqual(attendance);
    });
  });
});
