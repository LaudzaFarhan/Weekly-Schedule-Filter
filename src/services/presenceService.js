/**
 * Client service for tracking and querying user presence (Online, Away, Offline).
 */

/**
 * Fetch all users with their live presence state.
 */
export async function getPresenceUsers() {
  const res = await fetch('/api/new/presence', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch presence: ${res.status}`);
  }
  return res.json();
}

/**
 * Send heartbeat / status update for current user.
 */
export async function sendHeartbeat(payload) {
  if (!payload?.email) return null;
  try {
    const res = await fetch('/api/new/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Subscribe to presence updates with periodic polling.
 */
export function subscribeToPresence(callback, onError, intervalMs = 15000) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getPresenceUsers();
      if (active && callback) callback(data);
    } catch (err) {
      if (active && onError) onError(err);
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);

  return () => {
    active = false;
    clearInterval(timer);
  };
}

/**
 * Setup automatic heartbeat and activity tracker for logged-in user.
 */
export function startPresenceTracker(user, getCurrentPage, getProfile) {
  if (!user) return () => {};

  const email = user.email || user.username || '';
  if (!email || !email.includes('@')) return () => {};

  let currentStatus = 'online';
  let idleTimer = null;
  const hasWindow = typeof window !== 'undefined';

  const getPayload = (statusOverride) => {
    const profile = typeof getProfile === 'function' ? getProfile() : null;
    return {
      email,
      username: user.username || email.split('@')[0],
      fullname: profile?.fullname || profile?.nickname || user.fullname || user.displayName || email.split('@')[0],
      role: profile?.role || user.role || 'Instructor',
      status: statusOverride || currentStatus,
      currentPage: typeof getCurrentPage === 'function' ? getCurrentPage() : '',
    };
  };

  const ping = (statusOverride) => {
    const payload = getPayload(statusOverride);
    sendHeartbeat(payload);
  };

  const hasDocument = typeof document !== 'undefined';

  // Reset idle timer on user action
  const resetIdle = () => {
    if (currentStatus === 'away' && (!hasDocument || document.visibilityState === 'visible')) {
      currentStatus = 'online';
      ping('online');
    }
    if (idleTimer) clearTimeout(idleTimer);
    // After 5 minutes of inactivity, mark away
    idleTimer = setTimeout(() => {
      currentStatus = 'away';
      ping('away');
    }, 5 * 60 * 1000);
  };

  const handleVisibility = () => {
    if (!hasDocument) return;
    if (document.visibilityState === 'hidden') {
      currentStatus = 'away';
      ping('away');
    } else {
      currentStatus = 'online';
      ping('online');
      resetIdle();
    }
  };

  const handleUnload = () => {
    try {
      const payload = getPayload('offline');
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/new/presence', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      }
    } catch {}
  };

  // Initial heartbeat
  ping('online');
  resetIdle();

  // Periodic heartbeat every 30s
  const intervalTimer = setInterval(() => {
    ping();
  }, 30000);

  // Event listeners
  const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
  const handleActivity = () => resetIdle();
  if (hasWindow) {
    activityEvents.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
    window.addEventListener('beforeunload', handleUnload);
  }
  if (hasDocument) {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  return () => {
    clearInterval(intervalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (hasWindow) {
      activityEvents.forEach((ev) => window.removeEventListener(ev, handleActivity));
      window.removeEventListener('beforeunload', handleUnload);
    }
    if (hasDocument) {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
  };
}
