// @vitest-environment jsdom
// This file mounts a provider that renders an overlay, so it opts in to a DOM.
// The suite default is `node` (vitest.config.mjs) because building jsdom per
// file is the single largest fixed cost in the run.
/**
 * Unit tests for TourProvider's `ops-sunset` behaviour.
 *
 * `chooseAutoTour` is already covered as a pure function in
 * `src/lib/__tests__/tour.property.test.js`. What no test of that function can
 * see is the wiring around it: the 900ms settle, the once-per-session cap, the
 * seen-state writes, the stop-on-navigation rule, and what GuidedTour does when
 * some of the three anchors are missing from the page. That is what this file
 * asserts, through the rendered output only.
 *
 * Req 6.7  — a `past` phase offers no automatic sunset tour.
 * Req 7.5  — all four conditions met: the tour starts after the 900ms settle.
 * Req 7.6  — a collapsed sidebar offers no automatic sunset tour.
 * Req 7.7  — seen, `opsMode: 'new'` or `past`: no tour, nothing touched.
 * Req 7.8  — at most one automatic tour per session, whatever changes after.
 * Req 7.9  — the manual start ignores the settle and the seen state.
 * Req 7.10 — leaving at any step marks the tour seen at version 1.
 * Req 7.11 — one or two absent anchors: run and count the present steps only.
 * Req 7.12 — a page change mid-tour stops it and leaves the seen state alone.
 * Req 7.13 — unreadable storage: no automatic tour, manual start still runs.
 * Req 7.14 — completing the last present step marks the tour seen.
 * Req 7.15 — no anchor present: no overlay, seen state untouched.
 *
 * Real localStorage is used rather than a stub, because the provider reaches for
 * `window.localStorage` itself and the seen key is part of what is under test.
 */

import React from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
// Unmounting between tests is handled globally by vitest.setup.js.
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';

import TourProvider, { useTour } from '@/components/tour/TourProvider';
import { TOURS } from '@/lib/tourSteps';
import { tourStorageKey } from '@/lib/tour';

/* ----------------------------------------------------------------- fixtures */

/** The provider's own settle delay. Kept as a literal so a change is visible. */
const SETTLE_MS = 900;

const SUNSET = TOURS['ops-sunset'];
const WELCOME_KEY = tourStorageKey('welcome');
const SUNSET_KEY = tourStorageKey('ops-sunset');

/** The three anchors the sunset tour points at, in registered order. */
const ALL_ANCHORS = ['sunset-banner', 'ops-switcher', 'sidebar-nav'];

function Anchors({ anchors }) {
  return anchors.map((name) => <div key={name} data-tour={name}>{name}</div>);
}

/** Stands in for the banner's button: a manual `start`, from inside the tree. */
function ShowMeButton() {
  const { start } = useTour();
  return (
    <button type="button" onClick={() => start('ops-sunset')}>
      Show me New Operations
    </button>
  );
}

/**
 * The provider with the four inputs the sunset rule reads, plus two readouts of
 * the state the provider must not touch: `opsMode` and the sidebar.
 */
function Shell({
  page = 'dashboard',
  opsMode = 'old',
  sunsetLive = true,
  sidebarCollapsed = false,
  anchors = ALL_ANCHORS,
}) {
  return (
    <TourProvider
      page={page}
      opsMode={opsMode}
      sunsetLive={sunsetLive}
      sidebarCollapsed={sidebarCollapsed}
    >
      <div data-testid="ops-mode">{opsMode}</div>
      <div data-testid="sidebar">{sidebarCollapsed ? 'collapsed' : 'expanded'}</div>
      <Anchors anchors={anchors} />
      <ShowMeButton />
    </TourProvider>
  );
}

/* ------------------------------------------------------------------ helpers */

function mount(props = {}) {
  const view = render(<Shell {...props} />);
  return {
    ...view,
    /** Re-render with some props changed, the rest held. */
    update: (next) => view.rerender(<Shell {...props} {...next} />),
  };
}

/** Let the provider's settle elapse. */
function settle(extra = 0) {
  act(() => { vi.advanceTimersByTime(SETTLE_MS + extra); });
}

const overlay = () => screen.queryByRole('dialog');
const seen = () => window.localStorage.getItem(SUNSET_KEY);
const leave = () => fireEvent.click(screen.getByRole('button', { name: /leave the tour/i }));
const next = () => fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
const done = () => fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
const showMe = () => fireEvent.click(screen.getByRole('button', { name: /show me new operations/i }));

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  // Welcome always wins while it is unseen, so every sunset case starts from a
  // session where it has already been taken.
  window.localStorage.setItem(WELCOME_KEY, String(TOURS.welcome.version));
  // jsdom implements neither of these; GuidedTour calls both on every step.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

/* -------------------------------------------------------------------- tests */

describe('TourProvider: offering the sunset tour automatically', () => {
  it('starts the sunset tour once the 900ms settle has elapsed', () => {
    mount();

    // Nothing before the settle: the anchors may still be moving. Req 7.5
    expect(overlay()).toBeNull();
    act(() => { vi.advanceTimersByTime(SETTLE_MS - 1); });
    expect(overlay()).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });

    expect(overlay()).toBeInTheDocument();
    expect(screen.getByText(SUNSET.steps[0].title)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(SUNSET.title))).toBeInTheDocument();
  });

  it.each([
    ['the sidebar is collapsed', { sidebarCollapsed: true }, null],
    ['the sunset tour has already been seen at version 1', {}, '1'],
    ['opsMode is new', { opsMode: 'new' }, null],
    ['the phase is past', { sunsetLive: false }, null],
  ])('offers no automatic tour when %s, and touches nothing', (_name, props, preSeen) => {
    if (preSeen !== null) window.localStorage.setItem(SUNSET_KEY, preSeen);

    mount(props);
    settle(5000);

    // No tour, and neither the seen state nor the sidebar moved. Req 6.7, 7.6, 7.7
    expect(overlay()).toBeNull();
    expect(seen()).toBe(preSeen);
    expect(screen.getByTestId('sidebar')).toHaveTextContent(
      props.sidebarCollapsed ? 'collapsed' : 'expanded'
    );
    expect(screen.getByTestId('ops-mode')).toHaveTextContent(props.opsMode || 'old');
  });

  it('starts no second automatic tour after page, opsMode, sidebar and phase changes', () => {
    const { update } = mount();
    settle();
    expect(overlay()).toBeInTheDocument();

    leave();
    expect(overlay()).toBeNull();

    // Forget the tour, so only the once-per-session cap can hold it back. Req 7.8
    window.localStorage.removeItem(SUNSET_KEY);

    const changes = [
      { page: 'schedule' },
      { page: 'schedule', opsMode: 'new' },
      { page: 'schedule', opsMode: 'old', sidebarCollapsed: true },
      { page: 'schedule', opsMode: 'old', sidebarCollapsed: false },
      { page: 'students', opsMode: 'old', sunsetLive: false },
      { page: 'students', opsMode: 'old', sunsetLive: true },
    ];
    for (const change of changes) {
      update(change);
      settle(5000);
      expect(overlay()).toBeNull();
    }
    expect(seen()).toBeNull();
  });

  it('offers no automatic tour when the seen state cannot be read, but still starts on request', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    mount();
    settle(5000);

    // Unreadable storage is not "unseen": guess nothing. Req 7.13
    expect(overlay()).toBeNull();

    showMe();

    // The invited path still works, with no settle delay. Req 7.9, 7.13
    expect(overlay()).toBeInTheDocument();
    expect(screen.getByText(SUNSET.steps[0].title)).toBeInTheDocument();
    expect(getItem).toHaveBeenCalled();
  });

  it.each([['unseen', null], ['already seen', '1']])(
    'starts on request immediately when the tour is %s',
    (_name, preSeen) => {
      if (preSeen !== null) window.localStorage.setItem(SUNSET_KEY, preSeen);
      // Welcome unseen too, so the manual start is shown to ignore precedence.
      window.localStorage.removeItem(WELCOME_KEY);

      mount();
      expect(overlay()).toBeNull();

      showMe();

      // No timer advanced: the manual start carries no SETTLE_MS. Req 7.9
      expect(overlay()).toBeInTheDocument();
      expect(screen.getByText(SUNSET.steps[0].title)).toBeInTheDocument();
    }
  );
});

describe('TourProvider: leaving and completing the sunset tour', () => {
  it.each([0, 1, 2])('leaving at step %i marks the tour seen at version 1', (stepIndex) => {
    expect(SUNSET.version).toBe(1);

    mount();
    settle();
    for (let i = 0; i < stepIndex; i += 1) next();
    expect(screen.getByText(`Step ${stepIndex + 1} of 3`)).toBeInTheDocument();

    leave();

    // Overlay gone, seen recorded, and neither owned state touched. Req 7.10
    expect(overlay()).toBeNull();
    expect(seen()).toBe('1');
    expect(screen.getByTestId('ops-mode')).toHaveTextContent('old');
    expect(screen.getByTestId('sidebar')).toHaveTextContent('expanded');
  });

  it('marks the tour seen at version 1 when the last step is completed', () => {
    mount();
    settle();

    next();
    next();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    done();

    // Req 7.14
    expect(overlay()).toBeNull();
    expect(seen()).toBe(String(SUNSET.version));
  });

  it('stops the running tour on a page change, leaving the seen state alone', () => {
    const { update } = mount();
    settle();
    expect(overlay()).toBeInTheDocument();

    update({ page: 'schedule' });

    // Stopped, not dismissed: the anchors are gone, but the tour was not taken.
    // Req 7.12
    expect(overlay()).toBeNull();
    expect(seen()).toBeNull();

    // And nothing replaces it for the rest of the session.
    settle(5000);
    expect(overlay()).toBeNull();
    expect(seen()).toBeNull();
  });

  it('stops the running tour on an opsMode change, leaving the seen state alone', () => {
    const { update } = mount();
    settle();
    expect(overlay()).toBeInTheDocument();

    update({ opsMode: 'new' });

    // Req 7.12
    expect(overlay()).toBeNull();
    expect(seen()).toBeNull();
    settle(5000);
    expect(overlay()).toBeNull();
  });
});

describe('TourProvider: sunset tour anchors that are not on the page', () => {
  it.each([
    ['the banner and the switcher are present', ['sunset-banner', 'ops-switcher'], [0, 1]],
    ['the switcher and the nav are present', ['ops-switcher', 'sidebar-nav'], [1, 2]],
    ['only the switcher is present', ['ops-switcher'], [1]],
    ['only the nav is present', ['sidebar-nav'], [2]],
  ])('runs %s, counting only the present steps', (_name, anchors, stepIndexes) => {
    mount({ anchors });
    settle();

    // The count is the number of present steps, and they keep their registered
    // relative order. Req 7.11
    for (let i = 0; i < stepIndexes.length; i += 1) {
      expect(screen.getByText(`Step ${i + 1} of ${stepIndexes.length}`)).toBeInTheDocument();
      expect(screen.getByText(SUNSET.steps[stepIndexes[i]].title)).toBeInTheDocument();
      if (i < stepIndexes.length - 1) next();
    }

    // The last present step is the end of the tour, not step 3 of 3.
    expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument();
    done();
    expect(overlay()).toBeNull();
    expect(seen()).toBe('1');
  });

  it('renders no overlay when none of the three anchors is present', () => {
    mount({ anchors: [] });
    settle(5000);

    // Nothing to point at, so nothing is shown and the tour is still owed.
    // Req 7.15
    expect(overlay()).toBeNull();
    expect(document.querySelector('.tour-root')).toBeNull();
    expect(seen()).toBeNull();
  });
});
