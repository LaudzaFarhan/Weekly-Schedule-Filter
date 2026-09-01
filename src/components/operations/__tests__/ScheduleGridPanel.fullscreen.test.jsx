// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ScheduleGridPanel from '../ScheduleGridPanel';

vi.mock('../../../contexts/ScheduleContext', () => ({
  useSchedule: () => ({ branches: [{ id: 'b1', name: 'Puri Indah' }] }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'admin@kodekiddo.com' } }),
}));

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../hooks/useNewOperationals', () => ({
  useNewOperationals: () => ({ rules: [], applyLocal: vi.fn() }),
}));

vi.mock('../../../hooks/useScheduleRules', () => ({
  useScheduleRules: () => ({ rules: [] }),
}));

vi.mock('../../../services/internalInstructorService', () => ({
  subscribeToInternalInstructors: (cb) => {
    cb([{ name: 'Sky', level: 'Junior', branches: ['Puri Indah'] }]);
    return () => {};
  },
}));

vi.mock('../../../services/internalScheduleService', () => ({
  subscribeToInternalClasses: (cb) => {
    cb([]);
    return () => {};
  },
  createInternalClass: vi.fn(),
  updateInternalClass: vi.fn(),
  deleteInternalClass: vi.fn(),
}));

vi.mock('../../../services/newLeaveService', () => ({
  subscribeToLeaves: (cb) => {
    cb([]);
    return () => {};
  },
}));

vi.mock('../../../services/newLiveProgressService', () => ({
  subscribeToLiveProgress: (cb) => {
    cb([]);
    return () => {};
  },
  saveLiveProgress: vi.fn(),
}));

vi.mock('../../../services/newOperationalsService', () => ({
  saveOperational: vi.fn(),
}));

vi.mock('../../../services/newActivityService', () => ({
  logActivity: vi.fn(),
}));

describe('ScheduleGridPanel Fullscreen Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders fullscreen toggle button and expands on click', () => {
    const { container } = render(<ScheduleGridPanel />);

    const panel = container.querySelector('.panel');
    expect(panel).not.toHaveClass('schedule-grid-fullscreen');

    const fullscreenBtn = screen.getAllByRole('button', { name: /fullscreen/i })[0];
    expect(fullscreenBtn).toBeInTheDocument();

    // Click to enter fullscreen
    act(() => {
      fireEvent.click(fullscreenBtn);
    });
    expect(panel).toHaveClass('schedule-grid-fullscreen');
    expect(screen.getByText(/Focus Mode/i)).toBeInTheDocument();

    // Click Exit Fullscreen -> triggers closing transition
    const exitBtn = screen.getByRole('button', { name: /exit fullscreen/i });
    act(() => {
      fireEvent.click(exitBtn);
    });
    expect(panel).toHaveClass('is-closing');

    // Wait for exit timer to complete
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(panel).not.toHaveClass('schedule-grid-fullscreen');
    expect(panel).not.toHaveClass('is-closing');
  });

  it('exits fullscreen when Esc key is pressed', () => {
    const { container } = render(<ScheduleGridPanel />);
    const panel = container.querySelector('.panel');

    const fullscreenBtn = screen.getAllByRole('button', { name: /fullscreen/i })[0];
    act(() => {
      fireEvent.click(fullscreenBtn);
    });
    expect(panel).toHaveClass('schedule-grid-fullscreen');

    // Press Escape -> triggers closing transition
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    });
    expect(panel).toHaveClass('is-closing');

    // Advance timer to complete exit transition
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(panel).not.toHaveClass('schedule-grid-fullscreen');
  });
});
