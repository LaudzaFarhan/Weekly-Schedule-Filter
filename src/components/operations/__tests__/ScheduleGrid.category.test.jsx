// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock('../../../services/firebase', () => ({
  auth: {},
  db: {},
  firebaseConfigured: false,
}));

import { categoryOfProgram } from '../ScheduleGrid';
import { getCategoryColorStyle } from '../../../lib/slotTypes';

describe('categoryOfProgram and getCategoryColorStyle', () => {
  it('correctly categorizes Coder classes with Foundation and Advance levels as Coder', () => {
    const cls = {
      programs: ['Foundation 2', 'Advance 1', 'Advance 2'],
      members: [
        { student: 'George Walensius', program: 'Foundation 2' },
        { student: 'Oliver Lesmana', program: 'Advance 1' },
        { student: 'Liam Elijah Leander', program: 'Advance 2' },
        { student: 'Kenzou Oliver Ang', program: 'Foundation 2' },
      ],
    };

    const category = categoryOfProgram(cls);
    expect(category).toBe('Coder');

    const style = getCategoryColorStyle(category);
    expect(style.bg).toBe('#0f172a');
    expect(style.border).toBe('#1e3a8a');
    expect(style.textColor).toBe('#ffffff');
    expect(style.isDark).toBe(true);
  });

  it('correctly categorizes single Foundation 2 program as Coder', () => {
    const cls = { programs: ['Foundation 2'] };
    expect(categoryOfProgram(cls)).toBe('Coder');
  });

  it('correctly categorizes Coder Basic and Advance combination as Coder', () => {
    const cls = { programs: ['Basic 1', 'Advance 1'] };
    expect(categoryOfProgram(cls)).toBe('Coder');

    const style = getCategoryColorStyle(categoryOfProgram(cls));
    expect(style.bg).toBe('#0f172a');
    expect(style.isDark).toBe(true);
  });

  it('preserves Kinder categorization for Kinder Foundation and Core', () => {
    expect(categoryOfProgram({ programs: ['KF1'] })).toBe('Kinder');
    expect(categoryOfProgram({ programs: ['KF2'] })).toBe('Kinder');
    expect(categoryOfProgram({ programs: ['Kinder Foundation'] })).toBe('Kinder');
    expect(categoryOfProgram({ programs: ['K1'] })).toBe('Kinder');

    const style = getCategoryColorStyle('Kinder');
    expect(style.bg).toBe('#fef08a');
  });

  it('preserves Junior categorization for Junior Foundation and Core', () => {
    expect(categoryOfProgram({ programs: ['JF1'] })).toBe('Junior');
    expect(categoryOfProgram({ programs: ['Junior Foundation'] })).toBe('Junior');
    expect(categoryOfProgram({ programs: ['J1'] })).toBe('Junior');

    const style = getCategoryColorStyle('Junior');
    expect(style.bg).toBe('#00FFFF');
  });

  it('falls back to members when programs array is empty', () => {
    const cls = {
      programs: [],
      members: [{ student: 'Kenzou', program: 'Foundation 2' }],
    };
    expect(categoryOfProgram(cls)).toBe('Coder');
  });
});
