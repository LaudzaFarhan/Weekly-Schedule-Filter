import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getIssues,
  getIssueById,
  createIssue,
  updateIssue,
  deleteIssue,
  getComments,
  addComment,
  captureEnvironmentInfo,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  ISSUE_MODULES
} from '../qaTrackerService';

describe('qaTrackerService API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports valid constants for statuses, types, priorities, and modules', () => {
    expect(ISSUE_STATUSES).toContain('Open');
    expect(ISSUE_STATUSES).toContain('Ready for QA');
    expect(ISSUE_STATUSES).toContain('Resolved');
    expect(ISSUE_TYPES).toContain('Bug');
    expect(ISSUE_TYPES).toContain('QA Update');
    expect(ISSUE_PRIORITIES).toContain('Critical');
    expect(ISSUE_MODULES).toContain('Schedule');
  });

  it('fetches issues with query parameters', async () => {
    const mockIssues = [{ id: 1, title: 'Bug in schedule', status: 'Open' }];
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockIssues,
    });

    const result = await getIssues({ status: 'Open', priority: 'High', search: 'grid' });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/new/qa-tracker?'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('status=Open'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('priority=High'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('search=grid'));
    expect(result).toEqual(mockIssues);
  });

  it('fetches single issue by ID', async () => {
    const mockIssue = { id: 5, title: 'Login fails on Safari', type: 'Bug' };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockIssue,
    });

    const result = await getIssueById(5);
    expect(fetch).toHaveBeenCalledWith('/api/new/qa-tracker?id=5');
    expect(result).toEqual(mockIssue);
  });

  it('creates an issue with attachments and environment', async () => {
    const payload = {
      title: 'Missing student count',
      description: 'The student count does not update after adding replacement',
      type: 'Bug',
      priority: 'High',
      attachments: [{ id: 'img_1', url: 'data:image/jpeg;base64,...', annotated: true }]
    };
    const created = { id: 12, ...payload };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    const result = await createIssue(payload);
    expect(fetch).toHaveBeenCalledWith('/api/new/qa-tracker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    expect(result).toEqual(created);
  });

  it('updates an issue status and details', async () => {
    const updates = { status: 'Ready for QA' };
    const updated = { id: 12, title: 'Missing student count', status: 'Ready for QA' };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => updated,
    });

    const result = await updateIssue(12, updates);
    expect(fetch).toHaveBeenCalledWith('/api/new/qa-tracker?id=12', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    expect(result).toEqual(updated);
  });

  it('deletes an issue', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, deletedId: '12' }),
    });

    const result = await deleteIssue(12);
    expect(fetch).toHaveBeenCalledWith('/api/new/qa-tracker?id=12', {
      method: 'DELETE'
    });
    expect(result).toEqual({ success: true, deletedId: '12' });
  });

  it('fetches comments for an issue', async () => {
    const mockComments = [{ id: 1, issueId: 12, comment: 'Retested and verified on Chrome' }];
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockComments,
    });

    const result = await getComments(12);
    expect(fetch).toHaveBeenCalledWith('/api/new/qa-tracker/12/comments');
    expect(result).toEqual(mockComments);
  });

  it('posts a comment to an issue', async () => {
    const commentPayload = { comment: 'Fixed in staging build #44', userName: 'Dev Lead' };
    const mockComment = { id: 2, issueId: 12, ...commentPayload };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockComment,
    });

    const result = await addComment(12, commentPayload);
    expect(fetch).toHaveBeenCalledWith('/api/new/qa-tracker/12/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commentPayload)
    });
    expect(result).toEqual(mockComment);
  });

  it('captures client environment info', () => {
    const env = captureEnvironmentInfo();
    expect(env).toBeDefined();
    expect(typeof env.browser).toBe('string');
    expect(typeof env.os).toBe('string');
  });

  it('handles server errors gracefully', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Database connection failed' }),
    });

    await expect(getIssues()).rejects.toThrow('Database connection failed');
  });
});
