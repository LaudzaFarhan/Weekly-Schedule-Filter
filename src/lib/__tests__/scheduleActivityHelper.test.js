import { describe, it, expect } from 'vitest';
import {
  computeScheduleDiff,
  formatScheduleActivitySummary,
  parseActivityChanges,
} from '../scheduleActivityHelper';

describe('scheduleActivityHelper', () => {
  describe('computeScheduleDiff', () => {
    it('detects changes in teacher, slot, day, program, and branch', () => {
      const prev = {
        teacher: 'Pak Alex',
        time: '4.00 - 5.30 pm',
        day: 'Wednesday',
        program: 'K1.1',
        branchName: 'Bintaro',
        classType: 'Regular',
        student: 'Adzra',
      };
      const next = {
        teacher: 'Bu Sarah',
        time: '4.30 - 6.00 pm',
        day: 'Thursday',
        program: 'K1.2',
        branchName: 'Puri Indah',
        classType: 'Trial',
        student: 'Adzra',
      };

      const diff = computeScheduleDiff(prev, next);
      expect(diff).toEqual([
        { field: 'Teacher', before: 'Pak Alex', after: 'Bu Sarah' },
        { field: 'Slot', before: '4.00 - 5.30 pm', after: '4.30 - 6.00 pm' },
        { field: 'Day', before: 'Wednesday', after: 'Thursday' },
        { field: 'Program', before: 'K1.1', after: 'K1.2' },
        { field: 'Branch', before: 'Bintaro', after: 'Puri Indah' },
        { field: 'Type', before: 'Regular', after: 'Trial' },
      ]);
    });

    it('returns empty array if no changes', () => {
      const state = {
        teacher: 'Pak Alex',
        time: '4.00 - 5.30 pm',
        day: 'Wednesday',
        program: 'K1.1',
        branchName: 'Bintaro',
      };
      expect(computeScheduleDiff(state, { ...state })).toEqual([]);
    });

    it('handles null or unassigned teacher gracefully', () => {
      const prev = { teacher: '' };
      const next = { teacher: 'Pak Alex' };
      expect(computeScheduleDiff(prev, next)).toEqual([
        { field: 'Teacher', before: 'Unassigned', after: 'Pak Alex' },
      ]);
    });
  });

  describe('formatScheduleActivitySummary', () => {
    it('formats edit summary with diff list', () => {
      const changes = [
        { field: 'Teacher', before: 'Pak Alex', after: 'Bu Sarah' },
        { field: 'Slot', before: '4.00 - 5.30 pm', after: '4.30 - 6.00 pm' },
      ];
      const summary = formatScheduleActivitySummary('edit', {
        student: 'Adzra Danish',
        program: 'K1.1',
        branchName: 'Bintaro',
        changes,
      });

      expect(summary).toBe(
        'Updated Adzra Danish (K1.1) — Teacher: Pak Alex → Bu Sarah, Slot: 4.00 - 5.30 pm → 4.30 - 6.00 pm @ Bintaro'
      );
    });

    it('formats add summary with teacher, slot, day, program, and branch', () => {
      const summary = formatScheduleActivitySummary('add', {
        student: 'Adzra Danish',
        program: 'K1.1',
        day: 'Thursday',
        time: '4.30 - 6.00 pm',
        teacher: 'Bu Sarah',
        branchName: 'Bintaro',
        classType: 'Regular',
      });

      expect(summary).toBe(
        'Added Adzra Danish — K1.1 (Regular) · Thursday 4.30 - 6.00 pm with Bu Sarah @ Bintaro'
      );
    });

    it('formats delete summary with class details', () => {
      const summary = formatScheduleActivitySummary('delete', {
        student: 'Adzra Danish',
        program: 'K1.1',
        day: 'Thursday',
        time: '4.30 - 6.00 pm',
        teacher: 'Bu Sarah',
        branchName: 'Bintaro',
      });

      expect(summary).toBe(
        'Deleted class for Adzra Danish — K1.1 · Thursday 4.30 - 6.00 pm · with Bu Sarah @ Bintaro'
      );
    });
  });

  describe('parseActivityChanges', () => {
    it('extracts changes from details object', () => {
      const entry = {
        summary: 'Updated Adzra — Teacher: Pak Alex → Bu Sarah',
        details: {
          changes: [
            { field: 'Teacher', before: 'Pak Alex', after: 'Bu Sarah' },
          ],
        },
      };
      const parsed = parseActivityChanges(entry);
      expect(parsed.hasChanges).toBe(true);
      expect(parsed.changes).toEqual([
        { field: 'Teacher', before: 'Pak Alex', after: 'Bu Sarah' },
      ]);
    });

    it('parses arrow transitions from text summary if details not present', () => {
      const entry = {
        summary: 'Moved class on Thursday at Bintaro: Time: 4.00 - 5.30 pm → 4.30 - 6.00 pm, Instructor: Pak Alex → Bu Sarah',
      };
      const parsed = parseActivityChanges(entry);
      expect(parsed.hasChanges).toBe(true);
      expect(parsed.changes).toEqual([
        { field: 'Slot', before: '4.00 - 5.30 pm', after: '4.30 - 6.00 pm' },
        { field: 'Teacher', before: 'Pak Alex', after: 'Bu Sarah' },
      ]);
    });
  });
});
