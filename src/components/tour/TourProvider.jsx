'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import GuidedTour from './GuidedTour';
import { TOURS, tourForPage } from '@/lib/tourSteps';
import { chooseAutoTour, hasSeenTour, markTourSeen, tourStorageKey } from '@/lib/tour';

/**
 * How long to wait after a page swap before offering a tour. Long enough for
 * data to arrive and panels to settle, so the first step does not point at a
 * loading spinner that is about to be replaced.
 */
const SETTLE_MS = 900;

const TourContext = createContext(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside a TourProvider');
  return ctx;
}

/** localStorage, or null where it is unavailable (SSR, private mode lockdowns). */
function safeStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Seen state for one tour, read without the swallowing that `hasSeenTour` does.
 *
 * The automatic offer needs to tell "not seen" from "cannot read storage": the
 * first should offer a tour, the second should offer nothing at all. So a
 * storage failure is left to throw here and handled by the caller.
 */
function readSeen(tourId, storage) {
  const tour = TOURS[tourId];
  if (!tour) return true;
  return storage.getItem(tourStorageKey(tourId)) === String(tour.version);
}

/**
 * Owns which tour is running.
 *
 * The welcome tour runs itself once, because someone who does not understand the
 * app will not go looking for a help button. Per-page tours do not auto-run —
 * being interrupted on every new screen is its own kind of confusing — but the
 * help button glows while the current page has one you have not seen, so it is
 * still discoverable.
 *
 * `sunsetLive` and `sidebarCollapsed` feed the automatic offer only: they decide
 * whether the `ops-sunset` tour is worth running, never whether it can be run by
 * hand from the banner's button.
 */
export default function TourProvider({
  children, page, opsMode, sunsetLive = false, sidebarCollapsed = false, onNavigate,
}) {
  const [activeId, setActiveId] = useState(null);
  const storage = useMemo(safeStorage, []);

  // Bumped whenever a tour is recorded as seen, purely so `pageTourSeen` below
  // recomputes — localStorage is not reactive.
  const [seenTick, setSeenTick] = useState(0);

  // Guards the auto-start so it cannot fire twice in one session, even if the
  // page settles more than once.
  const autoStarted = useRef(false);

  const pageTour = useMemo(() => tourForPage(page), [page]);

  const start = useCallback((tourId) => {
    if (TOURS[tourId]) setActiveId(tourId);
  }, []);

  /** Start the tour for whichever page is showing, or the welcome tour. */
  const startForCurrentPage = useCallback(() => {
    setActiveId(pageTour?.id || 'welcome');
  }, [pageTour]);

  const stop = useCallback(() => setActiveId(null), []);

  /**
   * Leaving early still counts as seen. Someone who dismissed a tour does not
   * want it again next login — the help button is there if they change their
   * mind, and re-offering it would be nagging.
   */
  const dismiss = useCallback(() => {
    if (activeId && TOURS[activeId]) {
      markTourSeen(activeId, TOURS[activeId].version, storage);
      setSeenTick((n) => n + 1);
    }
    setActiveId(null);
  }, [activeId, storage]);

  const complete = useCallback(() => {
    if (activeId && TOURS[activeId]) {
      markTourSeen(activeId, TOURS[activeId].version, storage);
      setSeenTick((n) => n + 1);
    }
    setActiveId(null);
  }, [activeId, storage]);

  // Offer one tour automatically, once the app has settled. `chooseAutoTour`
  // holds the whole precedence rule, so welcome and ops-sunset cannot race:
  // there is one decision, taken in one place.
  useEffect(() => {
    if (autoStarted.current || !storage) return undefined;

    let choice = null;
    try {
      choice = chooseAutoTour({
        welcomeSeen: readSeen('welcome', storage),
        sunsetSeen: readSeen('ops-sunset', storage),
        opsMode,
        sidebarCollapsed,
        sunsetLive,
      });
    } catch {
      // Unreadable storage: offer nothing rather than guess. The help button and
      // the banner's button still start tours on request.
      return undefined;
    }
    if (!choice) return undefined;

    autoStarted.current = true;
    const timer = setTimeout(() => {
      start(choice);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [storage, opsMode, sidebarCollapsed, sunsetLive, start]);

  // A tour is written against one screen. If the page changes underneath it —
  // a notification link, browser back — the anchors are gone, so stop rather
  // than spotlight the wrong thing.
  const startedOn = useRef({ page, opsMode });
  useEffect(() => {
    if (!activeId) {
      startedOn.current = { page, opsMode };
      return;
    }
    if (startedOn.current.page !== page || startedOn.current.opsMode !== opsMode) {
      setActiveId(null);
      startedOn.current = { page, opsMode };
    }
  }, [page, opsMode, activeId]);

  const pageTourSeen = useMemo(
    () => (pageTour ? hasSeenTour(pageTour.id, pageTour.version, storage) : true),
    [pageTour, storage, seenTick]
  );

  const value = useMemo(() => ({
    activeId,
    start,
    startForCurrentPage,
    stop,
    /** Is there an unseen tour for the page showing right now? */
    hasUnseenPageTour: Boolean(pageTour) && !pageTourSeen,
    pageTourTitle: pageTour?.title || null,
  }), [activeId, start, startForCurrentPage, stop, pageTour, pageTourSeen]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {activeId && TOURS[activeId] && (
        <GuidedTour
          key={activeId}
          tour={TOURS[activeId]}
          onClose={dismiss}
          onFinish={complete}
          onNavigate={onNavigate}
        />
      )}
    </TourContext.Provider>
  );
}
