// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import NewLeavePage from '../NewLeavePage';

const subscribeToLeaves = vi.hoisted(() => vi.fn());
const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());

let mockUser = { email: 'admin@thelab.com', role: 'Admin' };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    branches: [{ id: 'b1', name: 'Puri Indah' }],
    enabledBranches: [{ id: 'b1', name: 'Puri Indah' }],
    users: {
      'admin@thelab.com': 'Admin',
      'spa@thelab.com': 'SPA',
      'inst@thelab.com': 'Instructor',
      'supervisor@thelab.com': 'Supervisor',
    },
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('@/services/newLeaveService', () => ({
  subscribeToLeaves,
  createLeave: vi.fn(),
  deleteLeave: vi.fn(),
  updateLeave: vi.fn(),
}));

vi.mock('@/services/internalScheduleService', () => ({
  subscribeToInternalClasses,
}));

vi.mock('@/services/internalInstructorService', () => ({
  subscribeToInternalInstructors,
}));

vi.mock('@/hooks/useNewOperationals', () => ({
  useNewOperationals: () => ({
    openDaysFor: () => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  }),
}));

describe('NewLeavePage Role-Based Access Control (RBAC)', () => {
  const mockInstructors = [
    {
      id: 'inst-1',
      name: 'Felix Tio',
      level: 'Junior and Coder',
      branches: ['Puri Indah'],
      status: 'Active',
    },
  ];

  const mockLeaves = [
    {
      id: 'leave-1',
      name: 'Felix Tio',
      startDate: '2026-08-28',
      endDate: '2026-08-29',
      reason: 'Medical Leave',
      status: 'Approved',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeToLeaves.mockImplementation((cb) => {
      cb(mockLeaves);
      return vi.fn();
    });
    subscribeToInternalInstructors.mockImplementation((cb) => {
      cb(mockInstructors);
      return vi.fn();
    });
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([]);
      return vi.fn();
    });
  });

  it('allows Admin full leave management capabilities', () => {
    mockUser = { email: 'admin@thelab.com', role: 'Admin' };
    render(<NewLeavePage />);

    // Add form is present
    expect(screen.getByRole('button', { name: /mark on leave/i })).toBeInTheDocument();
    expect(screen.queryByTestId('leave-readonly-banner')).not.toBeInTheDocument();

    // Status is an interactive select dropdown
    const statusSelect = screen.getAllByRole('combobox').find((el) => el.value === 'Approved');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect.tagName).toBe('SELECT');

    // Action column has trash / remove button
    expect(screen.getByTitle('Remove leave')).toBeInTheDocument();
    expect(screen.getByTitle(/simulate impact/i)).toBeInTheDocument();
  });

  it('allows SPA full leave management capabilities', () => {
    mockUser = { email: 'spa@thelab.com', role: 'SPA' };
    render(<NewLeavePage />);

    // Add form is present
    expect(screen.getByRole('button', { name: /mark on leave/i })).toBeInTheDocument();
    expect(screen.queryByTestId('leave-readonly-banner')).not.toBeInTheDocument();

    // Status is an interactive select dropdown
    const statusSelect = screen.getAllByRole('combobox').find((el) => el.value === 'Approved');
    expect(statusSelect).toBeInTheDocument();

    // Action column has trash / remove button
    expect(screen.getByTitle('Remove leave')).toBeInTheDocument();
  });

  it('restricts Instructor to read-only view', () => {
    mockUser = { email: 'inst@thelab.com', role: 'Instructor' };
    render(<NewLeavePage />);

    // Add form is hidden and read-only notice is displayed
    expect(screen.queryByRole('button', { name: /mark on leave/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('leave-readonly-banner')).toBeInTheDocument();
    expect(screen.getByText(/read-only mode/i)).toBeInTheDocument();

    // Status is rendered as static text badge, not a select
    const statusSelect = screen.getAllByRole('combobox').find((el) => el.value === 'Approved');
    expect(statusSelect).toBeUndefined();
    expect(screen.getByText('Approved')).toBeInTheDocument();

    // Trash button is hidden, simulate button remains accessible
    expect(screen.queryByTitle('Remove leave')).not.toBeInTheDocument();
    expect(screen.getByTitle(/simulate impact/i)).toBeInTheDocument();
  });

  it('restricts Supervisor to read-only view', () => {
    mockUser = { email: 'supervisor@thelab.com', role: 'Supervisor' };
    render(<NewLeavePage />);

    // Add form is hidden
    expect(screen.queryByRole('button', { name: /mark on leave/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('leave-readonly-banner')).toBeInTheDocument();

    // Status select is hidden
    const statusSelect = screen.getAllByRole('combobox').find((el) => el.value === 'Approved');
    expect(statusSelect).toBeUndefined();

    // Trash button is hidden
    expect(screen.queryByTitle('Remove leave')).not.toBeInTheDocument();
  });
});
