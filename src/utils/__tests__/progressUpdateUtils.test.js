import { describe, it, expect } from 'vitest';
import {
  getProgressUpdateStatus,
  PROGRESS_UPDATE_STATUSES,
  PROGRESS_UPDATE_BADGES,
} from '../progressUpdateUtils';

describe('progressUpdateUtils', () => {
  it('defines correct status constants and badge configurations', () => {
    expect(PROGRESS_UPDATE_STATUSES.NEED_UPDATE).toBe('Need update progress');
    expect(PROGRESS_UPDATE_STATUSES.UPDATE_OFFER).toBe('Update Offer');
    expect(PROGRESS_UPDATE_STATUSES.UPDATE_SCHEDULED).toBe('Update Scheduled');
    expect(PROGRESS_UPDATE_BADGES['Need update progress']).toBeDefined();
    expect(PROGRESS_UPDATE_BADGES['Update Offer']).toBeDefined();
    expect(PROGRESS_UPDATE_BADGES['Update Scheduled']).toBeDefined();
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

    it('respects explicit manual status overrides', () => {
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
});
