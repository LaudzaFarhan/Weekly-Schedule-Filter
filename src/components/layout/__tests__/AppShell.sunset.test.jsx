// @vitest-environment jsdom
// This file renders the whole shell, so it opts in to a DOM. The suite default
// is `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Integration tests for the sunset notice inside `AppShell`.
 *
 * Every unit in this feature is already covered on its own: the arithmetic in
 * `src/lib/__tests__/opsSunset.*`, the banner in
 * `src/components/ops/__tests__/OpsSunsetBanner.*`, the hook in
 * `useSunsetNotice.test.jsx`, the badge in `Sidebar.sunsetBadge.test.jsx` and the
 * tour in `TourProvider.sunset.test.jsx`. What none of them can see is the wiring:
 * where the banner lands in the layout, that it is one mount rather than one per
 * page, that the shell computes nothing at all in New Operations, and that a
 * dismissal, an escalation or the deadline itself all survive a navigation and a
 * reload. That is what this file asserts, through the rendered document only.
 *
 * Req 3.13 — the same enabled controls in every phase; only the copy varies.
 * Req 4.1  — Header, banner, `.dashboard-views` in that order inside
 *            `main.dashboard-container`, the banner outside both.
 * Req 4.3  — exactly one `[data-tour="sunset-banner"]`, whichever page is active.
 * Req 4.9  — zero banner elements while `opsMode` is `'new'`, on every page.
 * Req 4.10 — a switch from `'new'` to `'old'` mounts the banner with no reload.
 * Req 5.5  — a dismissal of the phase on screen hides the notice, and keeps it
 *            hidden on a later day within the same phase.
 * Req 5.6  — escalation re-surfaces a notice dismissed in the previous phase.
 * Req 5.11 — no dismiss button in `final` or `past`.
 * Req 6.3  — `final` and `past` render on every page, after navigation and after
 *            a reload, whatever record is in storage.
 * Req 6.4  — both halves of the switcher still change `opsMode` on one press.
 * Req 6.5  — no disabled control and no extra confirmation appears in `past`.
 * Req 6.9  — crossing out of the deadline's own WIB day replaces `final` with
 *            `past` on the next render, with no reload.
 * Req 6.10 — no redirect and no `opsMode` change on an Old Operations page.
 * Req 8.1  — the badge is on screen only while the notice is: absent in New
 *            Operations and absent once the notice has been dismissed.
 * Req 13.6 — no request and no date arithmetic while `opsMode` is `'new'`.
 * Req 13.8 — the rest of the interface stays rendered and navigable throughout.
 *
 * The clock is driven with `vi.setSystemTime`, so every phase in here is a fixed
 * instant rather than a function of when the suite runs, and a "reload" is an
 * unmount followed by a fresh mount at the same URL — which is what a reload is,
 * from the shell's point of view, with `localStorage` carried across.
 *
 * `AppShell` pulls in every page component, three contexts and the header, so all
 * of those are replaced by stubs: the subject is the shell's own layout and
 * wiring, and a real page would drag the data layer in behind it. What is left
 * real is everything the notice runs through — `AppShell`, `Sidebar`,
 * `OpsSunsetBanner`, `useSunsetNotice` and `opsSunset` itself.
 */

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
// Unmounting between tests is handled globally by vitest.setup.js.
import { act, fireEvent, render } from '@testing-library/react';

/* ------------------------------------------------------------------- mocks */

/**
 * `sunsetNotice` and `daysUntilSunset` wrapped in spies over the real
 * implementations, so "performs no date arithmetic" (Req 13.6) is an assertion
 * rather than an inference. Behaviour is untouched: every call still runs the
 * module's own code.
 */
const arithmetic = vi.hoisted(() => ({
  sunsetNotice: vi.fn(),
  daysUntilSunset: vi.fn(),
}));

vi.mock('@/lib/opsSunset', async (importOriginal) => {
  const actual = await importOriginal();
  arithmetic.sunsetNotice.mockImplementation(actual.sunsetNotice);
  arithmetic.daysUntilSunset.mockImplementation(actual.daysUntilSunset);
  return {
    ...actual,
    sunsetNotice: arithmetic.sunsetNotice,
    daysUntilSunset: arithmetic.daysUntilSunset,
  };
});

/** A page component that renders its name and nothing else. */
const pageStub = vi.hoisted(() => (name) => async () => {
  const { createElement } = await import('react');
  return {
    default: () => createElement(
      'div',
      { 'data-testid': 'page', 'data-page': name },
      name
    ),
  };
});

/** Records what the tour was asked to start, without running one. */
const tourStart = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: { email: 'teacher@lab.id' },
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  ScheduleProvider: ({ children }) => children,
  useSchedule: () => ({
    roleToggles: {},
    users: { 'teacher@lab.id': 'Instructor' },
    featureToggles: {},
    instructorProfiles: [],
    branches: [],
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }) => children,
  useToast: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/tour/TourProvider', () => ({
  default: ({ children }) => children,
  useTour: () => ({ start: tourStart }),
}));

vi.mock('@/services/taskService', () => ({
  listenToMyTasks: () => () => {},
}));

vi.mock('@/components/layout/Header', async () => {
  const { createElement } = await import('react');
  return {
    default: () => createElement('header', {
      className: 'dashboard-header',
      'data-testid': 'app-header',
    }),
  };
});

vi.mock('@/components/auth/LoginOverlay', () => ({ default: () => null }));
vi.mock('@/components/layout/StudentSearchSidebar', () => ({ default: () => null }));

vi.mock('@/views/HomePage', pageStub('home'));
vi.mock('@/views/ConflictsPage', pageStub('conflicts'));
vi.mock('@/views/AvailabilityPage', pageStub('availability'));
vi.mock('@/views/LeavePage', pageStub('leave'));
vi.mock('@/views/TrialPriorityPage', pageStub('trial-priority'));
vi.mock('@/views/FinderPage', pageStub('finder'));
vi.mock('@/views/SchedulePage', pageStub('schedule'));
vi.mock('@/views/TrialInputPage', pageStub('trial-input'));
vi.mock('@/views/ApiDocsPage', pageStub('api-docs'));
vi.mock('@/views/AdminPage', pageStub('admin'));
vi.mock('@/views/ProfilePage', pageStub('profiles'));
vi.mock('@/views/WorkloadPage', pageStub('workload'));
vi.mock('@/views/TasksPage', pageStub('tasks'));
vi.mock('@/views/CrmPage', pageStub('crm'));
vi.mock('@/views/ComingSoonPage', pageStub('coming-soon'));
vi.mock('@/views/NewHomePage', pageStub('new-home'));
vi.mock('@/views/NewLeavePage', pageStub('new-leave'));
vi.mock('@/views/NewSchedulePage', pageStub('new-schedule'));
vi.mock('@/views/NewOperationalsPage', pageStub('new-operationals'));
vi.mock('@/views/NewStudentsPage', pageStub('new-students'));
vi.mock('@/views/NewStudentReportCardsPage', pageStub('new-report-cards'));
vi.mock('@/views/NewRubricSetupPage', pageStub('new-rubric'));
vi.mock('@/views/NewInstructorsPage', pageStub('new-instructors'));
vi.mock('@/views/NewCrmPage', pageStub('new-crm'));
vi.mock('@/views/NewApiDocsPage', pageStub('new-api'));
vi.mock('@/views/NewUsersPage', pageStub('new-users'));
vi.mock('@/views/NewWorkloadPage', pageStub('new-workload'));
vi.mock('@/views/NewTrialAvailabilityPage', pageStub('new-trial-availability'));
vi.mock('@/views/NewActivityPage', pageStub('new-activity'));
vi.mock('@/views/NewKinderProgressPage', pageStub('new-progress-kinder'));
vi.mock('@/views/NewJuniorProgressPage', pageStub('new-progress-junior'));
vi.mock('@/views/NewCoderProgressPage', pageStub('new-progress-coder'));

// Imported after the mock declarations; `vi.mock` is hoisted above both.
const { default: AppShell } = await import('@/components/layout/AppShell');
const { DISMISS_KEY, OLD_OPS_SUNSET_ISO, PHASE_COPY } = await import('@/lib/opsSunset');

/* ---------------------------------------------------------------- fixtures */

/** The hook's clock interval, kept as a literal so a change here is visible. */
const CLOCK_INTERVAL_MS = 60000;

/** The retirement date written out, as the copy renders it. */
const DATE = '1 September 2026';

/**
 * One instant per phase, all at 12:00 WIB so nothing in this file drifts into a
 * neighbouring calendar day, and all derived by hand from `2026-09-01`.
 */
const AT = {
  notice: Date.UTC(2026, 7, 4, 5),    // 4 Aug 2026 — 28 days out
  warning: Date.UTC(2026, 7, 18, 5),  // 18 Aug     — 14 days out, the top of `warning`
  warningLate: Date.UTC(2026, 7, 28, 5), // 28 Aug  — 4 days out, still `warning`
  urgent: Date.UTC(2026, 7, 29, 5),   // 29 Aug     — 3 days out, the top of `urgent`
  urgentLast: Date.UTC(2026, 7, 31, 5), // 31 Aug   — 1 day out
  final: Date.UTC(2026, 8, 1, 5),     // 1 Sep      — the deadline's own WIB day
  past: Date.UTC(2026, 8, 2, 5),      // 2 Sep      — the day after
};

/** The day count each of those instants produces. */
const DAYS = {
  notice: 28, warning: 14, warningLate: 4, urgent: 3, urgentLast: 1, final: 0, past: -1,
};

/** The `lucide-react` class each phase's icon renders with. */
const ICON_CLASS = {
  notice: 'lucide-info',
  warning: 'lucide-alert-triangle',
  urgent: 'lucide-alert-circle',
  final: 'lucide-alert-circle',
  past: 'lucide-archive',
};

/** The headline the copy table produces for a phase at one of those instants. */
const headlineFor = (phase) => PHASE_COPY[phase].headline(DAYS[phase], DATE);

/* ----------------------------------------------------------------- helpers */

/** Mount the shell as if the browser had just loaded `path`. */
function mountAt(path) {
  window.history.replaceState({}, '', path);
  const view = render(<AppShell />);
  return { ...view, main: view.container.querySelector('main.dashboard-container') };
}

/** Let the stubbed fetch and its `.json()` settle inside `act`. */
async function flush() {
  await act(async () => {});
}

/** Advance the fake clock, firing the hook's re-read along the way. */
function advance(ms = CLOCK_INTERVAL_MS) {
  act(() => { vi.advanceTimersByTime(ms); });
}

/**
 * Move the clock without firing a timer, then let the hook's next re-read pick it
 * up. This is a tab left open across a boundary, not a reload.
 */
function moveClockTo(instant) {
  vi.setSystemTime(instant);
  advance();
}

const banners = (c) => c.querySelectorAll('[data-tour="sunset-banner"]');
const banner = (c) => c.querySelector('[data-tour="sunset-banner"]');
const badge = (c) => c.querySelector('.ops-sunset-badge');
const views = (c) => c.querySelector('.dashboard-views');
const page = (c) => c.querySelector('[data-testid="page"]')?.dataset.page;
const dismissButtons = (c) => c.querySelectorAll('[aria-label*="Dismiss" i]');

/** A button by its exact rendered label, from a container rather than a screen. */
function buttonNamed(c, label) {
  const match = [...c.querySelectorAll('button')]
    .find((b) => b.textContent.replace(/\s+/g, ' ').trim() === label);
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

/** The switcher tabs, which carry the badge and must never be disabled. */
const opsTab = (c, mode) => c.querySelectorAll('.operations-switcher button')[mode === 'old' ? 0 : 1];

/**
 * Every control the shell renders outside the banner, with its enabled state.
 * Compared between phases for Req 3.13 and 6.5 — the notice may change what it
 * says, and nothing else may change at all.
 */
function controls(c) {
  return {
    nav: [...c.querySelectorAll('.sidebar-nav button')].map((b) => [
      b.textContent.replace(/\s+/g, ' ').trim(),
      b.disabled,
      b.getAttribute('aria-disabled'),
    ]),
    tabs: [...c.querySelectorAll('.operations-switcher button')].map((b) => [
      b.className, b.disabled,
    ]),
    page: page(c),
  };
}

/** Anything that would count as a prompt standing between a press and its effect. */
const prompts = (c) => c.querySelectorAll('[role="dialog"], [role="alertdialog"]');

const store = (record) => window.localStorage.setItem(DISMISS_KEY, JSON.stringify(record));
const stored = () => window.localStorage.getItem(DISMISS_KEY);

let errorSpy;
let confirmSpy;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT.notice);
  window.localStorage.clear();
  window.history.replaceState({}, '', '/home');

  // A config response that resolves to nothing, so every count in this file
  // comes from the shipped constant.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ value: null }) })));

  // jsdom implements neither; the shell calls the first on every navigation.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

  // Nothing in this feature prompts or logs, so either is a defect worth seeing.
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  arithmetic.sunsetNotice.mockClear();
  arithmetic.daysUntilSunset.mockClear();
  tourStart.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  confirmSpy.mockRestore();
  errorSpy.mockRestore();
  vi.useRealTimers();
  window.localStorage.clear();
});

/* -------------------------------------------------------------------- tests */

describe('AppShell: where the banner lands', () => {
  it('is guarded by the shipped date this file is written around', () => {
    // Every instant above is derived from this constant by hand. If it moves,
    // the numbers in this file are wrong rather than the shell.
    expect(OLD_OPS_SUNSET_ISO).toBe('2026-09-01');
  });

  it('renders exactly one banner between the header and the views, outside both', async () => {
    const { container, main } = mountAt('/home');
    await flush();

    expect(banners(container)).toHaveLength(1);

    const el = banner(container);
    const header = container.querySelector('header.dashboard-header');
    const scrollRegion = views(container);

    // A direct child of the content area, in Header → banner → views order.
    // Req 4.1
    expect(el.parentElement).toBe(main);
    const order = [...main.children];
    expect(order.indexOf(header)).toBeLessThan(order.indexOf(el));
    expect(order.indexOf(el)).toBeLessThan(order.indexOf(scrollRegion));

    // Outside the header, so it cannot compete with sync state, and outside the
    // scrolling region, so it cannot scroll away. Req 4.1
    expect(header.contains(el)).toBe(false);
    expect(scrollRegion.contains(el)).toBe(false);
    expect(el.contains(scrollRegion)).toBe(false);

    // And the notice on screen is the one for today. Req 4.1
    expect(el).toHaveTextContent(headlineFor('notice'));
    expect(badge(container).textContent).toBe('28d');
  });

  it('keeps one banner mounted across a change of active page', async () => {
    const { container } = mountAt('/home');
    await flush();

    const first = banner(container);
    expect(page(container)).toBe('home');

    for (const [label, expected] of [
      ['Conflict Report', 'conflicts'],
      ['Master Schedule', 'schedule'],
      ['Workload', 'workload'],
    ]) {
      fireEvent.click(buttonNamed(container, label));

      // The page changed under it, and the banner is the same node: one mount
      // outside `PageComponent`, not one per page. Req 4.3
      expect(page(container)).toBe(expected);
      expect(banners(container)).toHaveLength(1);
      expect(banner(container)).toBe(first);
    }

    expect(first.isConnected).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('AppShell: New Operations', () => {
  it.each([
    ['/new/home', 'new-home'],
    ['/new/students', 'new-students'],
    ['/new/schedule', 'new-schedule'],
  ])('renders no banner and no badge on %s', async (path, expected) => {
    const { container } = mountAt(path);
    await flush();

    // Req 4.9, 13.6, and the badge is decoration on a notice that is not on
    // screen, so it is absent too. Req 8.1
    expect(page(container)).toBe(expected);
    expect(banners(container)).toHaveLength(0);
    expect(badge(container)).toBeNull();

    // The rest of the interface is untouched. Req 13.8
    expect(views(container)).toBeInTheDocument();
    expect(container.querySelector('header.dashboard-header')).toBeInTheDocument();
  });

  it('issues no request and performs no arithmetic while the user is in New Operations', async () => {
    const { container } = mountAt('/home');
    await flush();
    expect(banners(container)).toHaveLength(1);

    fireEvent.click(opsTab(container, 'new'));
    await flush();

    // From here on the shell is in New Operations. Nothing it does may reach the
    // clock, the arithmetic or the config route.
    arithmetic.sunsetNotice.mockClear();
    arithmetic.daysUntilSunset.mockClear();
    fetch.mockClear();

    advance(CLOCK_INTERVAL_MS * 10);
    fireEvent.click(buttonNamed(container, 'Students'));
    await flush();

    // Req 13.6
    expect(arithmetic.sunsetNotice).not.toHaveBeenCalled();
    expect(arithmetic.daysUntilSunset).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(banners(container)).toHaveLength(0);
    expect(badge(container)).toBeNull();
  });

  it('mounts the banner on the switch back to Old Operations, with the page still there', async () => {
    const { container } = mountAt('/new/home');
    await flush();
    expect(banners(container)).toHaveLength(0);

    fireEvent.click(opsTab(container, 'old'));
    await flush();

    // One press, no reload, and the shell is still rendering a page. Req 4.10
    expect(banners(container)).toHaveLength(1);
    expect(banner(container)).toHaveTextContent(headlineFor('notice'));
    expect(banner(container).parentElement).toBe(container.querySelector('main.dashboard-container'));
    expect(page(container)).toBe('home');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('AppShell: the phase escalating under a running tab', () => {
  it('replaces the warning copy with the urgent copy across the 14 → 3 boundary', async () => {
    vi.setSystemTime(AT.warning);
    const { container } = mountAt('/home');
    await flush();

    const el = banner(container);
    expect(el).toHaveTextContent(headlineFor('warning'));
    expect(el.className).toContain('ops-sunset-banner-warning');
    expect(el.querySelector(`.${ICON_CLASS.warning}`)).not.toBeNull();
    expect(badge(container).textContent).toBe('14d');

    moveClockTo(AT.urgent);

    // Headline, icon and tone all replaced, in the same element: a re-render,
    // not a reload. Req 6.9, and the page below it never moved.
    expect(banner(container)).toBe(el);
    expect(el.isConnected).toBe(true);
    expect(el).toHaveTextContent(headlineFor('urgent'));
    expect(el).not.toHaveTextContent(headlineFor('warning'));
    expect(el.className).toContain('ops-sunset-banner-urgent');
    expect(el.className).not.toContain('ops-sunset-banner-warning');
    expect(el.querySelector(`.${ICON_CLASS.urgent}`)).not.toBeNull();
    expect(badge(container).textContent).toBe('3d');
    expect(page(container)).toBe('home');
  });

  it('replaces the urgent copy with the final copy across the 1 → 0 boundary', async () => {
    vi.setSystemTime(AT.urgentLast);
    const { container } = mountAt('/home');
    await flush();

    const el = banner(container);
    expect(el).toHaveTextContent(headlineFor('urgentLast'));
    expect(dismissButtons(container)).toHaveLength(1);

    moveClockTo(AT.final);

    // The last day is a statement rather than a reminder, so the way to close it
    // goes with the change of wording. Req 6.9, 5.11
    expect(banner(container)).toBe(el);
    expect(el).toHaveTextContent(headlineFor('final'));
    expect(el.className).toContain('ops-sunset-banner-final');
    expect(el.querySelector(`.${ICON_CLASS.final}`)).not.toBeNull();
    expect(dismissButtons(container)).toHaveLength(0);
    expect(badge(container).textContent).toBe('0d');
  });

  it('replaces the final copy with the past copy on crossing out of the deadline day', async () => {
    vi.setSystemTime(AT.final);
    const { container } = mountAt('/home');
    await flush();

    const el = banner(container);
    expect(el).toHaveTextContent(headlineFor('final'));

    moveClockTo(AT.past);

    // Past tense, the archive glyph, the neutral tone, and the badge drops its
    // digits. Req 6.9, 6.2, 6.6
    expect(banner(container)).toBe(el);
    expect(el).toHaveTextContent(headlineFor('past'));
    expect(el).toHaveTextContent(DATE);
    expect(el.className).toContain('ops-sunset-banner-past');
    expect(el.querySelector(`.${ICON_CLASS.past}`)).not.toBeNull();
    expect(dismissButtons(container)).toHaveLength(0);
    expect(badge(container).textContent).toBe('retired');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders the same enabled controls in every phase', async () => {
    const snapshots = {};

    for (const phase of ['notice', 'warning', 'urgent', 'final', 'past']) {
      vi.setSystemTime(AT[phase]);
      const view = mountAt('/home');
      await flush();

      // The notice is on screen in all five, so this is a comparison of what is
      // around it rather than of whether it is there.
      expect(banners(view.container)).toHaveLength(1);
      snapshots[phase] = controls(view.container);
      view.unmount();
    }

    // Req 3.13, 6.5: nothing about the shell varies with the phase beyond the
    // fields the banner and the badge render.
    for (const phase of ['warning', 'urgent', 'final', 'past']) {
      expect(snapshots[phase]).toEqual(snapshots.notice);
    }
    for (const snapshot of Object.values(snapshots)) {
      expect(snapshot.nav.length).toBeGreaterThan(0);
      expect(snapshot.nav.every(([, disabled]) => disabled === false)).toBe(true);
      expect(snapshot.tabs.every(([, disabled]) => disabled === false)).toBe(true);
    }
  });
});

describe('AppShell: dismissing and coming back', () => {
  it('hides the notice for the dismissed phase and shows it again once the phase escalates', async () => {
    vi.setSystemTime(AT.warning);
    let view = mountAt('/home');
    await flush();
    expect(banners(view.container)).toHaveLength(1);

    fireEvent.click(view.container.querySelector('[aria-label*="Dismiss" i]'));

    // Gone, with the badge it decorates, and the record names the phase that was
    // on screen. Req 5.5, 8.1
    expect(banners(view.container)).toHaveLength(0);
    expect(badge(view.container)).toBeNull();
    expect(JSON.parse(stored())).toEqual({ phase: 'warning', at: AT.warning });
    // Everything else still renders and still navigates. Req 13.8
    expect(views(view.container)).toBeInTheDocument();
    fireEvent.click(buttonNamed(view.container, 'Conflict Report'));
    expect(page(view.container)).toBe('conflicts');

    // A reload ten days later, still inside `warning`: nothing new to say, so it
    // stays closed. Req 5.5
    view.unmount();
    vi.setSystemTime(AT.warningLate);
    view = mountAt('/home');
    await flush();
    expect(banners(view.container)).toHaveLength(0);
    expect(badge(view.container)).toBeNull();

    // The same reload one day further on, now `urgent`: different wording, so it
    // comes back. Req 5.6
    view.unmount();
    vi.setSystemTime(AT.urgent);
    view = mountAt('/home');
    await flush();

    expect(banners(view.container)).toHaveLength(1);
    expect(banner(view.container)).toHaveTextContent(headlineFor('urgent'));
    expect(badge(view.container).textContent).toBe('3d');
    // The old record is still the only one there; nothing was rewritten.
    expect(JSON.parse(stored())).toEqual({ phase: 'warning', at: AT.warning });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('AppShell: the last day and after', () => {
  const RECORDS = [
    ['no record', null],
    ['a warning record', { phase: 'warning', at: AT.warning }],
    ['a record naming this phase', { phase: 'final', at: AT.final }],
    ['a past record', { phase: 'past', at: AT.final }],
    ['an unparseable value', 'not json'],
  ];

  it.each([['final'], ['past']])('renders the %s notice with no dismiss button', async (phase) => {
    vi.setSystemTime(AT[phase]);
    const { container } = mountAt('/home');
    await flush();

    // Req 5.11
    expect(banners(container)).toHaveLength(1);
    expect(banner(container)).toHaveTextContent(headlineFor(phase));
    expect(dismissButtons(container)).toHaveLength(0);
  });

  it.each(RECORDS)('renders the past notice on a reload with %s in storage', async (_name, record) => {
    vi.setSystemTime(AT.past);
    if (record === null) window.localStorage.removeItem(DISMISS_KEY);
    else if (typeof record === 'string') window.localStorage.setItem(DISMISS_KEY, record);
    else store(record);

    const { container } = mountAt('/home');
    await flush();

    // Whatever is in storage, the standing statement stands. Req 6.3
    expect(banners(container)).toHaveLength(1);
    expect(banner(container)).toHaveTextContent(headlineFor('past'));
    expect(dismissButtons(container)).toHaveLength(0);
    expect(badge(container).textContent).toBe('retired');
  });

  it('keeps the past notice on every Old Operations page, with no redirect', async () => {
    vi.setSystemTime(AT.past);
    store({ phase: 'past', at: AT.past });
    const { container } = mountAt('/home');
    await flush();

    const el = banner(container);

    for (const [label, expected] of [
      ['Master Schedule', 'schedule'],
      ['Admin Settings', 'admin'],
      ['CRM Leads', 'crm'],
      ['Home', 'home'],
    ]) {
      fireEvent.click(buttonNamed(container, label));

      // The page opens, `opsMode` is untouched, and the same banner is still
      // there. Req 6.3, 6.10
      expect(page(container)).toBe(expected);
      expect(window.location.pathname).toBe(`/${expected}`);
      expect(opsTab(container, 'old').className).toContain('active');
      expect(banners(container)).toHaveLength(1);
      expect(banner(container)).toBe(el);
      expect(banner(container)).toHaveTextContent(headlineFor('past'));
    }

    expect(prompts(container)).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it.each([['final'], ['past']])('switches both ways on one press in the %s phase', async (phase) => {
    vi.setSystemTime(AT[phase]);
    const { container } = mountAt('/home');
    await flush();
    expect(banners(container)).toHaveLength(1);

    // Old → New, one press, no prompt, no disabled control. Req 6.4
    expect(opsTab(container, 'new').disabled).toBe(false);
    fireEvent.click(opsTab(container, 'new'));
    await flush();

    expect(opsTab(container, 'new').className).toContain('active');
    expect(window.location.pathname).toBe('/new/home');
    expect(page(container)).toBe('new-home');
    expect(banners(container)).toHaveLength(0);
    expect(badge(container)).toBeNull();
    expect(prompts(container)).toHaveLength(0);

    // New → Old, one press, and the notice is back. Req 6.4, 4.10
    expect(opsTab(container, 'old').disabled).toBe(false);
    fireEvent.click(opsTab(container, 'old'));
    await flush();

    expect(opsTab(container, 'old').className).toContain('active');
    expect(window.location.pathname).toBe('/home');
    expect(page(container)).toBe('home');
    expect(banners(container)).toHaveLength(1);
    expect(banner(container)).toHaveTextContent(headlineFor(phase));
    expect(prompts(container)).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
