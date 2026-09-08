// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const authState = vi.hoisted(() => ({ user: null }));

vi.mock('../../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: authState.user, loading: false, login: () => {}, logout: () => {} }),
}));

vi.mock('../../../services/firebase', () => ({
  auth: {},
  db: {},
  firebaseConfigured: false,
}));

import ScheduleGrid, {
  getDistinctClassLessons,
  isMultiLessonWarning,
  categoryOfProgram,
  getMaxCapacityForClass,
  getClassCapacityStatus,
} from '../ScheduleGrid';

describe('ScheduleGrid Multi-Lesson Logic (> 2 different lessons)', () => {
  describe('getDistinctClassLessons', () => {
    it('returns empty array when cls is null or empty', () => {
      expect(getDistinctClassLessons(null)).toEqual([]);
      expect(getDistinctClassLessons({})).toEqual([]);
    });

    it('returns single lesson when all enrolled members share the same program', () => {
      const cls = {
        programs: ['J1'],
        members: [
          { student: 'Alice', program: 'J1' },
          { student: 'Bob', program: 'J1' },
        ],
      };
      const result = getDistinctClassLessons(cls);
      expect(result).toEqual(['J1']);
    });

    it('returns 2 lessons when 2 different programs/lessons are present', () => {
      const cls = {
        programs: ['J1', 'J2'],
        members: [
          { student: 'Alice', program: 'J1' },
          { student: 'Bob', program: 'J2' },
        ],
      };
      const result = getDistinctClassLessons(cls);
      expect(result.sort()).toEqual(['J1', 'J2']);
    });

    it('returns 3 lessons when 3 different programs are present', () => {
      const cls = {
        programs: ['J1', 'J2', 'J3'],
        members: [
          { student: 'Alice', program: 'J1' },
          { student: 'Bob', program: 'J2' },
          { student: 'Charlie', program: 'J3' },
        ],
      };
      const result = getDistinctClassLessons(cls);
      expect(result.sort()).toEqual(['J1', 'J2', 'J3']);
    });

    it('returns 4 lessons for the exact case from the screenshot (J2, J3, JF1, J1)', () => {
      const cls = {
        programs: ['J2', 'J3', 'JF1', 'J1'],
        members: [
          { student: 'Bradley Ryland Handoko', program: 'J2' },
          { student: 'Nathaniel Sutanto', program: 'J3' },
          { student: 'Matteo Harrison Roosevelt', program: 'JF1' },
          { student: 'Kayden Tanny', program: 'J1' },
        ],
      };
      const result = getDistinctClassLessons(cls);
      expect(result.sort()).toEqual(['J1', 'J2', 'J3', 'JF1']);
    });

    it('distinguishes dotted lesson numbers (e.g. KF1.1 vs KF1.2)', () => {
      const cls = {
        programs: ['KF1.1', 'KF1.2', 'KF1.3'],
        members: [
          { student: 'Student 1', program: 'KF1.1' },
          { student: 'Student 2', program: 'KF1.2' },
          { student: 'Student 3', program: 'KF1.3' },
        ],
      };
      const result = getDistinctClassLessons(cls);
      expect(result.sort()).toEqual(['KF1.1', 'KF1.2', 'KF1.3']);
    });

    it('incorporates arranged lesson from liveProgressMap if present', () => {
      const liveProgressMap = new Map();
      liveProgressMap.set('alice', { studentName: 'Alice', programCode: 'J2', arrangedLesson: '3' });
      liveProgressMap.set('bob', { studentName: 'Bob', programCode: 'J2', arrangedLesson: '5' });

      const cls = {
        programs: ['J2'],
        members: [
          { student: 'Alice', program: 'J2' },
          { student: 'Bob', program: 'J2' },
        ],
      };

      const result = getDistinctClassLessons(cls, liveProgressMap);
      expect(result.sort()).toEqual(['J2.3', 'J2.5']);
    });

    it('falls back to cls.programs when members are empty', () => {
      const cls = {
        programs: ['J1', 'J2', 'J3'],
        members: [],
      };
      const result = getDistinctClassLessons(cls);
      expect(result.sort()).toEqual(['J1', 'J2', 'J3']);
    });
  });

  describe('isMultiLessonWarning', () => {
    it('returns false when distinct lessons <= 2', () => {
      const cls = { programs: ['J1'] };
      expect(isMultiLessonWarning(cls, ['J1'])).toBe(false);
      expect(isMultiLessonWarning(cls, ['J1', 'J2'])).toBe(false);
    });

    it('returns true when distinct lessons > 2 in Junior category', () => {
      const cls = { programs: ['J1', 'J2', 'J3'] };
      expect(isMultiLessonWarning(cls, ['J1', 'J2', 'J3'])).toBe(true);
      expect(isMultiLessonWarning(cls, ['J2', 'J3', 'JF1', 'J1'])).toBe(true);
    });

    it('returns true when distinct lessons > 2 in Junior foundation programs (JF1, JF2)', () => {
      const cls = { programs: ['JF1', 'JF2', 'J1'] };
      expect(isMultiLessonWarning(cls, ['JF1', 'JF2', 'J1'])).toBe(true);
    });

    it('returns true when distinct lessons > 2 in Kinder category (including foundation KF1, KF2)', () => {
      const clsKF = { programs: ['KF1', 'KF2', 'K1'] };
      expect(isMultiLessonWarning(clsKF, ['KF1', 'KF2', 'K1'])).toBe(true);

      const clsK = { programs: ['KF1.1', 'KF1.2', 'KF1.3'] };
      expect(isMultiLessonWarning(clsK, ['KF1.1', 'KF1.2', 'KF1.3'])).toBe(true);
    });

    it('returns false for Coder classes even if they have > 2 different lessons', () => {
      const clsCoder = { programs: ['Coder Basic', 'Coder Intermediate', 'Coder Advance'] };
      expect(isMultiLessonWarning(clsCoder, ['Coder Basic', 'Coder Intermediate', 'Coder Advance'])).toBe(false);

      const clsPython = { programs: ['Python 1', 'Python 2', 'Python 3'] };
      expect(isMultiLessonWarning(clsPython, ['Python 1', 'Python 2', 'Python 3'])).toBe(false);
    });
  });

  describe('categoryOfProgram', () => {
    it('identifies Kinder, Junior, and Coder correctly', () => {
      expect(categoryOfProgram({ programs: ['KF1'] })).toBe('Kinder');
      expect(categoryOfProgram({ programs: ['KF2'] })).toBe('Kinder');
      expect(categoryOfProgram({ programs: ['K2'] })).toBe('Kinder');
      expect(categoryOfProgram({ programs: ['JF1'] })).toBe('Junior');
      expect(categoryOfProgram({ programs: ['JF2'] })).toBe('Junior');
      expect(categoryOfProgram({ programs: ['J3'] })).toBe('Junior');
      expect(categoryOfProgram({ programs: ['Coder Basic'] })).toBe('Coder');
      expect(categoryOfProgram({ programs: ['Python 1'] })).toBe('Coder');
    });
  });
});

describe('Class Capacity Rules (Kinder max 4, Junior max 6, Coder max 6)', () => {
  describe('getMaxCapacityForClass', () => {
    it('returns 4 for Kinder programs and foundation levels (KF1, KF2, K1, K2)', () => {
      expect(getMaxCapacityForClass({ programs: ['KF1'] })).toBe(4);
      expect(getMaxCapacityForClass({ programs: ['KF2'] })).toBe(4);
      expect(getMaxCapacityForClass({ programs: ['K1'] })).toBe(4);
      expect(getMaxCapacityForClass({ category: 'Kinder' })).toBe(4);
    });

    it('returns 6 for Junior programs and foundation levels (JF1, JF2, J1, J2, J3)', () => {
      expect(getMaxCapacityForClass({ programs: ['JF1'] })).toBe(6);
      expect(getMaxCapacityForClass({ programs: ['JF2'] })).toBe(6);
      expect(getMaxCapacityForClass({ programs: ['J1'] })).toBe(6);
      expect(getMaxCapacityForClass({ programs: ['J3'] })).toBe(6);
      expect(getMaxCapacityForClass({ category: 'Junior' })).toBe(6);
    });

    it('returns 6 for Coder programs', () => {
      expect(getMaxCapacityForClass({ programs: ['Coder Basic'] })).toBe(6);
      expect(getMaxCapacityForClass({ programs: ['Coder Advance'] })).toBe(6);
      expect(getMaxCapacityForClass({ programs: ['Python'] })).toBe(6);
      expect(getMaxCapacityForClass({ category: 'Coder' })).toBe(6);
    });
  });

  describe('getClassCapacityStatus', () => {
    it('evaluates Kinder capacity correctly (open < 4, full = 4, over > 4)', () => {
      const cls = { category: 'Kinder', programs: ['KF1'] };
      
      const openStatus = getClassCapacityStatus(cls, { total: 3 });
      expect(openStatus.status).toBe('open');
      expect(openStatus.isOver).toBe(false);
      expect(openStatus.isFull).toBe(false);
      expect(openStatus.count).toBe(3);
      expect(openStatus.max).toBe(4);
      expect(openStatus.badgeText).toBe('3/4 Pax');

      const fullStatus = getClassCapacityStatus(cls, { total: 4 });
      expect(fullStatus.status).toBe('full');
      expect(fullStatus.isOver).toBe(false);
      expect(fullStatus.isFull).toBe(true);
      expect(fullStatus.badgeText).toBe('4/4 Full');

      const overStatus = getClassCapacityStatus(cls, { total: 5 });
      expect(overStatus.status).toBe('over');
      expect(overStatus.isOver).toBe(true);
      expect(overStatus.isFull).toBe(true);
      expect(overStatus.badgeText).toBe('5/4 Over');
      expect(overStatus.message).toContain('Over capacity: 5/4 students');
    });

    it('evaluates Junior capacity correctly (open < 6, full = 6, over > 6)', () => {
      const cls = { category: 'Junior', programs: ['J1'] };

      const openStatus = getClassCapacityStatus(cls, { total: 5 });
      expect(openStatus.status).toBe('open');
      expect(openStatus.isOver).toBe(false);
      expect(openStatus.isFull).toBe(false);
      expect(openStatus.max).toBe(6);

      const fullStatus = getClassCapacityStatus(cls, { total: 6 });
      expect(fullStatus.status).toBe('full');
      expect(fullStatus.isOver).toBe(false);
      expect(fullStatus.isFull).toBe(true);
      expect(fullStatus.badgeText).toBe('6/6 Full');

      const overStatus = getClassCapacityStatus(cls, { total: 7 });
      expect(overStatus.status).toBe('over');
      expect(overStatus.isOver).toBe(true);
      expect(overStatus.badgeText).toBe('7/6 Over');
    });

    it('evaluates Coder capacity correctly (open < 6, full = 6, over > 6)', () => {
      const cls = { category: 'Coder', programs: ['Coder Basic'] };

      const openStatus = getClassCapacityStatus(cls, { total: 4 });
      expect(openStatus.status).toBe('open');
      expect(openStatus.badgeText).toBe('4/6 Pax');

      const fullStatus = getClassCapacityStatus(cls, { total: 6 });
      expect(fullStatus.status).toBe('full');
      expect(fullStatus.badgeText).toBe('6/6 Full');

      const overStatus = getClassCapacityStatus(cls, { total: 8 });
      expect(overStatus.status).toBe('over');
      expect(overStatus.isOver).toBe(true);
      expect(overStatus.badgeText).toBe('8/6 Over');
    });
  });
});

describe('ScheduleGrid UI Integration (Multi-Lesson & Capacity Notifications)', () => {
  const mockBranches = [{ id: 'puri-indah', name: 'Puri Indah' }];
  const mockInstructors = [
    { id: 101, name: 'Vania', branches: ['Puri Indah'], level: 'Junior' },
    { id: 102, name: 'Budi', branches: ['Puri Indah'], level: 'Kinder' },
    { id: 103, name: 'Alex', branches: ['Puri Indah'], level: 'Coder' },
  ];

  const multiLessonJuniorClass = {
    id: 1,
    key: 'puri-indah||Monday||16:30 - 18:30||Vania',
    day: 'Monday',
    time: '16:30 - 18:30',
    startMin: 990,
    endMin: 1110,
    teacher: 'Vania',
    branchName: 'Puri Indah',
    category: 'Junior',
    programs: ['J2', 'J3', 'JF1', 'J1'],
    students: ['Bradley Ryland Handoko', 'Nathaniel Sutanto', 'Matteo Harrison Roosevelt', 'Kayden Tanny'],
    members: [
      { id: '1__0', student: 'Bradley Ryland Handoko', program: 'J2' },
      { id: '1__1', student: 'Nathaniel Sutanto', program: 'J3' },
      { id: '1__2', student: 'Matteo Harrison Roosevelt', program: 'JF1' },
      { id: '1__3', student: 'Kayden Tanny', program: 'J1' },
    ],
  };

  const overCapacityKinderClass = {
    id: 2,
    key: 'puri-indah||Monday||14:00 - 15:30||Budi',
    day: 'Monday',
    time: '14:00 - 15:30',
    startMin: 840,
    endMin: 930,
    teacher: 'Budi',
    branchName: 'Puri Indah',
    category: 'Kinder',
    programs: ['KF1'],
    students: ['Student 1', 'Student 2', 'Student 3', 'Student 4', 'Student 5'],
    members: [
      { id: '2__0', student: 'Student 1', program: 'KF1' },
      { id: '2__1', student: 'Student 2', program: 'KF1' },
      { id: '2__2', student: 'Student 3', program: 'KF1' },
      { id: '2__3', student: 'Student 4', program: 'KF1' },
      { id: '2__4', student: 'Student 5', program: 'KF1' },
    ],
  };

  const multiLessonCoderClass = {
    id: 3,
    key: 'puri-indah||Monday||14:00 - 16:00||Alex',
    day: 'Monday',
    time: '14:00 - 16:00',
    startMin: 840,
    endMin: 960,
    teacher: 'Alex',
    branchName: 'Puri Indah',
    category: 'Coder',
    programs: ['Coder Basic', 'Coder Intermediate', 'Coder Advance'],
    students: ['Coder 1', 'Coder 2', 'Coder 3', 'Coder 4', 'Coder 5', 'Coder 6', 'Coder 7'],
    members: [
      { id: '3__0', student: 'Coder 1', program: 'Coder Basic' },
      { id: '3__1', student: 'Coder 2', program: 'Coder Intermediate' },
      { id: '3__2', student: 'Coder 3', program: 'Coder Advance' },
      { id: '3__3', student: 'Coder 4', program: 'Coder Basic' },
      { id: '3__4', student: 'Coder 5', program: 'Coder Intermediate' },
      { id: '3__5', student: 'Coder 6', program: 'Coder Advance' },
      { id: '3__6', student: 'Coder 7', program: 'Coder Basic' },
    ],
  };

  it('renders multi-lesson alert badge on Junior class card and preview drawer', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[multiLessonJuniorClass]}
        leaves={[]}
        liveProgress={[]}
        draft={{ branchId: 'puri-indah', day: 'Monday' }}
      />
    );

    // 1. Day Notice Banner
    const dayNotice = screen.getByTestId('schedule-grid-multi-lesson-day-notice');
    expect(dayNotice).toBeInTheDocument();
    expect(dayNotice).toHaveTextContent(/Multi-Lesson Notice:/i);
    expect(dayNotice).toHaveTextContent(/Vania/i);

    // 2. Multi-lesson badge on class card
    const cardBadge = screen.getByTestId('multi-lesson-badge');
    expect(cardBadge).toBeInTheDocument();
    expect(cardBadge).toHaveTextContent(/4 Les/i);

    // 3. Click card to open preview drawer
    const classCard = cardBadge.closest('.schedule-class-card');
    fireEvent.click(classCard);

    // Preview badge and alert
    const previewBadge = screen.getByTestId('preview-multi-lesson-badge');
    expect(previewBadge).toBeInTheDocument();
    expect(previewBadge).toHaveTextContent(/4 Lessons/i);

    const previewAlert = screen.getByTestId('preview-multi-lesson-alert');
    expect(previewAlert).toBeInTheDocument();
    expect(previewAlert).toHaveTextContent(/Multiple Lessons Alert/i);
    expect(previewAlert).toHaveTextContent(/4 different lessons/i);
  });

  it('renders over-capacity badge (5/4 Over) and alert for Kinder class exceeding 4 students', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[overCapacityKinderClass]}
        leaves={[]}
        liveProgress={[]}
        draft={{ branchId: 'puri-indah', day: 'Monday' }}
      />
    );

    // 1. Day Notice Banner shows Capacity Alert
    const dayNotice = screen.getByTestId('schedule-grid-multi-lesson-day-notice');
    expect(dayNotice).toBeInTheDocument();
    expect(dayNotice).toHaveTextContent(/Capacity Alert:/i);
    expect(dayNotice).toHaveTextContent(/Budi/i);
    expect(dayNotice).toHaveTextContent(/5\/4 Over/i);

    // 2. Class card shows capacity-over-badge
    const capBadge = screen.getByTestId('capacity-over-badge');
    expect(capBadge).toBeInTheDocument();
    expect(capBadge).toHaveTextContent('5/4 Over');

    // 3. Click card to preview
    const classCard = capBadge.closest('.schedule-class-card');
    fireEvent.click(classCard);

    // Header badge
    const previewCapBadge = screen.getByTestId('preview-capacity-over-badge');
    expect(previewCapBadge).toBeInTheDocument();
    expect(previewCapBadge).toHaveTextContent(/Over Capacity \(5\/4\)/i);

    // Drawer body alert
    const previewCapAlert = screen.getByTestId('preview-capacity-alert');
    expect(previewCapAlert).toBeInTheDocument();
    expect(previewCapAlert).toHaveTextContent(/Capacity Limit Exceeded/i);
    expect(previewCapAlert).toHaveTextContent(/exceeding the maximum limit of 4 students/i);
    expect(previewCapAlert).toHaveTextContent(/Kinder max: 4/i);
  });

  it('Coder class does NOT show multi-lesson warning, but DOES alert when exceeding 6 students capacity', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[multiLessonCoderClass]}
        leaves={[]}
        liveProgress={[]}
        draft={{ branchId: 'puri-indah', day: 'Monday' }}
      />
    );

    // Coder has 3 different programs, but Coder should NEVER have multi-lesson warning
    expect(screen.queryByTestId('multi-lesson-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/Multi-Lesson Notice:/i)).not.toBeInTheDocument();

    // But Coder has 7 students (max is 6), so it DOES trigger capacity alert!
    const capBadge = screen.getByTestId('capacity-over-badge');
    expect(capBadge).toBeInTheDocument();
    expect(capBadge).toHaveTextContent('7/6 Over');

    const dayNotice = screen.getByTestId('schedule-grid-multi-lesson-day-notice');
    expect(dayNotice).toBeInTheDocument();
    expect(dayNotice).toHaveTextContent(/Capacity Alert:/i);
    expect(dayNotice).toHaveTextContent(/Alex/i);

    // Click to preview
    const classCard = capBadge.closest('.schedule-class-card');
    fireEvent.click(classCard);

    // No multi-lesson badge in preview
    expect(screen.queryByTestId('preview-multi-lesson-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-multi-lesson-alert')).not.toBeInTheDocument();

    // Capacity alert in preview
    const previewCapBadge = screen.getByTestId('preview-capacity-over-badge');
    expect(previewCapBadge).toBeInTheDocument();
    expect(previewCapBadge).toHaveTextContent(/Over Capacity \(7\/6\)/i);

    const previewCapAlert = screen.getByTestId('preview-capacity-alert');
    expect(previewCapAlert).toBeInTheDocument();
    expect(previewCapAlert).toHaveTextContent(/Coder max: 6/i);
  });
});

