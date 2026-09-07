// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoUpdate } from '../useAutoUpdate';

describe('useAutoUpdate hook', () => {
  let originalLocation;
  let reloadMock;
  let unregisterMock;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    // Mock window.location.reload
    originalLocation = window.location;
    reloadMock = vi.fn();
    delete window.location;
    window.location = {
      ...originalLocation,
      reload: reloadMock,
      href: 'http://localhost:3000/',
    };

    // Mock serviceWorker
    unregisterMock = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: vi.fn().mockResolvedValue([{ unregister: unregisterMock }]),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.restoreAllMocks();
  });

  it('unregisters active service workers on mount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildId: 'build-1', serverBootTime: 1000 }),
    });

    renderHook(() => useAutoUpdate());

    await act(async () => {
      await Promise.resolve();
    });

    expect(navigator.serviceWorker.getRegistrations).toHaveBeenCalled();
    expect(unregisterMock).toHaveBeenCalled();
  });

  it('records initial baseline on mount and does not reload if buildId is unchanged', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildId: 'build-1', serverBootTime: 1000 }),
    });

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await Promise.resolve();
    });

    expect(reloadMock).not.toHaveBeenCalled();

    // Subsequent check with same build ID
    await act(async () => {
      await result.current.checkVersion();
    });

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('triggers silent reload when buildId changes', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          buildId: callCount === 1 ? 'build-1' : 'build-2',
          serverBootTime: 1000,
        }),
      });
    });

    const { result } = renderHook(() => useAutoUpdate());

    // Initial check (build-1)
    await act(async () => {
      await Promise.resolve();
    });
    expect(reloadMock).not.toHaveBeenCalled();

    // Check version again (build-2)
    await act(async () => {
      await result.current.checkVersion();
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('triggers silent reload when serverBootTime changes', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          buildId: 'build-1',
          serverBootTime: callCount === 1 ? 1000 : 2000,
        }),
      });
    });

    const { result } = renderHook(() => useAutoUpdate());

    // Initial check
    await act(async () => {
      await Promise.resolve();
    });
    expect(reloadMock).not.toHaveBeenCalled();

    // Check version again with rebooted server
    await act(async () => {
      await result.current.checkVersion();
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('defers reload if an input is currently active, and reloads upon focusout', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          buildId: callCount === 1 ? 'build-1' : 'build-2',
          serverBootTime: 1000,
        }),
      });
    });

    // Create and focus an input element
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await Promise.resolve();
    });

    // Check version while input is focused
    await act(async () => {
      await result.current.checkVersion();
    });

    // Should NOT have reloaded immediately
    expect(reloadMock).not.toHaveBeenCalled();

    // Now blur the input (triggering focusout)
    act(() => {
      window.dispatchEvent(new Event('focusout'));
    });

    // Now it should have reloaded!
    expect(reloadMock).toHaveBeenCalledTimes(1);

    document.body.removeChild(input);
  });

  it('automatically triggers reload on ChunkLoadError', () => {
    renderHook(() => useAutoUpdate());

    act(() => {
      const errorEvent = new ErrorEvent('error', {
        message: 'Loading chunk 1234 failed.',
      });
      window.dispatchEvent(errorEvent);
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
