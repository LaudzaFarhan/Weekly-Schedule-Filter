// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NextTermContinuationModal from '../NextTermContinuationModal';

describe('NextTermContinuationModal', () => {
  const mockRow = {
    studentName: 'Aston Francis Lucius',
    program: 'K1.10',
    programCode: 'K1.10',
    category: 'Kinder',
    targetMeetings: 10,
    instructor: 'Abel',
    attendance: {
      1: { date: '2026-08-01' },
      2: { date: '2026-08-08' },
      3: { date: '2026-08-15' },
      4: { date: '2026-08-22' },
      5: { date: '2026-08-29' },
      6: { date: '2026-09-01' },
      7: { date: '2026-09-02' },
      8: { date: '2026-09-03' },
      9: { date: '2026-09-04' },
      10: { date: '2026-09-05' },
    },
    termHistory: [
      {
        id: 'term_1',
        termName: 'Term 1',
        termNumber: 1,
        program: 'KF1.10',
        attendedCount: 10,
        totalMeetings: 10,
        paymentType: 'Upfront Paid',
        completedDate: '2026-07-30',
      },
    ],
  };

  it('renders student info, previous terms, and choice cards when open', () => {
    render(
      <NextTermContinuationModal
        isOpen={true}
        onClose={vi.fn()}
        row={mockRow}
        category="Kinder"
      />
    );

    expect(screen.getByText('Next Term Continuation Confirmation')).toBeInTheDocument();
    expect(screen.getByText('Aston Francis Lucius')).toBeInTheDocument();
    expect(screen.getByText('10 / 10 Meetings')).toBeInTheDocument();
    expect(screen.getByText('Confirm Continue')).toBeInTheDocument();
    expect(screen.getByText('Wait Payment')).toBeInTheDocument();
    expect(screen.getByText('Break / Stop')).toBeInTheDocument();
    expect(screen.getByText('Previously Assigned Terms (1)')).toBeInTheDocument();
    expect(screen.getByText('KF1.10')).toBeInTheDocument();
  });

  it('calls onConfirmContinuation with resetAttendance and updated history on submit', () => {
    const onConfirmContinuation = vi.fn();
    const onClose = vi.fn();

    render(
      <NextTermContinuationModal
        isOpen={true}
        onClose={onClose}
        row={mockRow}
        category="Kinder"
        onConfirmContinuation={onConfirmContinuation}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Confirm Continue & Reset Attendance/i });
    fireEvent.click(submitBtn);

    expect(onConfirmContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        row: mockRow,
        resetAttendance: true,
        continuation: 'Continue',
        progressUpdateStatus: 'Completed',
        termHistory: expect.arrayContaining([
          expect.objectContaining({
            program: 'K1.10',
            attendedCount: 10,
          }),
        ]),
      })
    );
  });

  it('calls onSetWaitPayment when Wait Payment mode is selected and submitted', () => {
    const onSetWaitPayment = vi.fn();
    const onClose = vi.fn();

    render(
      <NextTermContinuationModal
        isOpen={true}
        onClose={onClose}
        row={mockRow}
        category="Kinder"
        onSetWaitPayment={onSetWaitPayment}
      />
    );

    const waitPaymentCard = screen.getByRole('button', { name: /Wait Payment/i });
    fireEvent.click(waitPaymentCard);

    const submitBtn = screen.getByRole('button', { name: /Set as Wait Payment/i });
    fireEvent.click(submitBtn);

    expect(onSetWaitPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        row: mockRow,
        progressUpdateStatus: 'Wait Payment',
      })
    );
  });

  it('detects graduation after Kinder T4 (K4) and graduates to Junior program', () => {
    const onConfirmContinuation = vi.fn();
    const k4Row = {
      ...mockRow,
      program: 'K4.10',
      programCode: 'K4.10',
    };

    render(
      <NextTermContinuationModal
        isOpen={true}
        onClose={vi.fn()}
        row={k4Row}
        category="Kinder"
        onConfirmContinuation={onConfirmContinuation}
      />
    );

    // Should display graduation milestone notice
    expect(screen.getByText(/Milestone Graduation: Kinder → Junior Program/i)).toBeInTheDocument();
    expect(screen.getByText(/Student completed Kinder \(K4 \/ T4\)/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Confirm Continue & Reset Attendance/i });
    fireEvent.click(submitBtn);

    expect(onConfirmContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        nextCategory: 'Junior',
        nextProgramCode: 'J1',
        graduationStatus: 'Graduated',
      })
    );
  });

  it('allows skipping module / level directly to another category or level', () => {
    const onConfirmContinuation = vi.fn();

    render(
      <NextTermContinuationModal
        isOpen={true}
        onClose={vi.fn()}
        row={mockRow}
        category="Kinder"
        onConfirmContinuation={onConfirmContinuation}
      />
    );

    const skipBtn = screen.getByRole('button', { name: /Skip Module \/ Level/i });
    fireEvent.click(skipBtn);

    expect(screen.getByText(/Fast-track \/ Skip Mode/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Confirm Continue & Reset Attendance/i });
    fireEvent.click(submitBtn);

    expect(onConfirmContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        graduationStatus: 'Skipped',
      })
    );
  });
});
