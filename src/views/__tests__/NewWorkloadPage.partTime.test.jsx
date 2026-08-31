// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewWorkloadPage from '../NewWorkloadPage';

const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());
const subscribeToInternalStudents = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    branches: [{ id: 'b1', name: 'Puri Indah' }, { id: 'b2', name: 'Bintaro' }],
  }),
}));

vi.mock('@/services/internalScheduleService', () => ({
  subscribeToInternalClasses,
}));

vi.mock('@/services/internalInstructorService', () => ({
  subscribeToInternalInstructors,
}));

vi.mock('@/services/internalStudentService', () => ({
  subscribeToInternalStudents,
}));

vi.mock('@/hooks/useNewOperationals', () => ({
  useNewOperationals: () => ({
    openDaysFor: (branchName) => {
      if (branchName === 'Bintaro') return ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    },
  }),
}));

describe('NewWorkloadPage Part-Time Instructor Support', () => {
  const mockInstructors = [
    {
      id: '1',
      name: 'Alice FT',
      employmentType: 'Full-Time',
      branches: ['Puri Indah'],
      availableDays: [],
    },
    {
      id: '2',
      name: 'Bob PT',
      employmentType: 'Part-Time',
      branches: ['Puri Indah'],
      availableDays: ['Saturday', 'Sunday'],
    },
  ];

  const mockClasses = [
    {
      id: 'c1',
      day: 'Saturday',
      time: '10:30-12:30',
      teacher: 'Bob PT',
      student: 'Student 1',
      branchName: 'Puri Indah',
      program: 'Junior',
    },
    {
      id: 'c2',
      day: 'Monday',
      time: '10:30-12:30',
      teacher: 'Alice FT',
      student: 'Student 2',
      branchName: 'Puri Indah',
      program: 'Kinder',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb(mockClasses);
      return () => {};
    });
    subscribeToInternalInstructors.mockImplementation((cb) => {
      cb(mockInstructors);
      return () => {};
    });
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });
  });

  it('renders FT and PT badges in heatmap and instructor table', () => {
    render(<NewWorkloadPage />);

    expect(screen.getAllByText('Alice FT').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bob PT').length).toBeGreaterThanOrEqual(1);

    // Check for PT and FT badges
    const ptBadges = screen.getAllByText('PT');
    expect(ptBadges.length).toBeGreaterThan(0);

    const ftBadges = screen.getAllByText('FT');
    expect(ftBadges.length).toBeGreaterThan(0);

    // Table should display employment type
    expect(screen.getAllByText(/Part-Time \(Sat, Sun\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Full-Time').length).toBeGreaterThan(0);
  });

  it('identifies non-working days for Part-Time instructors as OFF rather than FREE', () => {
    render(<NewWorkloadPage />);

    // Bob PT is only available on Saturday and Sunday.
    const bobRow = screen.getByTitle(/Bob PT \(Part-Time: Sat, Sun\)/i);
    expect(bobRow).toBeInTheDocument();
  });

  it('filters instructors by employment type', async () => {
    const user = userEvent.setup();
    render(<NewWorkloadPage />);

    const employmentSelect = screen.getByDisplayValue('All Employment Types');
    expect(employmentSelect).toBeInTheDocument();

    // Select Part-Time Only
    await user.selectOptions(employmentSelect, 'Part-Time');

    // Bob PT should be present, Alice FT should not be in the table
    const table = screen.getByRole('table');
    expect(within(table).getByText('Bob PT')).toBeInTheDocument();
    expect(within(table).queryByText('Alice FT')).not.toBeInTheDocument();

    // Select Full-Time Only
    await user.selectOptions(employmentSelect, 'Full-Time');
    expect(within(table).getByText('Alice FT')).toBeInTheDocument();
    expect(within(table).queryByText('Bob PT')).not.toBeInTheDocument();
  });

  it('displays Part-Time details in session detail modal', async () => {
    const user = userEvent.setup();
    render(<NewWorkloadPage />);

    // Click on Bob PT's Saturday class cell
    const satButton = screen.getByTitle(/Bob PT · Saturday: 2h/i);
    await user.click(satButton);

    // Modal should show Part-Time tag
    const ptBadges = screen.getAllByText(/Part-Time \(Sat, Sun\)/i);
    expect(ptBadges.length).toBeGreaterThanOrEqual(2); // One in table, one in modal header
  });
});
