// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewCrmWeeklyPerformancePage from '../NewCrmWeeklyPerformancePage';

// Mock react-chartjs-2 to test without real HTML Canvas in JSDOM
vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="mock-bar-chart" />,
  Line: () => <div data-testid="mock-line-chart" />,
  Doughnut: () => <div data-testid="mock-doughnut-chart" />,
}));

const mockLogFollowUp = vi.fn();
const mockLeads = [
  {
    id: 99,
    name: 'Indah Permatasari',
    status: 'profiling',
    branch: 'Bekasi',
    phone: '081234567890',
    trialDate: null,
    notes: 'Student: Kevin, Age: 9, Grade: 4th Grade, Parent: Ibu Indah',
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:00:00.000Z',
  },
];

vi.mock('@/services/newCrmService', () => ({
  listenToLeads: (cb) => {
    cb(mockLeads);
    return () => {};
  },
  logFollowUp: (...args) => mockLogFollowUp(...args),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    branches: ['Bekasi'],
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'sherlyn@thelab.id', displayName: 'Kak Sherlyn' },
  }),
}));

describe('NewCrmWeeklyPerformancePage - Profiling Tag and Follow-Up Journey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogFollowUp.mockResolvedValue({
      id: 99,
      name: 'Indah Permatasari',
      status: 'profiling',
      follow_ups: [
        {
          id: 'fu_1',
          attempt: 1,
          performedBy: 'Kak Sherlyn',
          channel: 'WhatsApp',
          notes: 'Chatted with Ibu Indah about Kevin (Age 9)',
          date: '2026-07-16T10:00:00.000Z',
        },
      ],
    });
  });

  it('renders NEED TO FOLLOW UP tag on profiling category leads in drilldown modal', async () => {
    render(<NewCrmWeeklyPerformancePage onNavigate={() => {}} />);

    // Open drilldown modal by clicking the enabled inspect button for Jul 2026
    const inspectBtn = screen.getAllByRole('button', { name: /Inspect Month/i }).find((b) => !b.disabled);
    expect(inspectBtn).toBeDefined();
    fireEvent.click(inspectBtn);

    // Modal should show Indah Permatasari
    expect(screen.getByText('Indah Permatasari')).toBeInTheDocument();

    // Should display NEED TO FOLLOW UP tag and follow up counter
    expect(screen.getByText('NEED TO FOLLOW UP')).toBeInTheDocument();
    expect(screen.getByText('0x Follow-up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Journey \(0x\)/i })).toBeInTheDocument();
  });

  it('opens Journey modal, displays empty state, and records follow-up attempt', async () => {
    render(<NewCrmWeeklyPerformancePage onNavigate={() => {}} />);

    // Open drilldown modal
    const inspectBtn = screen.getAllByRole('button', { name: /Inspect Month/i }).find((b) => !b.disabled);
    fireEvent.click(inspectBtn);

    // Click Journey (0x)
    const journeyBtn = screen.getByRole('button', { name: /Journey \(0x\)/i });
    fireEvent.click(journeyBtn);

    // Modal title & customer details should show
    expect(screen.getByText('Customer Profile & Inbound Context:')).toBeInTheDocument();
    expect(screen.getByText('No follow-up interactions logged yet.')).toBeInTheDocument();

    // Staff name should be pre-filled with Kak Sherlyn
    const staffInput = screen.getByPlaceholderText(/e\.g\. Kak Muhajir, Admin/i);
    expect(staffInput.value).toBe('Kak Sherlyn');

    // Enter notes
    const notesInput = screen.getByPlaceholderText(/Enter what the parent said/i);
    fireEvent.change(notesInput, { target: { value: 'Chatted with Ibu Indah about Kevin (Age 9)' } });

    // Submit follow-up form
    const saveBtn = screen.getByRole('button', { name: /Save Follow-Up \(1x\)/i });
    fireEvent.click(saveBtn);

    // Verify service was called
    await waitFor(() => {
      expect(mockLogFollowUp).toHaveBeenCalledWith(
        99,
        expect.objectContaining({
          performedBy: 'Kak Sherlyn',
          channel: 'WhatsApp',
          notes: 'Chatted with Ibu Indah about Kevin (Age 9)',
        })
      );
    });

    // Timeline should now show the touchpoint
    await waitFor(() => {
      expect(screen.getByText('Chatted with Ibu Indah about Kevin (Age 9)')).toBeInTheDocument();
      expect(screen.getByText(/1x Followed Up/i)).toBeInTheDocument();
    });
  });
});
