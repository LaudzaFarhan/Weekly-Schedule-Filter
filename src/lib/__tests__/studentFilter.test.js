import { describe, it, expect } from 'vitest';
import { STUDENT_LEVELS } from '../programRules';
import {
  FALLBACK_PROGRAM_CATEGORY,
  PROGRAM_CATEGORIES,
  filterStudents,
  matchesStudentFilter,
  partitionByProgramCategory,
  programCategoryOf,
  resolveProgramCategory,
} from '../studentFilter';

const students = [
  { id: 1, name: 'Zara Aziz',  level: 'Kinder Foundation', branchName: 'BSD',     status: 'Active',   parentName: 'Nadia',  contact: '0811', remarks: 'trial done' },
  { id: 2, name: 'Adam Rizky', level: 'Junior Core',       branchName: 'Bintaro', status: 'Inactive', parentName: 'Rizky',  contact: '0822', remarks: '' },
  { id: 3, name: 'Budi',       level: 'Coder Advance 2',   branchName: 'BSD',     status: 'Active',   parentName: 'Sari',   contact: '0833', remarks: null },
];

describe('matchesStudentFilter / filterStudents', () => {
  it('keeps every student when no criterion is supplied', () => {
    expect(filterStudents(students)).toEqual(students);
    expect(filterStudents(students, {})).toEqual(students);
  });

  it('returns a subset in the input order, holding the same objects', () => {
    const result = filterStudents(students, { branch: 'BSD' });
    expect(result).toEqual([students[0], students[2]]);
    expect(result[0]).toBe(students[0]);
  });

  it('matches the search case-insensitively across name, parent, contact and remarks', () => {
    expect(filterStudents(students, { search: 'ZARA' })).toEqual([students[0]]);
    expect(filterStudents(students, { search: 'rizky' })).toEqual([students[1]]);
    expect(filterStudents(students, { search: '0833' })).toEqual([students[2]]);
    // The Students_Page has always searched remarks too, so this module does as well.
    expect(filterStudents(students, { search: 'trial' })).toEqual([students[0]]);
    expect(filterStudents(students, { search: 'nobody' })).toEqual([]);
  });

  it('compares the level folded, so a numbered Coder record still matches its stage', () => {
    expect(matchesStudentFilter(students[2], { level: 'Coder Advance' })).toBe(true);
    expect(matchesStudentFilter(students[2], { level: 'Coder Basic' })).toBe(false);
  });

  it('compares branch and status by equality and combines criteria with AND', () => {
    expect(filterStudents(students, { branch: 'BSD', status: 'Active', search: 'budi' }))
      .toEqual([students[2]]);
    expect(filterStudents(students, { branch: 'BSD', status: 'Inactive' })).toEqual([]);
  });

  it('survives missing fields and a non-array input rather than throwing', () => {
    expect(matchesStudentFilter({ id: 9 }, { search: 'x' })).toBe(false);
    expect(matchesStudentFilter(null, {})).toBe(false);
    expect(filterStudents(undefined, { search: 'x' })).toEqual([]);
  });
});

describe('program category resolver', () => {
  it('resolves every student level to a category', () => {
    for (const level of STUDENT_LEVELS) {
      expect(PROGRAM_CATEGORIES).toContain(resolveProgramCategory(level));
    }
    expect(resolveProgramCategory('Kinder Core')).toBe('Kinder');
    expect(resolveProgramCategory('Junior Foundation')).toBe('Junior');
    expect(resolveProgramCategory('Coder Advance 3')).toBe('Coder');
  });

  it('resolves stored program codes as well as level names', () => {
    expect(resolveProgramCategory('KF1')).toBe('Kinder');
    expect(resolveProgramCategory('K2.3')).toBe('Kinder');
    expect(resolveProgramCategory('J1')).toBe('Junior');
  });

  it('reports an unknown level as unresolved but still files the student under a tab', () => {
    expect(resolveProgramCategory('Robotics 7')).toBeNull();
    expect(resolveProgramCategory('')).toBeNull();
    expect(programCategoryOf('Robotics 7')).toBe(FALLBACK_PROGRAM_CATEGORY);
    expect(programCategoryOf(undefined)).toBe(FALLBACK_PROGRAM_CATEGORY);
  });

  it('partitions a list into three disjoint tabs whose union is the input', () => {
    const buckets = partitionByProgramCategory([...students, { id: 4, name: 'Odd', level: 'Robotics' }]);
    const union = PROGRAM_CATEGORIES.flatMap((c) => buckets[c]);
    expect(union).toHaveLength(4);
    expect(new Set(union.map((s) => s.id)).size).toBe(4);
    expect(buckets.Junior.map((s) => s.id)).toEqual([2]);
    expect(buckets.Coder.map((s) => s.id)).toEqual([3]);
    expect(buckets.Kinder.map((s) => s.id)).toEqual([1, 4]);
  });
});
