// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewUsersPage from '../NewUsersPage';

const mockShowToast = vi.fn();

vi.mock('@/contexts/ScheduleContext', () => ({
  useSchedule: () => ({
    rolePermissions: {},
    updateRolePermissions: vi.fn(),
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

describe('NewUsersPage Account Verification UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays verified and pending badges and allows verifying an unverified user', async () => {
    const usersData = [
      {
        id: 1,
        username: 'admin',
        email: 'admin@thelab.id',
        role: 'Admin',
        status: 'Active',
        isVerified: true,
        verifiedBy: 'System',
      },
      {
        id: 2,
        username: 'ahmad.muhajir',
        fullname: 'Ahmad Muhajir',
        email: 'muhajir.thelab@gmail.com',
        role: 'Instructor',
        status: 'Active',
        isVerified: false,
        verifiedBy: null,
      },
    ];

    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (url === '/api/new/users' && (!options || options.method === undefined)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ users: usersData, credentialKeyConfigured: true }),
        });
      }
      if (url === '/api/new/users' && options?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: { ...usersData[1], isVerified: true, verifiedBy: 'Admin' },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<NewUsersPage />);

    // Wait for the user table to load with data
    await waitFor(() => {
      expect(screen.getByText('ahmad.muhajir')).toBeInTheDocument();
    });

    // Check header counter shows 1 pending verification
    expect(screen.getByText(/1 pending verification/i)).toBeInTheDocument();
    expect(screen.getByText(/Verify all pending \(1\)/i)).toBeInTheDocument();

    // Check table rows show Verified and Pending pills
    expect(screen.getByText('Pending')).toBeInTheDocument();

    const rowVerifyButton = screen.getByTitle('Verify and approve this account so user can log in');
    expect(rowVerifyButton).toBeInTheDocument();

    fireEvent.click(rowVerifyButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/new/users',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ id: 2, isVerified: true }),
        })
      );
    });
  });
});
