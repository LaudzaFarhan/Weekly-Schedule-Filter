// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());
const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const subscribeToLiveProgress = vi.hoisted(() => vi.fn());
const saveLiveProgress = vi.hoisted(() => vi.fn(async () => ({})));
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    enabledBranches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
    branches: [{ name: 'Kelapa Gading' }, { name: 'Puri Indah' }],
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@thelab.id' } }),
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
}));

vi.mock('@/services/newLiveProgressService', () => ({
  subscribeToLiveProgress,
  saveLiveProgress,
}));

const { default: LiveProgressTable } = await import('@/views/LiveProgressTable');

describe('LiveProgressTable - Unassigned Students & Unregistered Instructors', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Registered instructor: Only "Ziyah" is registered in instructorProfiles
    subscribeToInternalInstructors.mockImplementation((cb) => {
      cb([
        { id: 'ziyah@lab.id', name: 'Ziyah', fullname: 'Fauziyah Amira Zahra', branches: ['Kelapa Gading'] },
      ]);
      return () => {};
    });

    // Classes: Student A is taught by "Ziyah" (registered), Student B is taught by "Sherlyn" (unregistered)
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'c1',
          teacher: 'Ziyah',
          student: 'Arya Arkananta',
          day: 'Monday',
          time: '3:00 PM - 4:30 PM',
          branchName: 'Kelapa Gading',
          program: 'K1',
          classType: 'Regular',
        },
        {
          id: 'c2',
          teacher: 'Sherlyn', // Instructor not added in website yet
          student: 'Marvel Benedict',
          day: 'Monday',
          time: '1:00 PM - 2:30 PM',
          branchName: 'Kelapa Gading',
          program: 'KF2',
          classType: 'Regular',
        },
      ]);
      return () => {};
    });

    // Student Registry: Includes Liam and Kenzo who have no class row yet
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 's1', name: 'Arya Arkananta', level: 'Kinder Core', branchName: 'Kelapa Gading', status: 'Active' },
        { id: 's2', name: 'Marvel Benedict', level: 'Kinder Foundation', branchName: 'Kelapa Gading', status: 'Active' },
        { id: 's3', name: 'Liam Theodore', level: 'Kinder Foundation', branchName: 'Kelapa Gading', status: 'Active', remarks: 'Instructor: Sherlyn | Schedule: Monday 1.00-2.30pm' },
        { id: 's4', name: 'Kenzo Smith', level: 'Kinder Core', branchName: 'Kelapa Gading', status: 'Active' },
      ]);
      return () => {};
    });

    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });
  });

  it('renders all students including those with unadded instructors (Sherlyn) and without class slots', () => {
    render(<LiveProgressTable category="Kinder" />);

    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.getByText('Kenzo Smith')).toBeInTheDocument();
  });

  it('flags unadded instructor (Sherlyn) as Unassigned with "Not in website" badge', () => {
    render(<LiveProgressTable category="Kinder" />);

    // Marvel Benedict and Liam Theodore have teacher "Sherlyn" who is not in instructorProfiles
    expect(screen.getAllByText('Sherlyn').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not in website').length).toBeGreaterThanOrEqual(1);

    // Both Marvel Benedict & Liam Theodore & Kenzo Smith have UNASSIGNED badges
    const unassignedBadges = screen.getAllByText('UNASSIGNED');
    expect(unassignedBadges.length).toBeGreaterThanOrEqual(3);
  });

  it('displays the Unassigned Students count badge in the header', () => {
    render(<LiveProgressTable category="Kinder" />);

    const unassignedHeaderBadge = screen.getByTitle('Click to filter Unassigned students');
    expect(unassignedHeaderBadge).toBeInTheDocument();
    expect(within(unassignedHeaderBadge).getByText('3')).toBeInTheDocument(); // Marvel Benedict, Liam Theodore, Kenzo Smith
  });

  it('filters to only unassigned students when clicking the Unassigned header badge', async () => {
    render(<LiveProgressTable category="Kinder" />);

    const unassignedHeaderBadge = screen.getByTitle('Click to filter Unassigned students');
    fireEvent.click(unassignedHeaderBadge);

    // Only unassigned students should be visible
    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.getByText('Kenzo Smith')).toBeInTheDocument();
    expect(screen.queryByText('Arya Arkananta')).not.toBeInTheDocument();
  });

  it('filters to only unassigned students when selecting Unassigned in Status dropdown', async () => {
    render(<LiveProgressTable category="Kinder" />);

    const comboboxes = screen.getAllByRole('combobox');
    const statusSelect = comboboxes[0]; // Status select is the first combobox
    fireEvent.change(statusSelect, { target: { value: 'Unassigned' } });

    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('Liam Theodore')).toBeInTheDocument();
    expect(screen.getByText('Kenzo Smith')).toBeInTheDocument();
    expect(screen.queryByText('Arya Arkananta')).not.toBeInTheDocument();
  });

  it('displays the arrangement button for unassigned students', () => {
    render(<LiveProgressTable category="Kinder" />);

    const arrangeButtons = screen.getAllByTitle(/Click to arrange lesson/i);
    expect(arrangeButtons.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('+ Assign Instructor')).toBeInTheDocument();
  });

  it('filters students by branch when selecting branch from dropdown', () => {
    render(<LiveProgressTable category="Kinder" />);

    const branchSelect = screen.getByDisplayValue('All Branches');
    expect(branchSelect).toBeInTheDocument();

    // Change to Puri Indah (where no students belong in test data)
    fireEvent.change(branchSelect, { target: { value: 'Puri Indah' } });
    expect(screen.getByText('No student matches your filters.')).toBeInTheDocument();

    // Change back to Kelapa Gading
    fireEvent.change(branchSelect, { target: { value: 'Kelapa Gading' } });
    expect(screen.getByText('Arya Arkananta')).toBeInTheDocument();
  });

  it('opens video attachment modal, attaches google drive video link, and saves', async () => {
    render(<LiveProgressTable category="Kinder" />);

    // Find the KF1 video button for Arya Arkananta
    const kf1Btns = screen.getAllByRole('button', { name: /KF1/i });
    expect(kf1Btns.length).toBeGreaterThanOrEqual(1);

    // Click on the first KF1 button to open modal
    fireEvent.click(kf1Btns[0]);

    // Modal should appear
    expect(screen.getByText('Attach Video Link')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/drive\.google\.com/i)).toBeInTheDocument();

    // Type video link
    const input = screen.getByPlaceholderText(/drive\.google\.com/i);
    fireEvent.change(input, { target: { value: 'https://drive.google.com/file/d/12345/view' } });

    // Click Save Video Link
    const saveBtn = screen.getByRole('button', { name: /Save Video Link/i });
    fireEvent.click(saveBtn);

    expect(saveLiveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        videos: expect.objectContaining({
          KF1: expect.objectContaining({
            link: 'https://drive.google.com/file/d/12345/view',
          }),
        }),
      })
    );
  });
});

