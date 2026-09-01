import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPresenceUsers,
  sendHeartbeat,
  subscribeToPresence,
  startPresenceTracker,
} from '../presenceService';

describe('presenceService API client and activity tracker', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetches presence users from /api/new/presence', async () => {
    const mockData = {
      counts: { total: 2, online: 1, away: 0, offline: 1 },
      users: [
        { id: 1, email: 'admin@thelab.id', status: 'online' },
        { id: 2, email: 'coach@thelab.id', status: 'offline' },
      ],
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await getPresenceUsers();
    expect(fetch).toHaveBeenCalledWith('/api/new/presence', expect.any(Object));
    expect(result).toEqual(mockData);
  });

  it('throws error when fetching presence fails with non-ok response', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Database unavailable' }),
    });

    await expect(getPresenceUsers()).rejects.toThrow('Database unavailable');
  });

  it('sends heartbeat payload to /api/new/presence', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const payload = {
      email: 'teacher@thelab.id',
      username: 'teacher',
      status: 'online',
      currentPage: 'schedule',
    };

    const res = await sendHeartbeat(payload);
    expect(fetch).toHaveBeenCalledWith('/api/new/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res).toEqual({ ok: true });
  });

  it('subscribes to presence updates and polls at configured intervals', async () => {
    const mockData = { counts: { total: 1, online: 1, away: 0, offline: 0 }, users: [] };
    fetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const callback = vi.fn();
    const unsub = subscribeToPresence(callback, vi.fn(), 1000);

    // First immediate call
    expect(fetch).toHaveBeenCalledTimes(1);

    // Fast-forward 1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);

    unsub();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('starts presence tracker and sends initial online heartbeat', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const user = { email: 'alice@thelab.id', username: 'alice', role: 'Instructor' };
    const cleanup = startPresenceTracker(user, () => 'schedule');

    expect(fetch).toHaveBeenCalledWith('/api/new/presence', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('alice@thelab.id'),
    }));

    cleanup();
  });
});
