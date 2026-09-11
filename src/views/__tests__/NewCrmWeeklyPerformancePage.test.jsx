// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewCrmWeeklyPerformancePage from '../NewCrmWeeklyPerformancePage';
import { SUB_ITEM_DEFINITIONS } from '@/components/layout/Sidebar';

// Mock react-chartjs-2 to test without real HTML Canvas in JSDOM
vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="mock-bar-chart" />,
  Line: () => <div data-testid="mock-line-chart" />,
}));

vi.mock('@/services/newCrmService', () => ({
  listenToLeads: (cb) => {
    cb([
      { id: 1, name: 'Lead 1', status: 'interest_trial', createdAt: '2026-08-01' }
    ]);
    return () => {};
  },
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    branches: ['Bekasi', 'Bintaro'],
  }),
}));

const mockNavigate = vi.fn();

describe('NewCrmWeeklyPerformancePage & CRM Sidebar Sub-sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies CRM is registered with sub-items in SUB_ITEM_DEFINITIONS', () => {
    expect(SUB_ITEM_DEFINITIONS.crm).toBeDefined();
    expect(SUB_ITEM_DEFINITIONS.crm).toHaveLength(2);
    expect(SUB_ITEM_DEFINITIONS.crm[0]).toEqual({ id: 'crm', label: 'Main' });
    expect(SUB_ITEM_DEFINITIONS.crm[1]).toEqual({ id: 'crm-weekly-performance', label: 'Weekly Performance' });
  });

  it('renders Weekly Performance dashboard with monthly trend graphics and KPI cards', () => {
    render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

    // Check title and breadcrumb
    expect(screen.getByText('CRM Monthly Trend Graphics')).toBeInTheDocument();
    expect(screen.getByText('CRM Pipeline')).toBeInTheDocument();

    // Check the 4 metric cards
    expect(screen.getAllByText('1. Leads (Customer Chats)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2. Profiling (Profile)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3. Trial Scheduled').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('4. Junk Leads (Spam)').length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to main CRM pipeline when clicking the active pipeline board button', () => {
    render(<NewCrmWeeklyPerformancePage onNavigate={mockNavigate} />);

    const pipelineBtn = screen.getByText('Open Pipeline Board');
    expect(pipelineBtn).toBeInTheDocument();

    fireEvent.click(pipelineBtn);
    expect(mockNavigate).toHaveBeenCalledWith('crm');
  });
});
