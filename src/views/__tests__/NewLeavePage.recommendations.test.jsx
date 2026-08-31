// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewLeavePage from '../NewLeavePage';

const subscribeToLeaves = vi.hoisted(() => vi.fn());
const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    branches: [{ id: 'b1', name: 'Puri Indah' }, { id: 'b2', name: 'Bintaro' }],
    enabledBranches: [{ id: 'b1', name: 'Puri Indah' }, { id: 'b2', name: 'Bintaro' }],
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

describe('NewLeavePage Substitute Recommendations & Schedule Coverage', () => {
  const mockInstructors = [
    {
      id: 'inst-1',
      name: 'Ahmad Muhajir',
      aliases: ['Ahmad', 'Muhajir'],
      level: 'Kinder and Junior',
      branches: ['Puri Indah'],
      employmentType: 'Full-Time',
      status: 'Active',
    },
    {
      id: 'inst-2',
      name: 'Felix Tio',
      aliases: ['Felix'],
      level: 'Junior and Coder',
      branches: ['Puri Indah'],
      employmentType: 'Full-Time',
      status: 'Active',
    },
    {
      id: 'inst-3',
      name: 'Siti Sarah',
      aliases: ['Siti', 'Sarah'],
      level: 'Kinder and Junior',
      branches: ['Puri Indah'],
      employmentType: 'Full-Time',
      status: 'Active',
    },
    {
      id: 'inst-4',
      name: 'Budi PartTime',
      aliases: ['Budi'],
      level: 'Kinder and Junior',
      branches: ['Puri Indah'],
      employmentType: 'Part-Time',
      availableDays: ['Saturday', 'Sunday'],
      status: 'Active',
    },
    {
      id: 'inst-5',
      name: 'CrossBranch Teacher',
      aliases: ['Cross'],
      level: 'Kinder and Junior',
      branches: ['Bintaro'],
      employmentType: 'Full-Time',
      status: 'Active',
    },
  ];

  const mockLeaves = [
    {
      id: 'leave-1',
      name: 'Ahmad Muhajir',
      startDate: '2026-08-28', // Friday
      endDate: '2026-08-29',   // Saturday
      reason: 'Sick',
      status: 'Approved',
    },
  ];

  const mockClasses = [
    {
      id: 'c1',
      teacher: 'Ahmad', // uses alias/nickname
      day: 'Fri',      // abbreviated day name
      time: '14:00-15:30',
      branchName: 'Puri Indah',
      program: 'KF1.2', // Kinder Foundation
      student: 'Student Alpha',
    },
    {
      id: 'c2',
      teacher: 'Ahmad',
      day: 'Sat',
      time: '10:00-11:30',
      branchName: 'Puri Indah',
      program: 'JF1.1', // Junior Foundation
      student: 'Student Beta',
    },
    {
      id: 'c3_busy',
      teacher: 'Felix Tio',
      day: 'Fri',
      time: '14:00-15:30', // Felix is busy on Friday at the same time
      branchName: 'Puri Indah',
      program: 'Coder Python',
      student: 'Student Gamma',
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
      cb(mockClasses);
      return vi.fn();
    });
  });

  it('detects affected classes using instructor alias and day abbreviation', () => {
    render(<NewLeavePage />);

    expect(screen.getAllByText('Ahmad Muhajir').length).toBeGreaterThan(0);
    // Schedule Coverage badge shows 2 classes affected
    expect(screen.getByText(/2 classes ·/i)).toBeInTheDocument();
  });

  it('opens impact details and recommends eligible substitute instructors', async () => {
    const user = userEvent.setup();
    render(<NewLeavePage />);

    // Click the coverage button or wand icon
    const covBtn = screen.getByText(/2 classes ·/i);
    await user.click(covBtn);

    // Header in expanded drawer
    expect(screen.getByText(/Schedule Impact & Cover for Ahmad Muhajir/i)).toBeInTheDocument();

    // Friday and Saturday sections
    expect(screen.getByText(/📅 Friday/i)).toBeInTheDocument();
    expect(screen.getByText(/📅 Saturday/i)).toBeInTheDocument();

    // Friday class at 14:00-15:30
    expect(screen.getByText(/14:00-15:30/i)).toBeInTheDocument();
    expect(screen.getByText(/KF1.2/i)).toBeInTheDocument();
    expect(screen.getByText(/Student Alpha/i)).toBeInTheDocument();

    // Siti Sarah is recommended on Friday (same branch, Kinder & Junior capable, free)
    // Felix is NOT recommended on Friday (busy at 14:00-15:30)
    // Budi PartTime is NOT recommended on Friday (only available Sat, Sun)
    const friSection = screen.getByText(/📅 Friday/i).closest('div');
    expect(within(friSection).getByText('Siti Sarah')).toBeInTheDocument();
    expect(within(friSection).queryByText('Felix Tio')).not.toBeInTheDocument();
    expect(within(friSection).queryByText('Budi PartTime')).not.toBeInTheDocument();

    // On Saturday, Budi PartTime IS available and recommended (since Saturday is his working day)
    const satSection = screen.getByText(/📅 Saturday/i).closest('div');
    expect(within(satSection).getByText('Budi PartTime')).toBeInTheDocument();
    expect(within(satSection).getByText('Siti Sarah')).toBeInTheDocument();
  });

  it('includes other branches when cross-branch toggle is enabled', async () => {
    const user = userEvent.setup();
    render(<NewLeavePage />);

    const covBtn = screen.getByText(/2 classes ·/i);
    await user.click(covBtn);

    const toggle = screen.getByLabelText(/Include instructors from other branches/i);
    expect(toggle).not.toBeChecked();

    // CrossBranch Teacher should not be in Friday list initially
    const friSection = screen.getByText(/📅 Friday/i).closest('div');
    expect(within(friSection).queryByText('CrossBranch Teacher')).not.toBeInTheDocument();

    // Enable toggle
    await user.click(toggle);
    expect(toggle).toBeChecked();

    // Now CrossBranch Teacher appears with other branch label
    expect(within(friSection).getByText('CrossBranch Teacher')).toBeInTheDocument();
  });
});
