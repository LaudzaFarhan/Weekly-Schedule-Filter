// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewStudentSubscriptionsPage from '../NewStudentSubscriptionsPage';

/* ------------------------------------------------------------------- mocks */

const subscribeToInternalStudents = vi.hoisted(() => vi.fn());
const subscribeToInternalClasses = vi.hoisted(() => vi.fn());
const subscribeToLiveProgress = vi.hoisted(() => vi.fn());
const getTopUps = vi.hoisted(() => vi.fn());
const createTopUp = vi.hoisted(() => vi.fn());
const deleteTopUp = vi.hoisted(() => vi.fn());
const getTerms = vi.hoisted(() => vi.fn());
const saveTerm = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    enabledBranches: [{ name: 'Bintaro' }],
    branches: [{ name: 'Bintaro' }],
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/services/internalStudentService', () => ({
  subscribeToInternalStudents,
}));

vi.mock('@/services/internalScheduleService', () => ({
  subscribeToInternalClasses,
}));

vi.mock('@/services/newLiveProgressService', () => ({
  subscribeToLiveProgress,
}));

vi.mock('@/services/subscriptionTopupService', () => ({
  getTopUps,
  createTopUp,
  deleteTopUp,
}));

vi.mock('@/services/studentTermService', () => ({
  getTerms,
  saveTerm,
}));

describe('NewStudentSubscriptionsPage — Academic Term Coverage', () => {
  const sampleStudent = {
    id: 101,
    name: 'Aaron Jaden Suriadjaja',
    level: 'Kinder Foundation',
    branch_name: 'Bintaro',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();

    subscribeToInternalStudents.mockImplementation((cb) => {
      cb([sampleStudent]);
      return () => {};
    });
    subscribeToInternalClasses.mockImplementation((cb) => {
      cb([]);
      return () => {};
    });
    subscribeToLiveProgress.mockImplementation((cb) => {
      cb([
        {
          studentName: 'Aaron Jaden Suriadjaja',
          programCode: 'KF1',
          attendance: {},
        },
      ]);
      return () => {};
    });

    getTopUps.mockResolvedValue([]);
    getTerms.mockResolvedValue([]);
    saveTerm.mockResolvedValue({ success: true });
    createTopUp.mockResolvedValue({ id: 1, meetings: 20 });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  it('renders starting term selector and displays covered terms for Kinder student', async () => {
    const user = userEvent.setup();
    render(<NewStudentSubscriptionsPage />);

    // Wait for table to load
    await waitFor(() => {
      expect(screen.getByText('Aaron Jaden Suriadjaja')).toBeInTheDocument();
    });

    // Click Edit button
    const editBtn = screen.getByTitle('Edit Subscription Start Date & Package');
    await user.click(editBtn);

    // Modal should be open
    expect(screen.getByText('Edit Subscription Package')).toBeInTheDocument();
    expect(screen.getByText(/Package Starting Term \(Continuation\)/i)).toBeInTheDocument();

    // Starting term select should exist
    const startingTermSelect = screen.getByLabelText(/Starts From:/i);
    expect(startingTermSelect).toBeInTheDocument();

    // By default for KF1, it starts from Term 1
    expect(startingTermSelect.value).toBe('1');

    // Change starting term to Term 3
    fireEvent.change(startingTermSelect, { target: { value: '3' } });
    expect(startingTermSelect.value).toBe('3');

    // Set package terms to 2 Terms (20 Meetings)
    const packageSelect = screen.getByLabelText(/Package Terms/i);
    fireEvent.change(packageSelect, { target: { value: '20' } });

    // The covered terms preview should show Term 3 & Term 4 (2026)
    await waitFor(() => {
      expect(screen.getAllByText(/Term 3 & Term 4 \(2026\)/).length).toBeGreaterThan(0);
    });

    // Both badges should be rendered
    expect(screen.getByText('Term 3 (2026)')).toBeInTheDocument();
    expect(screen.getByText('Term 4 (2026)')).toBeInTheDocument();
  });

  it('saves covered terms to internal_student_terms upon Save Changes', async () => {
    const user = userEvent.setup();
    render(<NewStudentSubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Aaron Jaden Suriadjaja')).toBeInTheDocument();
    });

    // Open modal
    await user.click(screen.getByTitle('Edit Subscription Start Date & Package'));

    // Set Starting Term to Term 3
    const startingTermSelect = screen.getByLabelText(/Starts From:/i);
    await user.selectOptions(startingTermSelect, '3');

    // Set Package to 20 meetings (2 terms)
    const packageSelect = screen.getByLabelText(/Package Terms/i);
    await user.selectOptions(packageSelect, '20');

    // Click Save Changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    await user.click(saveBtn);

    // saveTerm should have been called for Term 3 and Term 4
    await waitFor(() => {
      expect(saveTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 101,
          termNumber: 3,
          year: expect.any(Number),
          paid: true,
        })
      );
      expect(saveTerm).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 101,
          termNumber: 4,
          year: expect.any(Number),
          paid: true,
        })
      );
    });

    // Toast notification should announce covered terms
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Subscription updated successfully',
        message: expect.stringContaining('Term 3 & Term 4'),
        variant: 'success',
      })
    );
  });

  it('auto-detects Term 3 as starting term when Term 1 and Term 2 are already paid in internal_student_terms', async () => {
    getTerms.mockResolvedValue([
      { id: 1, studentId: 101, year: 2026, termNumber: 1, paid: true },
      { id: 2, studentId: 101, year: 2026, termNumber: 2, paid: true },
    ]);

    const user = userEvent.setup();
    render(<NewStudentSubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Aaron Jaden Suriadjaja')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Edit Subscription Start Date & Package'));

    // Wait for terms to load and infer starting term 3
    const startingTermSelect = screen.getByLabelText(/Starts From:/i);
    await waitFor(() => {
      expect(startingTermSelect.value).toBe('3');
    });

    // Select 2 terms (20 meetings)
    const packageSelect = screen.getByLabelText(/Package Terms/i);
    fireEvent.change(packageSelect, { target: { value: '20' } });

    // Should automatically cover Term 3 and Term 4 (2026)
    await waitFor(() => {
      expect(screen.getAllByText(/Term 3 & Term 4 \(2026\)/).length).toBeGreaterThan(0);
    });
  });

  it('stages top-up and calculates continuation terms beyond current package', async () => {
    const user = userEvent.setup();
    render(<NewStudentSubscriptionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Aaron Jaden Suriadjaja')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Edit Subscription Start Date & Package'));

    await waitFor(() => {
      expect(screen.getByText('Edit Subscription Package')).toBeInTheDocument();
    });

    // Set starting term to 3
    const startingTermSelect = screen.getByLabelText(/Starts From:/i);
    fireEvent.change(startingTermSelect, { target: { value: '3' } });

    // Set package to 20 meetings (Term 3 & 4)
    const packageSelect = screen.getByLabelText(/Package Terms/i);
    fireEvent.change(packageSelect, { target: { value: '20' } });

    // Click +1 Term top-up button
    const topUp1TermBtn = screen.getByRole('button', { name: /\+1 Term/i });
    fireEvent.click(topUp1TermBtn);

    // Staged payment should appear in Payment History with continuation term (Term 1 2027)
    await waitFor(() => {
      expect(screen.getByText('UNSAVED — saves with Save Changes')).toBeInTheDocument();
      expect(screen.getByText(/Term 1 2027/i)).toBeInTheDocument();
    });
  });
});
