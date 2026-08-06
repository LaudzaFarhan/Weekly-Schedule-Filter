import { describe, test, expect } from 'vitest';
import { buildWorkloadReport, normalizeDayName } from '../workloadUtils';

describe('workloadUtils', () => {
  test('normalizeDayName correctly normalizes short, lowercase, and Indonesian day names', () => {
    expect(normalizeDayName('Mon')).toBe('Monday');
    expect(normalizeDayName('wed')).toBe('Wednesday');
    expect(normalizeDayName('Rabu')).toBe('Wednesday');
    expect(normalizeDayName('Jumat')).toBe('Friday');
    expect(normalizeDayName('Sunday')).toBe('Sunday');
  });

  test('buildWorkloadReport handles un-normalized day names without throwing TypeError', () => {
    const mockClasses = [
      {
        teacher: 'Iqbal',
        day: 'Wed',
        time: '2.30-4.30pm',
        student: 'Aaron Sudjana',
        program: 'JF1',
        branchName: 'Puri Indah',
      },
      {
        teacher: 'Ziyah',
        day: 'Thu',
        time: '2.30-4.30pm',
        student: 'Adler Iskandar',
        program: 'KF1',
        branchName: 'Puri Indah',
      },
    ];

    expect(() => {
      const report = buildWorkloadReport(mockClasses);
      expect(report).toHaveLength(2);
      expect(report[0].teacher).toBe('Iqbal');
      expect(report[0].byDay['Wednesday'].sessions).toBe(1);
    }).not.toThrow();
  });
});
