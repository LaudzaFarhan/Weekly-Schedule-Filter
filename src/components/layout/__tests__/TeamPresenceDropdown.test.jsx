// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TeamPresenceDropdown from '../TeamPresenceDropdown';

describe('TeamPresenceDropdown', () => {
  const mockPresenceData = {
    counts: { total: 3, online: 1, away: 1, offline: 1 },
    users: [
      {
        id: 1,
        fullname: 'Alice Admin',
        username: 'alice',
        email: 'alice@thelab.id',
        role: 'Admin',
        status: 'online',
        currentPage: 'schedule',
        lastSeenAt: new Date().toISOString(),
      },
      {
        id: 2,
        fullname: 'Bob Coach',
        username: 'bob',
        email: 'bob@thelab.id',
        role: 'Instructor',
        status: 'away',
        currentPage: 'students',
        lastSeenAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
      {
        id: 3,
        fullname: 'Charlie Staff',
        username: 'charlie',
        email: 'charlie@thelab.id',
        role: 'EC',
        status: 'offline',
        currentPage: '',
        lastSeenAt: null,
      },
    ],
  };

  it('renders title, filter counts, and user cards', () => {
    render(
      <TeamPresenceDropdown
        presenceData={mockPresenceData}
        currentUser={{ email: 'alice@thelab.id' }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Team Presence')).toBeInTheDocument();
    expect(screen.getByText('All (3)')).toBeInTheDocument();
    expect(screen.getByText('Online (1)')).toBeInTheDocument();
    expect(screen.getByText('Away (1)')).toBeInTheDocument();
    expect(screen.getByText('Offline (1)')).toBeInTheDocument();

    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Coach')).toBeInTheDocument();
    expect(screen.getByText('Charlie Staff')).toBeInTheDocument();
  });

  it('filters users by status tab when clicked', () => {
    render(
      <TeamPresenceDropdown
        presenceData={mockPresenceData}
        currentUser={{ email: 'alice@thelab.id' }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    // Click Online filter tab
    fireEvent.click(screen.getByText('Online (1)'));
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.queryByText('Bob Coach')).not.toBeInTheDocument();
    expect(screen.queryByText('Charlie Staff')).not.toBeInTheDocument();

    // Click Away filter tab
    fireEvent.click(screen.getByText('Away (1)'));
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Coach')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Staff')).not.toBeInTheDocument();

    // Click Offline filter tab
    fireEvent.click(screen.getByText('Offline (1)'));
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Coach')).not.toBeInTheDocument();
    expect(screen.getByText('Charlie Staff')).toBeInTheDocument();
  });

  it('searches users by name or role keyword', () => {
    render(
      <TeamPresenceDropdown
        presenceData={mockPresenceData}
        currentUser={{ email: 'alice@thelab.id' }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search member or role...');
    fireEvent.change(searchInput, { target: { value: 'Instructor' } });

    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Coach')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Staff')).not.toBeInTheDocument();
  });
});
