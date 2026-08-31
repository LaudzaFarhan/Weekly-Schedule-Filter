// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToInternalInstructors = vi.hoisted(() => vi.fn());
const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const subscribeToLiveProgress = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    enabledBranches: [{ name: 'Kelapa Gading' }, { name: 'Gading Serpong' }],
    branches: [{ name: 'Kelapa Gading' }, { name: 'Gading Serpong' }],
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@thelab.id' } }),
}));

vi.mock('@/services/newActivityService', () => ({
  logActivity: vi.fn(async () => ({})),
  subscribeToActivity: vi.fn((cb) => { cb([]); return () => {}; }),
  subscribeToActivityHistory: vi.fn((cb) => { cb([]); return () => {}; }),
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
  saveLiveProgress: vi.fn(async () => ({})),
}));

const { default: NewSchedulePage } = await import('@/views/NewSchedulePage');

describe('NewSchedulePage - Program and Term Locking', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    subscribeToInternalInstructors.mockImplementation((cb) => {
      cb([{ id: 'inst-1', name: 'Alex', level: 'Junior, Kinder', branches: ['Kelapa Gading'] }]);
      return () => {};
    });

    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 'st-1', name: 'Alif Pratama', level: 'Kinder Foundation', branchName: 'Kelapa Gading' },
        { id: 'st-2', name: 'Budi Santoso', level: 'Junior Core Term 2', branchName: 'Kelapa Gading' },
      ]);
      return () => {};
    });

    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });

    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });
  });

  it('locks Program and Term dropdowns when student is selected in Add Class modal', async () => {
    render(<NewSchedulePage />);

    // Click on Alif Pratama in Unallocated panel
    const studentBtn = screen.getByText('Alif Pratama');
    fireEvent.click(studentBtn);

    // Click on Regular Class in the chooser
    const regularCard = screen.getByRole('button', { name: /^Regular Class/i });
    fireEvent.click(regularCard);

    // Click on Monday
    const mondayBtn = screen.getByText('Monday');
    fireEvent.click(mondayBtn);

    // Click "Set time manually" to open the form
    const manualBtn = screen.getByRole('button', { name: /Set time manually/i });
    fireEvent.click(manualBtn);

    // Modal should be visible
    expect(screen.getByText('Add Operational Class')).toBeInTheDocument();

    // The student is enrolled in Kinder Foundation -> should lock Program & Term
    await waitFor(() => {
      expect(screen.getByText(/Locked to Student Database:/i)).toBeInTheDocument();
    });

    // Verify "Change program anyway" button is gone
    expect(screen.queryByRole('button', { name: /Change program anyway/i })).not.toBeInTheDocument();

    // Verify Program select is disabled
    const programSelect = screen.getByTitle("Program is locked to student's enrolled level in database");
    expect(programSelect).toBeDisabled();
    expect(programSelect.value).toBe('KF1');

    // Verify Term select is disabled
    const termSelect = screen.getByTitle("Term is locked to student's enrolled level in database");
    expect(termSelect).toBeDisabled();
  }, 15000);

  it('correctly maps and locks Junior Core Term 2 student', async () => {
    render(<NewSchedulePage />);

    const studentBtn = screen.getByText('Budi Santoso');
    fireEvent.click(studentBtn);

    const regularCard = screen.getByRole('button', { name: /^Regular Class/i });
    fireEvent.click(regularCard);

    const mondayBtn = screen.getByText('Monday');
    fireEvent.click(mondayBtn);

    const manualBtn = screen.getByRole('button', { name: /Set time manually/i });
    fireEvent.click(manualBtn);

    await waitFor(() => {
      expect(screen.getByText(/Locked to Student Database:/i)).toBeInTheDocument();
    });

    const programSelect = screen.getByTitle("Program is locked to student's enrolled level in database");
    expect(programSelect).toBeDisabled();
    expect(programSelect.value).toBe('J2');

    const termSelect = screen.getByTitle("Term is locked to student's enrolled level in database");
    expect(termSelect).toBeDisabled();
    expect(termSelect.value).toBe('Term 2');
  }, 15000);

  it('correctly maps Junior Term 3 to J3 and Term 3 without manual re-entry', async () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 'st-jonathan', name: 'Jonathan Benedict Hioe', level: 'Junior Term 3', branchName: 'Kelapa Gading' },
      ]);
      return () => {};
    });

    render(<NewSchedulePage />);

    const studentBtn = screen.getByText('Jonathan Benedict Hioe');
    fireEvent.click(studentBtn);

    const regularCard = screen.getByRole('button', { name: /^Regular Class/i });
    fireEvent.click(regularCard);

    const mondayBtn = screen.getByText('Monday');
    fireEvent.click(mondayBtn);

    const manualBtn = screen.getByRole('button', { name: /Set time manually/i });
    fireEvent.click(manualBtn);

    await waitFor(() => {
      expect(screen.getByText(/Locked to Student Database:/i)).toBeInTheDocument();
    });

    const programSelect = screen.getByTitle("Program is locked to student's enrolled level in database");
    expect(programSelect).toBeDisabled();
    expect(programSelect.value).toBe('J3');

    const termSelect = screen.getByTitle("Term is locked to student's enrolled level in database");
    expect(termSelect).toBeDisabled();
    expect(termSelect.value).toBe('Term 3');
  }, 15000);

  it('automatically inherits program, term, and lesson for students with existing regular schedule', async () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 'st-jonathan', name: 'Jonathan Benedict Hioe', level: 'Junior Core', branchName: 'Kelapa Gading' },
      ]);
      return () => {};
    });

    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'cls-1',
          day: 'Saturday',
          time: '10:00 - 12:00',
          program: 'J3.4',
          term: 'Term 3',
          teacher: 'Alex',
          student: 'Jonathan Benedict Hioe',
          branchName: 'Kelapa Gading',
          classType: 'Regular',
          remarks: 'Term 3 - L4',
        },
      ]);
      return () => {};
    });

    render(<NewSchedulePage />);

    // Switch scope to "all" so Jonathan (who is already allocated) appears
    const scopeBtn = screen.getByRole('button', { name: /Which students to list/i });
    fireEvent.click(scopeBtn);
    const allOption = screen.getByRole('option', { name: /All Students/i });
    fireEvent.click(allOption);

    const studentBtn = screen.getByText('Jonathan Benedict Hioe');
    fireEvent.click(studentBtn);

    const replacementCard = screen.getByRole('button', { name: /^Replacement/i });
    fireEvent.click(replacementCard);

    const mondayBtn = screen.getByText('Monday');
    fireEvent.click(mondayBtn);

    const manualBtn = screen.getByRole('button', { name: /Set time manually/i });
    fireEvent.click(manualBtn);

    await waitFor(() => {
      expect(screen.getByTitle("Program is locked to student's enrolled level in database")).toBeInTheDocument();
    });

    const programSelect = screen.getByTitle("Program is locked to student's enrolled level in database");
    expect(programSelect).toBeDisabled();
    expect(programSelect.value).toBe('J3');

    const termSelect = screen.getByTitle("Term is locked to student's enrolled level in database");
    expect(termSelect).toBeDisabled();
    expect(termSelect.value).toBe('Term 3');
  }, 15000);

  it('renders Allocate Chooser with locked standard category and locked term', async () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 'st-abenroes', name: 'Abenroes Uthman', level: 'Kinder Core', branchName: 'Kelapa Gading' },
      ]);
      return () => {};
    });

    render(<NewSchedulePage />);

    // Click on Abenroes Uthman in Unallocated panel
    const studentBtn = screen.getByText('Abenroes Uthman');
    fireEvent.click(studentBtn);

    // Modal title
    expect(screen.getByText('Allocate Abenroes Uthman')).toBeInTheDocument();

    // Verify Target Level / Program is Kinder Core and disabled
    const programSelect = screen.getByTitle("Program is locked to student's enrolled level in database");
    expect(programSelect).toBeDisabled();
    expect(programSelect.value).toBe('Kinder Core');

    // Verify Target Term is locked
    const termSelect = screen.getByDisplayValue('Term 1');
    expect(termSelect).toBeDisabled();

    // Verify Target Lesson is enabled and selectable
    const lessonSelect = screen.getByRole('combobox', { name: /Target Lesson/i });
    expect(lessonSelect).not.toBeDisabled();
    fireEvent.change(lessonSelect, { target: { value: '3' } });
    expect(lessonSelect.value).toBe('3');
  });

  it('shows student lesson comparison badges in recommended times slots', async () => {
    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([
        { id: 'st-jonathan', name: 'Jonathan Benedict Hioe', level: 'Junior Term 3', branchName: 'Kelapa Gading' },
      ]);
      return () => {};
    });

    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'cls-sat-3pm',
          day: 'Saturday',
          time: '3.00 - 5.00 pm',
          program: 'J3.2',
          term: 'Term 3',
          teacher: 'Regina',
          student: 'Student A, Student B',
          branchName: 'Kelapa Gading',
          classType: 'Regular',
          remarks: 'Term 3 - L2',
        },
      ]);
      return () => {};
    });

    render(<NewSchedulePage />);

    // Click on Jonathan
    const studentBtn = screen.getByText('Jonathan Benedict Hioe');
    fireEvent.click(studentBtn);

    // Click on Replacement card
    const replacementCard = screen.getByRole('button', { name: /Replacement/i });
    fireEvent.click(replacementCard);

    // Click on Saturday in Recommended Days
    const satBtn = screen.getByTitle(/Saturday: 1 class with a free seat/i);
    fireEvent.click(satBtn);

    // Verify Saturday recommended times slot is visible and contains Student Lessons in Slot
    await waitFor(() => {
      expect(screen.getByText(/Student Lessons in Slot:/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Student A/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Student B/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('(J3 · L2)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('+ Jonathan Benedict Hioe (J3 · L1)')).toBeInTheDocument();
  });

  it('renders Temporary Schedules panel with active replacements and additional sessions', async () => {
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([
        {
          id: 'c1',
          teacher: 'Sherlyn',
          student: 'Jonathan Benedict Hioe',
          day: 'Monday',
          time: '3:00 PM - 5:00 PM',
          branchName: 'Kelapa Gading',
          program: 'J3.1',
          classType: 'Replacement',
          sessionDates: ['2026-09-10'],
        },
        {
          id: 'c2',
          teacher: 'Abel',
          student: 'Marvel Benedict',
          day: 'Tuesday',
          time: '1:00 PM - 3:00 PM',
          branchName: 'Kelapa Gading',
          program: 'JF1.2',
          classType: 'Additional Session',
          sessionDates: ['2026-09-15'],
        },
      ]);
      return () => {};
    });

    render(<NewSchedulePage />);

    // Verify Temporary Schedules panel header and badges
    expect(screen.getByRole('heading', { name: /Temporary Schedules/i })).toBeInTheDocument();
    expect(screen.getByText(/1 Replacement/i)).toBeInTheDocument();
    expect(screen.getByText(/1 Adds \/ Extra/i)).toBeInTheDocument();

    // Verify student names inside temporary cards
    expect(screen.getByText('Jonathan Benedict Hioe')).toBeInTheDocument();
    expect(screen.getByText('Marvel Benedict')).toBeInTheDocument();
    expect(screen.getByText('2026-09-10')).toBeInTheDocument();
    expect(screen.getByText('2026-09-15')).toBeInTheDocument();
  });
});
