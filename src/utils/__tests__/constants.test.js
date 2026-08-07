import { describe, it, expect } from 'vitest';
import { isSameBranch, DEFAULT_BRANCH_LIST } from '../constants';
import { instructorsAtBranch } from '../../lib/instructorAvailability';

describe('isSameBranch', () => {
  it('matches exact and case-insensitive branch names', () => {
    expect(isSameBranch('Pondok Indah', 'pondok indah')).toBe(true);
    expect(isSameBranch('Pondok Indah ', 'Pondok Indah')).toBe(true);
    expect(isSameBranch('Gading Serpong', 'gading serpong')).toBe(true);
  });

  it('matches short branch codes to full branch names', () => {
    expect(isSameBranch('Pondok Indah', 'PI')).toBe(true);
    expect(isSameBranch('pi', 'Pondok Indah')).toBe(true);
    expect(isSameBranch('GS', 'Gading Serpong')).toBe(true);
    expect(isSameBranch('Puri', 'Puri Indah')).toBe(true);
  });

  it('returns false for different branches', () => {
    expect(isSameBranch('Pondok Indah', 'Bintaro')).toBe(false);
    expect(isSameBranch('PI', 'GS')).toBe(false);
  });
});

describe('instructorsAtBranch for Pondok Indah and imported classes', () => {
  const instructors = [
    { name: 'Teacher A', branches: ['Bekasi'] },
    { name: 'Teacher B', branches: ['Pondok Indah'] },
    { name: 'Teacher C', branches: ['All Branches'] },
  ];

  const classGroups = [
    { teacher: 'Teacher A', branchName: 'Pondok Indah', day: 'Monday' },
    { teacher: 'Teacher D', branchName: 'Pondok Indah', day: 'Tuesday' }, // Unregistered / newly imported teacher
  ];

  it('includes profile-matched teachers for Pondok Indah', () => {
    const list = instructorsAtBranch(instructors, 'Pondok Indah', classGroups);
    const names = list.map((i) => i.name);

    expect(names).toContain('Teacher B'); // Profile matched
    expect(names).toContain('Teacher C'); // All branches
    expect(names).not.toContain('Teacher A'); // Belongs to Puri Indah, excluded from Pondok Indah
  });

  it('matches branch codes such as PI', () => {
    const list = instructorsAtBranch(instructors, 'PI', classGroups);
    const names = list.map((i) => i.name);
    expect(names).toContain('Teacher B');
  });
});
