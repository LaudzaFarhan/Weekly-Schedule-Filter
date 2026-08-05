// @vitest-environment jsdom
// This file renders the Sidebar, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Unit tests for the Switcher_Badge on the Old Operations switcher tab.
 *
 * Req 6.6 — the `past` badge value reads "retired" and carries no digits.
 * Req 8.1 — exactly one badge element on the Old Operations tab, in both
 *           `opsMode` values.
 * Req 8.2 — the supplied string renders exactly as supplied: no truncation, no
 *           ellipsis, nothing added by the Sidebar.
 * Req 8.3 — the badge carries `aria-hidden="true"` and contributes no text to
 *           the tab's accessible name, because the banner already announces it.
 * Req 8.5 — the badge displays nothing but that string: no date, no headline,
 *           no detail, no control of its own.
 * Req 8.6 — an absent, non-string or empty value renders no badge element and
 *           leaves the tab and its label unchanged.
 * Req 8.7 — a press on the badge sets `opsMode` to 'old' on that single press,
 *           exactly as a press anywhere else on the tab.
 *
 * The badge is `aria-hidden` decoration by design, so it is unreachable by role
 * or by accessible name — these tests locate it by its `.ops-sunset-badge`
 * class, which is the only handle a hidden element has. The tab that owns it is
 * still reached by role and accessible name, which is what Req 8.3 asserts on.
 *
 * `Sidebar` sits on top of two contexts and the task subscription, so all three
 * are replaced: the real `ScheduleContext` pulls in the whole data layer and
 * `listenToMyTasks` would otherwise open a real Firestore listener underneath
 * the assertions. No request leaves the process.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
// Unmounting between tests is handled globally by vitest.setup.js.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* ------------------------------------------------------------------- mocks */

const listenToMyTasks = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: { email: 'teacher@lab.id' }, logout: vi.fn() }),
}));

vi.mock('@/contexts/ScheduleContext', () => ({
  ScheduleProvider: ({ children }) => children,
  useSchedule: () => ({
    roleToggles: {},
    users: { 'teacher@lab.id': 'Instructor' },
    featureToggles: {},
    instructorProfiles: [],
  }),
}));

vi.mock('@/services/taskService', () => ({ listenToMyTasks }));

// Imported after the mock declarations; `vi.mock` is hoisted above both.
const { default: Sidebar } = await import('@/components/layout/Sidebar');

/* ---------------------------------------------------------------- fixtures */

const setOpsMode = vi.fn();

/** Renders the Sidebar with everything but the badge held constant. */
function renderSidebar(props = {}) {
  return render(
    <Sidebar
      currentPage="home"
      onNavigate={vi.fn()}
      onToggleSearch={vi.fn()}
      opsMode="old"
      setOpsMode={setOpsMode}
      {...props}
    />
  );
}

/** The Old Operations switcher tab, reached the way a user reaches it. */
function oldOpsTab() {
  return screen.getByRole('button', { name: /old operations/i });
}

beforeEach(() => {
  setOpsMode.mockClear();
});

/* ------------------------------------------------------------------- tests */

describe('Sidebar switcher badge', () => {
  describe('presence and placement (Req 8.1)', () => {
    it.each(['old', 'new'])('renders exactly one badge on the Old Operations tab in opsMode %s', (opsMode) => {
      const { container } = renderSidebar({ opsMode, sunsetBadge: '28d' });

      const badges = container.querySelectorAll('.ops-sunset-badge');
      expect(badges).toHaveLength(1);
      // On that tab, not merely somewhere in the sidebar.
      expect(oldOpsTab()).toContainElement(badges[0]);
      // The New Operations tab carries nothing.
      expect(screen.getByRole('button', { name: /new operations/i }))
        .not.toContainElement(badges[0]);
    });
  });

  describe('accessibility (Req 8.3)', () => {
    it('carries aria-hidden="true" and contributes nothing to the tab accessible name', () => {
      const { container } = renderSidebar({ sunsetBadge: '3d' });

      const badge = container.querySelector('.ops-sunset-badge');
      expect(badge).toHaveAttribute('aria-hidden', 'true');
      // The tab announces itself as the tab, not as "Old Operations 3d".
      expect(oldOpsTab()).toHaveAccessibleName('Old Operations');
    });
  });

  describe('rendered text (Req 8.2, 8.5)', () => {
    it.each(['28d', '14d', '3d', '0d', 'retired'])('renders the string %s verbatim', (value) => {
      const { container } = renderSidebar({ sunsetBadge: value });

      const badge = container.querySelector('.ops-sunset-badge');
      // Exactly the supplied string: no truncation, no ellipsis, nothing added.
      expect(badge.textContent).toBe(value);
      expect(badge.textContent).not.toContain('…');
      expect(badge.textContent).not.toContain('...');
      // No control of its own, and no date, headline or detail hiding inside it.
      expect(badge.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
      expect(badge.children).toHaveLength(0);
    });

    it('keeps the tab label intact alongside the badge', () => {
      renderSidebar({ sunsetBadge: '28d' });

      expect(oldOpsTab()).toHaveTextContent(/^Old Operations28d$/);
    });
  });

  describe('the past phase (Req 6.6)', () => {
    it('renders "retired" with no digit characters, in both opsMode values', () => {
      for (const opsMode of ['old', 'new']) {
        const { container, unmount } = renderSidebar({ opsMode, sunsetBadge: 'retired' });

        const badge = container.querySelector('.ops-sunset-badge');
        expect(badge.textContent).toBe('retired');
        expect(badge.textContent).not.toMatch(/\d/);

        unmount();
      }
    });
  });

  describe('values that render no badge (Req 8.6)', () => {
    // `undefined` stands for the prop being absent, which is how the shell
    // renders before any notice model exists.
    it.each([
      ['absent', undefined],
      ['null', null],
      ['an empty string', ''],
      ['a number', 28],
      ['a boolean', true],
      ['an object', { days: 28 }],
      ['an array', ['28d']],
    ])('renders no badge element when the value is %s', (_label, value) => {
      const { container } = renderSidebar({ sunsetBadge: value });

      expect(container.querySelectorAll('.ops-sunset-badge')).toHaveLength(0);
      // The tab and its label are untouched, and nothing is printed in place
      // of the badge.
      const tab = oldOpsTab();
      expect(tab).toHaveTextContent(/^Old Operations$/);
      expect(tab).toHaveAccessibleName('Old Operations');
      expect(screen.getByRole('button', { name: /new operations/i })).toBeInTheDocument();
    });
  });

  describe('pressing the badge (Req 8.7)', () => {
    it('sets opsMode to old on a single press', async () => {
      const user = userEvent.setup();
      const { container } = renderSidebar({ opsMode: 'new', sunsetBadge: '28d' });

      await user.click(container.querySelector('.ops-sunset-badge'));

      expect(setOpsMode).toHaveBeenCalledTimes(1);
      expect(setOpsMode).toHaveBeenCalledWith('old');
    });

    it('behaves the same as a press on the rest of the tab', async () => {
      const user = userEvent.setup();
      renderSidebar({ opsMode: 'new', sunsetBadge: '28d' });

      await user.click(oldOpsTab());

      expect(setOpsMode).toHaveBeenCalledTimes(1);
      expect(setOpsMode).toHaveBeenCalledWith('old');
    });
  });
});
