import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAllInternalMeetings,
  createInternalMeeting,
  updateInternalMeeting,
  deleteInternalMeeting,
  predictTeacherConflicts
} from '../internalMeetingService';

describe('internalMeetingService API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches all meetings successfully', async () => {
    const mockData = [{ id: 1, title: 'Weekly Briefing', day: 'Monday' }];
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await getAllInternalMeetings({ branch: 'Bekasi' });
    expect(fetch).toHaveBeenCalledWith('/api/new/meetings?branch=Bekasi');
    expect(result).toEqual(mockData);
  });

  it('creates a new meeting successfully', async () => {
    const meetingPayload = { title: 'Curriculum Sync', meetingDate: '2026-08-10', day: 'Monday', time: '01.00-02.30pm', branchName: 'Bekasi' };
    const createdMeeting = { id: 10, ...meetingPayload };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createdMeeting,
    });

    const result = await createInternalMeeting(meetingPayload);
    expect(fetch).toHaveBeenCalledWith('/api/new/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meetingPayload),
    });
    expect(result).toEqual(createdMeeting);
  });

  it('updates an existing meeting successfully', async () => {
    const updates = { status: 'Completed' };
    const updatedMeeting = { id: 10, title: 'Curriculum Sync', status: 'Completed' };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => updatedMeeting,
    });

    const result = await updateInternalMeeting(10, updates);
    expect(fetch).toHaveBeenCalledWith('/api/new/meetings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 10, ...updates }),
    });
    expect(result).toEqual(updatedMeeting);
  });

  it('deletes a meeting successfully', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await deleteInternalMeeting(10);
    expect(fetch).toHaveBeenCalledWith('/api/new/meetings?id=10', {
      method: 'DELETE',
    });
    expect(result).toEqual({ success: true });
  });

  it('predicts teacher schedule conflicts successfully', async () => {
    const payload = { day: 'Monday', meetingDate: '2026-08-10', time: '01.00-02.30pm', teacherNames: ['Supandi', 'Anya'] };
    const mockPrediction = {
      day: 'Monday',
      meetingDate: '2026-08-10',
      time: '01.00-02.30pm',
      predictions: [
        { name: 'Supandi', status: 'available', available: true },
        { name: 'Anya', status: 'busy_class', available: false, details: 'Teaching class' }
      ]
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPrediction,
    });

    const result = await predictTeacherConflicts(payload);
    expect(fetch).toHaveBeenCalledWith('/api/new/meetings/predict-conflicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(result).toEqual(mockPrediction);
  });

  it('throws error when server responds with non-ok status', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Database error' }),
    });

    await expect(getAllInternalMeetings()).rejects.toThrow('Database error');
  });
});
