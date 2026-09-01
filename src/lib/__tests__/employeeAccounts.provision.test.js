import { describe, it, expect } from 'vitest';
import {
  extractEmailFromRemarks,
  planInstructorAccounts,
  usernameFromName,
  uniqueUsername,
} from '../employeeAccounts';

describe('extractEmailFromRemarks', () => {
  it('extracts email from remarks string with prefix', () => {
    expect(extractEmailFromRemarks('Email: muhajir.thelab@gmail.com')).toBe('muhajir.thelab@gmail.com');
    expect(extractEmailFromRemarks('Contact: 08123456, Email: alberthenry.thelab@gmail.com (Fulltime)')).toBe('alberthenry.thelab@gmail.com');
  });

  it('returns empty string if no valid email is found', () => {
    expect(extractEmailFromRemarks('')).toBe('');
    expect(extractEmailFromRemarks(null)).toBe('');
    expect(extractEmailFromRemarks('Part-time instructor at Bintaro')).toBe('');
  });
});

describe('planInstructorAccounts with rich details and remarks email', () => {
  it('detects email from remarks and maps branches, contact, and level', () => {
    const instructors = [
      {
        id: 1,
        name: 'Ahmad Muhajir',
        contact: '89670902283',
        remarks: 'Email: muhajir.thelab@gmail.com',
        branches: ['Gading Serpong'],
        level: 'Kinder and Junior',
        status: 'Active',
      },
      {
        id: 2,
        name: 'Adit',
        contact: '0',
        remarks: '',
        branches: ['Bintaro'],
        level: 'Kinder and Junior',
        status: 'Active',
      },
    ];

    const accounts = [];

    const plan = planInstructorAccounts(instructors, accounts);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.create).toHaveLength(2);

    expect(plan.create[0]).toEqual({
      instructorId: 1,
      name: 'Ahmad Muhajir',
      username: 'ahmad.muhajir',
      email: 'muhajir.thelab@gmail.com',
      contact: '89670902283',
      location: 'Gading Serpong',
      branches: ['Gading Serpong'],
      level: 'Kinder and Junior',
    });

    expect(plan.create[1]).toEqual({
      instructorId: 2,
      name: 'Adit',
      username: 'adit',
      contact: '0',
      location: 'Bintaro',
      branches: ['Bintaro'],
      level: 'Kinder and Junior',
    });
  });

  it('skips instructors that already have an account linked', () => {
    const instructors = [
      { id: 1, name: 'Ahmad Muhajir', status: 'Active' },
    ];
    const accounts = [
      { instructorId: 1, username: 'ahmad.muhajir', email: 'muhajir.thelab@gmail.com' },
    ];

    const plan = planInstructorAccounts(instructors, accounts);
    expect(plan.create).toHaveLength(0);
  });
});
