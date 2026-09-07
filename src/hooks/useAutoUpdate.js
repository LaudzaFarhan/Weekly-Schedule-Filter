'use client';

import { useEffect, useRef, useCallback } from 'react';

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const CHUNK_RELOAD_COOLDOWN_MS = 15 * 1000; // 15 seconds loop guard

/**
 * Hook to automatically and silently refresh the page when an update is deployed,
 * or when a Next.js chunk load error is encountered after a new deployment.
 */
export function useAutoUpdate() {
  const initialBuildIdRef = useRef(null);
  const initialBootTimeRef = useRef(null);
  const pendingReloadRef = useRef(false);
  const checkingRef = useRef(false);

  // Unregister any ghost service workers that could intercept requests
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          reg.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
  }, []);

  // Safe silent reload handler
  const performSilentReload = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Check if user is currently typing in an input, textarea, or select
    const activeEl = document.activeElement;
    const isTyping = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );

    // Check if any modal is currently open
    const isModalOpen = Boolean(
      document.querySelector('.modal-overlay, [role="dialog"], .modal-dialog, .modal-backdrop')
    );

    if (isTyping || isModalOpen) {
      pendingReloadRef.current = true;
      // Wait until user blurs or closes
      const handleUserBlur = () => {
        if (pendingReloadRef.current) {
          pendingReloadRef.current = false;
          window.location.reload();
        }
      };
      window.addEventListener('focusout', handleUserBlur, { once: true });
      return;
    }

    // Safe to reload immediately
    window.location.reload();
  }, []);

  // Fetch current server version and compare against initial values
  const checkVersion = useCallback(async () => {
    if (checkingRef.current || typeof window === 'undefined') return;
    checkingRef.current = true;

    try {
      const res = await fetch('/api/version', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
      });

      if (!res.ok) return;
      const data = await res.json();
      if (!data) return;

      if (!initialBuildIdRef.current) {
        // Record initial baseline upon first check
        initialBuildIdRef.current = data.buildId;
        initialBootTimeRef.current = data.serverBootTime;
        return;
      }

      // Check if build ID changed or server rebooted with a new build
      const buildChanged = data.buildId && initialBuildIdRef.current && data.buildId !== initialBuildIdRef.current;
      const serverRebooted = data.serverBootTime && initialBootTimeRef.current && data.serverBootTime !== initialBootTimeRef.current;

      if (buildChanged || serverRebooted) {
        performSilentReload();
      }
    } catch {
      // Ignore network errors during offline or transient failures
    } finally {
      checkingRef.current = false;
    }
  }, [performSilentReload]);

  // Initial check and periodic background check
  useEffect(() => {
    checkVersion();

    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);

    // Check when user returns to or focuses the window/tab
    const handleFocus = () => checkVersion();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkVersion]);

  // Global listener for ChunkLoadError / dynamic import failures
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const triggerChunkReload = () => {
      try {
        const lastReload = Number(sessionStorage.getItem('pulse_chunk_reload_ts') || '0');
        const now = Date.now();
        if (now - lastReload > CHUNK_RELOAD_COOLDOWN_MS) {
          sessionStorage.setItem('pulse_chunk_reload_ts', String(now));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    };

    const handleGlobalError = (event) => {
      const msg = event?.message || '';
      if (/Loading chunk [\d\w]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg)) {
        triggerChunkReload();
      }
    };

    const handleUnhandledRejection = (event) => {
      const reasonMsg = event?.reason?.message || String(event?.reason || '');
      if (/Loading chunk [\d\w]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(reasonMsg)) {
        triggerChunkReload();
      }
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return { checkVersion, performSilentReload };
}
