// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const authState = vi.hoisted(() => ({ user: null }));

vi.mock('../../../contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: authState.user, loading: false, login: () => {}, logout: () => {} }),
}));

vi.mock('../../../services/firebase', () => ({
  auth: {},
  db: {},
  firebaseConfigured: false,
}));

import ScheduleGrid from '../ScheduleGrid';

const mockBranches = [
  { id: 'puri-indah', name: 'Puri Indah' },
];

const mockInstructors = [
  { id: 1, name: 'Sky', branches: ['Puri Indah'], level: 'Junior and Coder' },
  { id: 2, name: 'Rayhan', branches: ['Puri Indah'], level: 'Junior and Coder' },
  { id: 3, name: 'Supandi', branches: ['Puri Indah'], level: 'Kinder and Junior' },
  { id: 4, name: 'Tanti', branches: ['Puri Indah'], level: 'Kinder and Junior' },
];

describe('ScheduleGrid Pin Instructor to the Left', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.user = { role: 'Admin', name: 'Admin User' };
  });

  it('renders instructors alphabetically by default', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[]}
        leaves={[]}
      />
    );

    // Get all column headers in the sticky thead
    const headers = screen.getAllByRole('columnheader');
    // First header is TIME
    expect(headers[0]).toHaveTextContent('TIME');
    // Alphabetical order: Rayhan, Sky, Supandi, Tanti
    expect(headers[1]).toHaveTextContent(/Rayhan/i);
    expect(headers[2]).toHaveTextContent(/Sky/i);
    expect(headers[3]).toHaveTextContent(/Supandi/i);
    expect(headers[4]).toHaveTextContent(/Tanti/i);
  });

  it('pins an instructor to the left when clicking the Pin button in the column header', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[]}
        leaves={[]}
      />
    );

    // Find the pin button for Supandi (originally at index 3)
    const pinSupandiBtn = screen.getByRole('button', { name: /Pin Supandi to left/i });
    expect(pinSupandiBtn).toBeInTheDocument();

    fireEvent.click(pinSupandiBtn);

    // Now Supandi should be the very first instructor column on the left!
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('TIME');
    expect(headers[1]).toHaveTextContent(/Supandi/i);
    expect(headers[1]).toHaveClass('schedule-grid-pinned-head');
    expect(headers[1]).toHaveStyle({ position: 'sticky', left: '88px' });

    // The remaining instructors follow alphabetically: Rayhan, Sky, Tanti
    expect(headers[2]).toHaveTextContent(/Rayhan/i);
    expect(headers[3]).toHaveTextContent(/Sky/i);
    expect(headers[4]).toHaveTextContent(/Tanti/i);

    // Supandi's pin button is now an active unpin button
    expect(screen.getByRole('button', { name: /Unpin Supandi from left/i })).toBeInTheDocument();

    // Persisted to localStorage
    expect(JSON.parse(localStorage.getItem('pulse_pinned_instructors'))).toEqual(['Supandi']);
  });

  it('supports multi-pinning and places pinned instructors in sequence on the left', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[]}
        leaves={[]}
      />
    );

    // Pin Tanti first
    fireEvent.click(screen.getByRole('button', { name: /Pin Tanti to left/i }));
    // Pin Rayhan second
    fireEvent.click(screen.getByRole('button', { name: /Pin Rayhan to left/i }));

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('TIME');
    // Pinned in sequence: Tanti (88px), Rayhan (260px)
    expect(headers[1]).toHaveTextContent(/Tanti/i);
    expect(headers[1]).toHaveStyle({ position: 'sticky', left: '88px' });
    expect(headers[2]).toHaveTextContent(/Rayhan/i);
    expect(headers[2]).toHaveStyle({ position: 'sticky', left: '260px' });

    // Remaining unpinned: Sky, Supandi
    expect(headers[3]).toHaveTextContent(/Sky/i);
    expect(headers[4]).toHaveTextContent(/Supandi/i);

    // Unpinning Tanti leaves Rayhan as the only pinned instructor on the left
    fireEvent.click(screen.getByRole('button', { name: /Unpin Tanti from left/i }));
    const headersAfter = screen.getAllByRole('columnheader');
    expect(headersAfter[1]).toHaveTextContent(/Rayhan/i);
    expect(headersAfter[2]).toHaveTextContent(/Sky/i);
    expect(headersAfter[3]).toHaveTextContent(/Supandi/i);
    expect(headersAfter[4]).toHaveTextContent(/Tanti/i);
  });

  it('allows pinning via the toolbar dropdown and unpinning via the toolbar chip', () => {
    render(
      <ScheduleGrid
        branches={mockBranches}
        instructors={mockInstructors}
        classGroups={[]}
        leaves={[]}
      />
    );

    // Find the toolbar Pin dropdown
    const pinSelect = screen.getByTitle(/Pin instructor to the left of the schedule grid/i);
    expect(pinSelect).toBeInTheDocument();

    // Select Sky from the dropdown
    fireEvent.change(pinSelect, { target: { value: 'Sky' } });

    // Sky is now on the left!
    const headers = screen.getAllByRole('columnheader');
    expect(headers[1]).toHaveTextContent(/Sky/i);

    // Pinned chip is displayed in toolbar
    const unpinChipBtn = screen.getByRole('button', { name: /^Unpin Sky$/i });
    expect(unpinChipBtn).toBeInTheDocument();

    // Click the chip's unpin button
    fireEvent.click(unpinChipBtn);

    // Sky returns to alphabetical position (Rayhan is first)
    const headersRestored = screen.getAllByRole('columnheader');
    expect(headersRestored[1]).toHaveTextContent(/Rayhan/i);
    expect(headersRestored[2]).toHaveTextContent(/Sky/i);
  });
});
