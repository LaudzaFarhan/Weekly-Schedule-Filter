// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewCrmWeeklyPerformancePage from '../NewCrmWeeklyPerformancePage';
import {
  classifyLead,
  aggregateMonthlyData,
  formatMonthLabel,
  getLeadMonth,
} from '@/utils/crmPerformance';
import { SUB_ITEM_DEFINITIONS } from '@/components/layout/Sidebar';

// Mock react-chartjs-2 to test without real HTML Canvas in JSDOM
vi.mock('react-chartjs-2', () => ({
  Bar: (props) => <div data-testid="mock-bar-chart" data-chartdata={JSON.stringify(props.data)} />,
  Line: (props) => <div data-testid="mock-line-chart" data-chartdata={JSON.stringify(props.data)} />,
  Doughnut: (props) => <div data-testid="mock-doughnut-chart" data-chartdata={JSON.stringify(props.data)} />,
}));

// Mock newCrmService to feed controlled mock leads
const mockLeads = [
  {
    id: 1,
    name: 'Mom Esa (Parent of Anak Agung)',
    phone: '6281234567890',
    message: 'Child Name: Anak Agung (Age: 6), Trial Kinder',
    status: 'trial_booked',
    branch: 'Bekasi',
    trialDate: '2026-08-08',
    createdAt: '2026-08-01T10:00:00Z',
  },
  {
    id: 2,
    name: 'April (Parent of Yudhistira)',
    phone: '6287883466397',
    message: 'Usia: 4 tahun, rencana trial',
    status: 'interest_trial',
    branch: 'Bintaro',
    createdAt: '2026-08-15T12:00:00Z',
  },
  {
    id: 3,
    name: 'Random Spammer',
    phone: '628999999999',
    message: 'Promo pinjaman online / broadcast spam [junk]',
    status: 'junk',
    branch: 'Bekasi',
    createdAt: '2026-08-20T14:00:00Z',
  },
  {
    id: 4,
    name: 'Inquiry Customer Only',
    phone: '628111111111',
    message: 'Tanya info les coding',
    status: 'interest_trial',
    branch: 'Bekasi',
    createdAt: '2026-08-22T08:00:00Z',
  },
  {
    id: 5,
    name: 'Dad Laudza (Parent of Kagura)',
    phone: '6285156465962',
    message: 'Trial Junior, Kelapa Gading',
    status: 'trial_booked',
    branch: 'Kelapa Gading',
    trialDate: '2026-09-14',
    createdAt: '2026-09-11T07:58:34Z',
  },
];

vi.mock('@/services/newCrmService', () => ({
  listenToLeads: (cb) => {
    cb(mockLeads);
    return () => {};
  },
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    branches: ['Bekasi', 'Bintaro', 'Kelapa Gading', 'Pluit Village'],
  }),
}));

describe('NewCrmWeeklyPerformancePage & Monthly Trend Engine', () => {
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Lead Classification Logic (classifyLead)', () => {
    it('identifies junk leads by status or spam keywords', () => {
      expect(classifyLead({ status: 'junk', name: 'Spam 1' }).isJunk).toBe(true);
      expect(classifyLead({ notes: 'Salah sambung / spam', name: 'Test' }).isJunk).toBe(true);
      expect(classifyLead({ message: 'Broadcast iklan [spam]' }).isJunk).toBe(true);
    });

    it('identifies scheduled trials when booked or trial date is present', () => {
      const scheduledLead = { status: 'trial_booked', name: 'Student A', trialDate: '2026-08-10' };
      const res = classifyLead(scheduledLead);
      expect(res.isScheduled).toBe(true);
      expect(res.isProfiled).toBe(true);
      expect(res.isJunk).toBe(false);
    });

    it('identifies profiling when student, parent and age are captured', () => {
      const profiledLead = {
        name: 'Mom Sarah (Parent of Kenzo)',
        message: 'Anak: Kenzo, Usia: 7 tahun',
        status: 'interest_trial',
      };
      const res = classifyLead(profiledLead);
      expect(res.isProfiled).toBe(true);
      expect(res.isScheduled).toBe(false);
      expect(res.isJunk).toBe(false);
    });

    it('treats basic inquiries as leads without profiling or junk', () => {
      const basicLead = {
        name: 'Inquirer',
        phone: '628111222333',
        message: 'Halo, tanya kelas',
        status: 'interest_trial',
      };
      const res = classifyLead(basicLead);
      expect(res.isJunk).toBe(false);
      expect(res.isProfiled).toBe(false);
      expect(res.isScheduled).toBe(false);
    });
  });

  describe('Monthly Data Aggregation (aggregateMonthlyData)', () => {
    it('aggregates leads correctly across months', () => {
      const { months, totals } = aggregateMonthlyData(mockLeads, '2026', 'all');

      // Year 2026 pre-seeds 12 months
      expect(months).toHaveLength(12);

      // Check totals for 2026
      expect(totals.leads).toBe(5);
      // Lead 1: Profiled & Scheduled
      // Lead 2: Profiled
      // Lead 3: Junk
      // Lead 4: Inflow only
      // Lead 5: Profiled & Scheduled
      expect(totals.profiling).toBe(3); // 1, 2, 5
      expect(totals.scheduled).toBe(2); // 1, 5
      expect(totals.junk).toBe(1); // 3

      // Check rates
      expect(totals.profilingRate).toBe('60.0'); // 3/5
      expect(totals.scheduledRate).toBe('66.7'); // 2/3
      expect(totals.junkRate).toBe('20.0'); // 1/5
    });

    it('filters correctly by branch', () => {
      const bekasiAgg = aggregateMonthlyData(mockLeads, '2026', 'Bekasi');
      expect(bekasiAgg.totals.leads).toBe(3); // Lead 1, 3, 4
      expect(bekasiAgg.totals.scheduled).toBe(1); // Lead 1
      expect(bekasiAgg.totals.junk).toBe(1); // Lead 3
    });
  });

  describe('Component Rendering & User Interactions', () => {
    it('renders header, breadcrumbs, and 4 KPI cards', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      // Title & breadcrumb
      expect(screen.getByText('CRM Monthly Trend Graphics')).toBeInTheDocument();
      expect(screen.getByText('Weekly Performance & Monthly Trends')).toBeInTheDocument();

      // 4 KPI cards & table headers
      expect(screen.getAllByText('1. Leads (Customer Chats)').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('2. Profiling (Profile)').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('3. Trial Scheduled').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('4. Junk Leads (Spam)').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the Chart canvas and switches chart types', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      // Default is Grouped Bar
      expect(screen.getAllByTestId('mock-bar-chart').length).toBeGreaterThanOrEqual(1);

      // Switch to Smooth Trend (Line)
      fireEvent.click(screen.getByText('Smooth Trend'));
      expect(screen.getAllByTestId('mock-line-chart').length).toBeGreaterThanOrEqual(1);

      // Switch to Stacked Funnel
      fireEvent.click(screen.getByText('Stacked Funnel'));
      expect(screen.getAllByTestId('mock-bar-chart').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the monthly performance breakdown table', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      expect(screen.getByText('Monthly Performance Breakdown Table')).toBeInTheDocument();
      expect(screen.getByText('Aug 2026')).toBeInTheDocument();
      expect(screen.getByText('Sep 2026')).toBeInTheDocument();
    });

    it('navigates back to main CRM pipeline when clicking the action button', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      const pipelineBtn = screen.getByText('Open Pipeline Board');
      expect(pipelineBtn).toBeInTheDocument();

      fireEvent.click(pipelineBtn);
      expect(mockNavigate).toHaveBeenCalledWith('crm');
    });

    it('filters how many cards to show via the dropdown filter', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      // Initially all 4 KPI cards are rendered
      expect(screen.getByTestId('kpi-card-leads')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-card-profiling')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-card-scheduled')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-card-junk')).toBeInTheDocument();

      // Find the "Cards to show:" select dropdown
      const select = screen.getByDisplayValue('Show 4 Cards (All)');
      expect(select).toBeInTheDocument();

      // Change to "Show 3 Cards (Funnel)" -> Junk card should be hidden
      fireEvent.change(select, { target: { value: '3' } });
      expect(screen.getByTestId('kpi-card-leads')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-card-profiling')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-card-scheduled')).toBeInTheDocument();
      expect(screen.queryByTestId('kpi-card-junk')).not.toBeInTheDocument();

      // Change to "Show 2 Cards (Acquisition)" -> only Leads & Profiling
      fireEvent.change(select, { target: { value: '2' } });
      expect(screen.getByTestId('kpi-card-leads')).toBeInTheDocument();
      expect(screen.getByTestId('kpi-card-profiling')).toBeInTheDocument();
      expect(screen.queryByTestId('kpi-card-scheduled')).not.toBeInTheDocument();
      expect(screen.queryByTestId('kpi-card-junk')).not.toBeInTheDocument();

      // Change to "Show 1 Card (Leads Only)"
      fireEvent.change(select, { target: { value: '1' } });
      expect(screen.getByTestId('kpi-card-leads')).toBeInTheDocument();
      expect(screen.queryByTestId('kpi-card-profiling')).not.toBeInTheDocument();
    });

    it('toggles cards individually via the interactive chip buttons', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      // Initially all 4 cards visible
      expect(screen.getByTestId('kpi-card-junk')).toBeInTheDocument();

      // Toggle off Junk chip
      const junkChip = screen.getByTitle(/Click to (hide|show) 4\. Junk/i);
      fireEvent.click(junkChip);
      expect(screen.queryByTestId('kpi-card-junk')).not.toBeInTheDocument();

      // Toggle Junk chip back on
      fireEvent.click(junkChip);
      expect(screen.getByTestId('kpi-card-junk')).toBeInTheDocument();
    });

    it('renders cross-branch comparisons and switches modes', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      // Title of branch comparison section
      expect(screen.getByText('Cross-Branch Performance & Monthly Comparisons')).toBeInTheDocument();

      // Switch to Month-by-Month Snapshot
      const snapshotBtn = screen.getByRole('button', { name: /Month-by-Month Snapshot/i });
      fireEvent.click(snapshotBtn);
      expect(screen.getByText(/Select Month:/i)).toBeInTheDocument();

      // Switch to Share & Benchmarks
      const shareBtn = screen.getByRole('button', { name: /Share & Benchmarks/i });
      fireEvent.click(shareBtn);
      expect(screen.getByText(/Inbound Lead Volume Share/i)).toBeInTheDocument();
    });

    it('toggles table view between Branch Breakdown and Branch Matrix', () => {
      render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

      // Default is Branch Breakdown
      expect(screen.getByText(/Monthly Performance Breakdown Table/i)).toBeInTheDocument();

      // Toggle to Branch Matrix
      const matrixBtn = screen.getByRole('button', { name: /Branch Matrix/i });
      fireEvent.click(matrixBtn);
      expect(screen.getByText(/Matrix Metric:/i)).toBeInTheDocument();

      // Toggle back to Branch Breakdown
      const breakdownBtn = screen.getByRole('button', { name: /Branch Breakdown/i });
      fireEvent.click(breakdownBtn);
      expect(screen.getByRole('button', { name: /Expand All Branches|Collapse All Branches/i })).toBeInTheDocument();
    });

    it('computes branchBreakdown for each month in aggregateMonthlyData', () => {
      const { months, branchTotals } = aggregateMonthlyData(mockLeads, '2026', 'all');
      expect(months).toHaveLength(12);

      // August 2026 (index 7) has 4 mock leads
      const aug = months.find((m) => m.monthKey === '2026-08');
      expect(aug).toBeDefined();
      expect(aug.leadsCount).toBe(4);
      expect(aug.branchBreakdown.length).toBeGreaterThanOrEqual(2);

      // Bekasi in August has 3 leads (1, 3, 4)
      const bekasiAug = aug.branchBreakdown.find((b) => b.branchName === 'Bekasi');
      expect(bekasiAug).toBeDefined();
      expect(bekasiAug.leadsCount).toBe(3);

      // Bintaro in August has 1 lead (2)
      const bintaroAug = aug.branchBreakdown.find((b) => b.branchName === 'Bintaro');
      expect(bintaroAug).toBeDefined();
      expect(bintaroAug.leadsCount).toBe(1);

      // Branch totals across 2026
      expect(branchTotals.length).toBeGreaterThanOrEqual(3);
    });
  });
});

