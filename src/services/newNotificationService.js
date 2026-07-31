/**
 * Client for the New Operations notification feed (/api/new/notifications).
 *
 * Polled once a minute rather than every few seconds: these are things like
 * "students not allocated" that change on a human timescale, and the whole
 * point of computing them server-side was to keep this cheap.
 */

const API_PATH = '/api/new/notifications';
const POLL_MS = 60000;
const DISMISS_KEY = 'newOpsDismissedNotifications';

export async function getNotifications() {
  const res = await fetch(API_PATH);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load notifications');
  }
  return await res.json();
}

/** Subscribe via polling. Returns an unsubscribe function. */
export function subscribeToNotifications(callback, onError) {
  let active = true;

  const poll = async () => {
    try {
      const data = await getNotifications();
      if (active) callback(data);
    } catch (error) {
      if (active && onError) onError(error);
    }
  };

  poll();
  const interval = setInterval(poll, POLL_MS);

  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Dismissed ids, scoped to the day they were dismissed on.
 *
 * Scoping by date means "3 trials tomorrow" reappears tomorrow rather than
 * staying hidden forever, while dismissing it today stays dismissed.
 */
export function readDismissed() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function dismissNotification(id, today) {
  if (typeof window === 'undefined') return {};
  const next = { ...readDismissed(), [id]: today };
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — the badge just won't persist its dismissal */
  }
  return next;
}

export function dismissAll(items, today) {
  if (typeof window === 'undefined') return {};
  const next = { ...readDismissed() };
  for (const item of items || []) next[item.id] = today;
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* ignored, see above */
  }
  return next;
}

/** Items not dismissed for the day the feed was generated. */
export function visibleItems(feed, dismissed) {
  const today = feed?.today;
  return (feed?.items || []).filter((i) => dismissed[i.id] !== today);
}
