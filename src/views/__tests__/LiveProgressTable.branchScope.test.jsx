// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());
const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const subscribeToLiveProgress = vi.hoisted(() => vi.fn());
const saveLiveProgress = vi.hoisted(() => vi.fn(async () => ({})));
const showToast = vi.hoisted(() => vi.fn());

const mockUser = vi.hoisted(() => ({
  current: {
    role: 'Instructor',
    username: 'fikri',
    displayName: 'Kak Fikri',
    email: 'fikri@thelab.id',
    location: 'Kelapa Gading',
  },
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    enabledBranches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
    branches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
    rolePermissions: null,
    userPermissions: null,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

vi.mock('@/services/newActivityService', () => ({
  logActivity: vi.fn(async () => ({})),
  displayUser: (email) => (email ? email.split('@')[0] : 'Unknown'),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/services/internalScheduleService', () => ({
  subscribeToInternalClasses,
  updateInternalClass: vi.fn(async () => ({})),
  createInternalClass: vi.fn(async () => ({})),
  deleteInternalClass: vi.fn(async () => ({})),
}));

vi.mock('@/services/internalInstructorService', () => ({
  subscribeToInternalInstructors,
}));

vi.mock('@/services/internalStudentService', () => ({
  subscribeToInternalStudents,
  updateInternalStudent: vi.fn(async () => ({})),
}));

vi.mock('@/services/newLiveProgressService', () => ({
  subscribeToLiveProgress,
  saveLiveProgress,
}));

const { default: LiveProgressTable } = await import('@/views/LiveProgressTable');

describe('LiveProgressTable - Branch Restriction & Instructor Focus', () => {
  const sampleClasses = [
    {
      id: 'c-1',
      student: 'Alice Kelapa',
      teacher: 'Kak Fikri',
      branchName: 'Kelapa Gading',
      program: 'Kinder K1.1',
      day: 'Monday',
      time: '3:00 PM - 4:30 PM',
      classType: 'Regular',
    },
    {
      id: 'c-2',
      student: 'Bob Kelapa',
      teacher: 'Kak Ziyah',
      branchName: 'Kelapa Gading',
      program: 'Kinder K1.2',
      day: 'Tuesday',
      time: '3:00 PM - 4:30 PM',
      classType: 'Regular',
    },
    {
      id: 'c-3',
      student: 'Charlie Puri',
      teacher: 'Kak Sky',
      branchName: 'Puri Indah',
      program: 'Kinder K1.3',
      day: 'Wednesday',
      time: '3:00 PM - 4:30 PM',
      classType: 'Regular',
    },
  ];

  const sampleInstructors = [
    { id: 'inst-1', name: 'Kak Fikri', email: 'fikri@thelab.id', branches: ['Kelapa Gading'] },
    { id: 'inst-2', name: 'Kak Ziyah', email: 'ziyah@thelab.id', branches: ['Kelapa Gading'] },
    { id: 'inst-3', name: 'Kak Sky', email: 'sky@thelab.id', branches: ['Puri Indah'] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb(sampleClasses);
      return () => {};
    });
    subscribeToInternalInstructors.mockImplementation((cb) => {
      cb(sampleInstructors);
      return () => {};
    });
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 's-1', name: 'Alice Kelapa', branchName: 'Kelapa Gading', level: 'Kinder K1' },
        { id: 's-2', name: 'Bob Kelapa', branchName: 'Kelapa Gading', level: 'Kinder K1' },
        { id: 's-3', name: 'Charlie Puri', branchName: 'Puri Indah', level: 'Kinder K1' },
      ]);
      return () => {};
    });
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });
  });

  it('restricts Instructor to their assigned branch (Kelapa Gading)', () => {
    mockUser.current = {
      role: 'Instructor',
      username: 'fikri',
      displayName: 'Kak Fikri',
      email: 'fikri@thelab.id',
      location: 'Kelapa Gading',
    };

    render(<LiveProgressTable category="Kinder" />);

    // Should display the branch scoped badge
    expect(screen.getByText(/Branch:/i)).toBeInTheDocument();
    expect(screen.getAllByText('Kelapa Gading').length).toBeGreaterThan(0);

    // Should see Alice Kelapa and Bob Kelapa (both Kelapa Gading)
    expect(screen.getByText('Alice Kelapa')).toBeInTheDocument();
    expect(screen.getByText('Bob Kelapa')).toBeInTheDocument();

    // Should NOT see Charlie Puri (Puri Indah)
    expect(screen.queryByText('Charlie Puri')).not.toBeInTheDocument();
  });

  it('provides a Focus Me button to filter to instructors own classes', () => {
    mockUser.current = {
      role: 'Instructor',
      username: 'fikri',
      displayName: 'Kak Fikri',
      email: 'fikri@thelab.id',
      location: 'Kelapa Gading',
    };

    render(<LiveProgressTable category="Kinder" />);

    const focusBtn = screen.getByRole('button', { name: /Focus Me/i });
    expect(focusBtn).toBeInTheDocument();

    // Click Focus Me
    fireEvent.click(focusBtn);

    // Now it should filter to Kak Fikri's classes only (Alice Kelapa)
    expect(screen.getByText('Alice Kelapa')).toBeInTheDocument();
    expect(screen.queryByText('Bob Kelapa')).not.toBeInTheDocument();

    // The button now says Show All
    const showAllBtn = screen.getByRole('button', { name: /Show All/i });
    expect(showAllBtn).toBeInTheDocument();

    // Click Show All -> resets back to all branch instructors
    fireEvent.click(showAllBtn);
    expect(screen.getByText('Alice Kelapa')).toBeInTheDocument();
    expect(screen.getByText('Bob Kelapa')).toBeInTheDocument();
  });

  it('allows Admin to see all branches without restriction', () => {
    mockUser.current = {
      role: 'Admin',
      username: 'admin',
      email: 'admin@thelab.id',
    };

    render(<LiveProgressTable category="Kinder" />);

    // Admin should see both Kelapa Gading and Puri Indah students
    expect(screen.getByText('Alice Kelapa')).toBeInTheDocument();
    expect(screen.getByText('Bob Kelapa')).toBeInTheDocument();
    expect(screen.getByText('Charlie Puri')).toBeInTheDocument();

    // Admin should have "All Branches" option available
    expect(screen.getByRole('option', { name: 'All Branches' })).toBeInTheDocument();
  });
});
