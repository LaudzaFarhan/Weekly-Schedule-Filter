// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StudentLeaveModal from '../StudentLeaveModal';

describe('StudentLeaveModal', () => {
  const mockMember = {
    id: 1,
    student: 'Noahiro Lius',
    program: 'K1',
    remarks: '',
  };

  const mockClassInfo = {
    day: 'Monday',
    time: '1:00 PM – 2:30 PM',
    teacher: 'Vivi',
    program: 'K1',
  };

  it('renders correctly when open', () => {
    render(
      <StudentLeaveModal
        isOpen={true}
        onClose={vi.fn()}
        member={mockMember}
        classInfo={mockClassInfo}
        defaultDate="2026-09-08"
        onSave={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByText('Declare Student Leave (Izin)')).toBeInTheDocument();
    expect(screen.getByText('Noahiro Lius')).toBeInTheDocument();
    expect(screen.getByText('Single Date')).toBeInTheDocument();
    expect(screen.getByText('Date Range')).toBeInTheDocument();
    expect(screen.getByText('All Weeks')).toBeInTheDocument();
  });

  it('submits single date leave', () => {
    const onSave = vi.fn();
    render(
      <StudentLeaveModal
        isOpen={true}
        onClose={vi.fn()}
        member={mockMember}
        classInfo={mockClassInfo}
        defaultDate="2026-09-08"
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText('Confirm Leave'));

    expect(onSave).toHaveBeenCalledWith({
      isIzin: true,
      mode: 'single',
      startDate: '2026-09-08',
      endDate: '2026-09-08',
      reason: '',
    });
  });

  it('allows switching to Date Range and submitting range leave', () => {
    const onSave = vi.fn();
    render(
      <StudentLeaveModal
        isOpen={true}
        onClose={vi.fn()}
        member={mockMember}
        classInfo={mockClassInfo}
        defaultDate="2026-09-08"
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText('Date Range'));
    fireEvent.click(screen.getByText('+2 Weeks'));
    fireEvent.click(screen.getByText('Confirm Leave'));

    expect(onSave).toHaveBeenCalledWith({
      isIzin: true,
      mode: 'range',
      startDate: '2026-09-08',
      endDate: '2026-09-22',
      reason: '',
    });
  });

  it('shows Mark Attending button if member is currently on leave', () => {
    const onClear = vi.fn();
    const leaveMember = {
      ...mockMember,
      remarks: '[Izin: 2026-09-08 to 2026-09-22 | Family holiday]',
    };

    render(
      <StudentLeaveModal
        isOpen={true}
        onClose={vi.fn()}
        member={leaveMember}
        classInfo={mockClassInfo}
        onSave={vi.fn()}
        onClear={onClear}
      />
    );

    expect(screen.getByText('Edit Leave (Izin)')).toBeInTheDocument();
    const markAttendingBtn = screen.getByText('Mark Attending');
    expect(markAttendingBtn).toBeInTheDocument();

    fireEvent.click(markAttendingBtn);
    expect(onClear).toHaveBeenCalled();
  });
});
