import { describe, test, expect } from 'vitest';
import { classBelongsToBranch } from '../constants';
import { buildWorkloadReport } from '../workloadUtils';

describe('Workload Branch Filtering & Official Student Registry Deduplication', () => {
  const mockClasses = [
    {
      teacher: 'Supandi',
      day: 'Monday',
      time: '10:30 am - 12:30 pm',
      student: 'Puri Student A',
      program: 'JF1',
      branchName: 'Puri Indah',
    },
    {
      teacher: 'Supandi',
      day: 'Monday',
      time: '1:00 pm - 3:00 pm',
      student: 'Puri Student A',
      program: 'JF1',
      branchName: 'Bekasi', // Duplicate/misattributed row under Bekasi
    },
    {
      teacher: 'Supandi',
      day: 'Monday',
      time: '3:30 pm - 5:30 pm',
      student: 'Bekasi Student B',
      program: 'KF1',
      branchName: 'Bekasi',
    },
  ];

  const studentBranchMap = new Map([
    ['puri student a', 'Puri Indah'],
    ['bekasi student b', 'Bekasi'],
  ]);

  test('filters out misattributed Puri student from Bekasi workload', () => {
    const branchFilter = 'Bekasi';

    const bekasiClasses = mockClasses.filter((c) => {
      if (!classBelongsToBranch(c, branchFilter)) return false;
      if (c.student && studentBranchMap.size > 0) {
        const names = String(c.student).split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
        for (const name of names) {
          const official = studentBranchMap.get(name);
          if (official && official.toLowerCase() !== branchFilter.toLowerCase()) {
            return false;
          }
        }
      }
      return true;
    });

    // Should only keep Bekasi Student B class (3:30 pm - 5:30 pm), excluding Puri Student A duplicate
    expect(bekasiClasses).toHaveLength(1);
    expect(bekasiClasses[0].student).toBe('Bekasi Student B');

    const report = buildWorkloadReport(bekasiClasses);
    expect(report).toHaveLength(1);
    expect(report[0].teacher).toBe('Supandi');
    expect(report[0].weekly.hours).toBe(2); // 2 hours instead of 4 hours
    expect(report[0].weekly.students).toBe(1);
  });

  test('keeps Puri student in Puri Indah workload', () => {
    const branchFilter = 'Puri Indah';

    const puriClasses = mockClasses.filter((c) => {
      if (!classBelongsToBranch(c, branchFilter)) return false;
      if (c.student && studentBranchMap.size > 0) {
        const names = String(c.student).split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
        for (const name of names) {
          const official = studentBranchMap.get(name);
          if (official && official.toLowerCase() !== branchFilter.toLowerCase()) {
            return false;
          }
        }
      }
      return true;
    });

    expect(puriClasses).toHaveLength(1);
    expect(puriClasses[0].student).toBe('Puri Student A');
    expect(puriClasses[0].branchName).toBe('Puri Indah');

    const report = buildWorkloadReport(puriClasses);
    expect(report).toHaveLength(1);
    expect(report[0].teacher).toBe('Supandi');
    expect(report[0].weekly.hours).toBe(2);
  });
});
