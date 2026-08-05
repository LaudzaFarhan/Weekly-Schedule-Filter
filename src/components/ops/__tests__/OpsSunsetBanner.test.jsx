// @vitest-environment jsdom
// This file renders a component, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Example-based unit tests for the sunset banner's accessibility details.
 *
 * The property test in `OpsSunsetBanner.property.test.jsx` covers the algebra
 * across generated models — the day count reaching the accessibility tree, the
 * dismiss control existing exactly when the model says it may, an invisible
 * model rendering nothing. This file pins the details a generated model cannot
 * see: the single polite live region, where focus is before and after a
 * dismissal, that the "Show me New Operations" control is a real button the
 * keyboard can work, the `past` date wording, and a host whose `matchMedia`
 * misbehaves.
 *
 * Every model here comes out of `sunsetNotice`, not a hand-written literal, so
 * these tests fail if the banner and the module ever disagree about what a
 * phase looks like.
 */

import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OpsSunsetBanner from '@/components/ops/OpsSunsetBanner';
import {
  OLD_OPS_SUNSET_ISO,
  WIB_OFFSET_MINUTES,
  isoDayIndex,
  sunsetNotice,
} from '@/lib/opsSunset';

/* ------------------------------------------------------------------ fixtures */

const MS_PER_DAY = 86_400_000;

/**
 * An instant at midday WIB on the day that leaves `days` until the deadline.
 * Midday rather than a boundary so the fixture says nothing about rounding —
 * that is the pure module's own property test.
 *
 * @param   {number} days the Days_Remaining the instant should produce
 * @returns {number} epoch milliseconds
 */
function instantWithDaysRemaining(days) {
  const dayIndex = isoDayIndex(OLD_OPS_SUNSET_ISO) - days;
  return dayIndex * MS_PER_DAY - WIB_OFFSET_MINUTES * 60_000 + 12 * 3_600_000;
}

/**
 * The real view model for a phase, built the way the hook builds it.
 *
 * @param   {number} days the Days_Remaining to compute from
 * @returns {object} the Sunset_Notice_Model
 */
function noticeAt(days) {
  return sunsetNotice({
    sunsetISO: OLD_OPS_SUNSET_ISO,
    nowMs: instantWithDaysRemaining(days),
    storage: null,
  });
}

/** One representative day count per phase, least urgent first. */
const DAYS_BY_PHASE = {
  notice: 28,
  warning: 14,
  urgent: 2,
  final: 0,
  past: -1,
};

/** `[phaseName, model]` for every phase, for `it.each`. */
const EVERY_PHASE = Object.entries(DAYS_BY_PHASE).map(([phase, days]) => [
  phase,
  noticeAt(days),
]);

/* ------------------------------------------------------------------- queries */

const liveRegions = (root = document.body) => root.querySelectorAll('[role="status"]');
const cta = () => screen.getByRole('button', { name: 'Show me New Operations' });
const dismissButtons = () => screen.queryAllByRole('button', { name: /dismiss/i });

/* ------------------------------------------------------------------- harness */

/**
 * A page fragment that gains the banner on a later render, so the "focus is
 * left alone when the banner appears" tests can watch a real appearance rather
 * than a first mount.
 */
function AppearanceHost({ notice, showBanner }) {
  return (
    <div>
      <input aria-label="Notes" type="text" />
      {showBanner ? <OpsSunsetBanner notice={notice} /> : null}
    </div>
  );
}

/**
 * A page fragment that removes the banner when it is dismissed, the way the
 * hook does by recomputing the model, with the ops switcher present so the
 * focus walk has its first-choice landing place.
 */
function DismissHost({ notice, withSwitcher = true, onDismissed }) {
  const [visible, setVisible] = useState(true);
  return (
    <div>
      {withSwitcher ? (
        <div data-tour="ops-switcher">
          <button type="button">New Operations</button>
        </div>
      ) : null}
      {visible ? (
        <OpsSunsetBanner
          notice={notice}
          onDismiss={() => {
            setVisible(false);
            if (onDismissed) onDismissed();
          }}
        />
      ) : null}
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* --------------------------------------------------------------------- tests */

describe('OpsSunsetBanner — the live region', () => {
  it.each(EVERY_PHASE)(
    'renders one polite status region and nothing assertive in %s',
    (phase, notice) => {
      const { container } = render(<OpsSunsetBanner notice={notice} />);

      // Req 9.1: exactly one live region, and it is the outermost element, so
      // the whole message is announced as one utterance.
      const regions = liveRegions(container);
      expect(regions).toHaveLength(1);
      expect(regions[0]).toBe(container.firstElementChild);
      expect(regions[0]).toHaveAttribute('aria-live', 'polite');

      // Req 9.1: the notice waits its turn in every phase, `final` and `past`
      // included — an interruption is never the right escalation here.
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
      expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);
      expect(phase).toBe(notice.phase);
    },
  );

  it.each(EVERY_PHASE)('hides the %s icon from assistive technology', (phase, notice) => {
    const { container } = render(<OpsSunsetBanner notice={notice} />);

    // Req 9.10: every glyph in the banner is decoration, the phase icon
    // included, so none of them is announced.
    const glyphs = container.querySelectorAll('svg');
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('states the phase in the live region text, differently for every phase', () => {
    const headlines = EVERY_PHASE.map(([, notice]) => {
      const { container, unmount } = render(<OpsSunsetBanner notice={notice} />);
      const text = liveRegions(container)[0].textContent;

      // Req 9.10, 9.4: the wording carries the phase, so removing the icon and
      // all colour still leaves the phase identifiable.
      expect(text).toContain(notice.headline);
      expect(text).toContain(notice.detail);

      unmount();
      return notice.headline;
    });

    // Req 9.4: five phases, five distinct headlines.
    expect(new Set(headlines).size).toBe(EVERY_PHASE.length);
  });
});

describe('OpsSunsetBanner — focus on appearance', () => {
  it.each(EVERY_PHASE)('leaves focus on a text input when the %s banner appears', (
    phase,
    notice,
  ) => {
    const { container, rerender } = render(
      <AppearanceHost notice={notice} showBanner={false} />,
    );
    const input = screen.getByLabelText('Notes');
    input.focus();
    expect(document.activeElement).toBe(input);

    rerender(<AppearanceHost notice={notice} showBanner />);

    // Req 9.2: the caret stays where the user put it. The banner announces
    // itself through the live region instead of taking focus.
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[autofocus]')).toBeNull();
    expect(screen.getByText(notice.headline)).toBeInTheDocument();
  });
});

describe('OpsSunsetBanner — focus after dismissal', () => {
  it('moves focus to a surviving element, not the removed button and not the body', async () => {
    const user = userEvent.setup();
    const notice = noticeAt(DAYS_BY_PHASE.warning);
    render(<DismissHost notice={notice} />);

    const dismiss = dismissButtons()[0];
    expect(dismiss).toBeDefined();

    await user.click(dismiss);

    // Req 9.9: the banner has gone, and with it the button that was focused.
    expect(dismiss).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(dismiss);
    expect(document.activeElement).not.toBe(document.body);

    // The first candidate in the walk is the switcher's own button, which is
    // where the notice was pointing anyway.
    const switcher = document.querySelector('[data-tour="ops-switcher"] button');
    expect(document.activeElement).toBe(switcher);
  });

  it('falls back to the surviving parent when no landing candidate is present', async () => {
    const user = userEvent.setup();
    const notice = noticeAt(DAYS_BY_PHASE.urgent);
    const { container } = render(<DismissHost notice={notice} withSwitcher={false} />);

    // The banner's parent here is the harness `div`, which outlives it.
    const host = container.firstElementChild;
    await user.click(dismissButtons()[0]);

    // Req 9.9: made programmatically focusable rather than left to the body, so
    // a keyboard user keeps their place in the page.
    expect(host).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(host);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('calls onDismiss exactly once per activation', async () => {
    const user = userEvent.setup();
    const onDismissed = vi.fn();
    render(<DismissHost notice={noticeAt(DAYS_BY_PHASE.notice)} onDismissed={onDismissed} />);

    await user.click(dismissButtons()[0]);

    // Req 5.3: one press, one record.
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});

describe('OpsSunsetBanner — the "Show me New Operations" control', () => {
  it('is a native button with no negative tabindex, reached by Tab in document order', async () => {
    const user = userEvent.setup();
    const notice = noticeAt(DAYS_BY_PHASE.warning);
    render(<AppearanceHost notice={notice} showBanner />);

    const button = cta();

    // Req 9.6: a real `button`, so the platform supplies the role, the keyboard
    // behaviour and the focus ring.
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    const tabindex = button.getAttribute('tabindex');
    expect(tabindex === null || Number(tabindex) >= 0).toBe(true);

    // Tab order follows the document: the input that precedes the banner, then
    // the banner's own controls.
    screen.getByLabelText('Notes').focus();
    await user.tab();
    expect(document.activeElement).toBe(button);
  });

  it('is activated by the Enter key', async () => {
    const user = userEvent.setup();
    const onShowMe = vi.fn();
    render(<OpsSunsetBanner notice={noticeAt(DAYS_BY_PHASE.warning)} onShowMe={onShowMe} />);

    cta().focus();
    await user.keyboard('{Enter}');

    // Req 9.6
    expect(onShowMe).toHaveBeenCalledTimes(1);
  });

  it('is activated by the Space key', async () => {
    const user = userEvent.setup();
    const onShowMe = vi.fn();
    render(<OpsSunsetBanner notice={noticeAt(DAYS_BY_PHASE.past)} onShowMe={onShowMe} />);

    cta().focus();
    await user.keyboard('[Space]');

    // Req 9.6, and Req 6.11: the way across is offered in `past` too.
    expect(onShowMe).toHaveBeenCalledTimes(1);
  });
});

describe('OpsSunsetBanner — the past phase', () => {
  it('renders the retirement date in day, month name, year order', () => {
    const notice = noticeAt(DAYS_BY_PHASE.past);
    const { container } = render(<OpsSunsetBanner notice={notice} />);

    const text = liveRegions(container)[0].textContent;

    // Req 6.2: "1 September 2026" — no leading zero, the month as a word, the
    // year last, and no weekday.
    expect(text).toContain('1 September 2026');
    expect(text).toMatch(/\b1 September 2026\b/);
    expect(text).not.toMatch(/2026-09-01/);
    expect(notice.phase).toBe('past');
    expect(notice.icon).toBe('Archive');
  });

  it('renders no dismiss button', () => {
    render(<OpsSunsetBanner notice={noticeAt(DAYS_BY_PHASE.past)} />);

    // Req 5.11: `past` is the state of this screen, not a reminder, so there is
    // nothing to close.
    expect(dismissButtons()).toHaveLength(0);
    expect(cta()).toBeInTheDocument();
  });

  it('renders no dismiss button in final either', () => {
    render(<OpsSunsetBanner notice={noticeAt(DAYS_BY_PHASE.final)} />);

    // Req 5.11
    expect(dismissButtons()).toHaveLength(0);
  });
});

describe('OpsSunsetBanner — a hostile matchMedia', () => {
  it('renders text, icon and buttons when matchMedia throws', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('matchMedia is unavailable');
    });
    const notice = noticeAt(DAYS_BY_PHASE.warning);

    const { container } = render(<OpsSunsetBanner notice={notice} />);

    // Req 9.11: the component queries no media list of its own, so a host that
    // raises on `matchMedia` changes nothing about what is rendered.
    const region = liveRegions(container)[0];
    expect(region).toBeInTheDocument();
    expect(within(region).getByText(notice.headline)).toBeInTheDocument();
    expect(within(region).getByText(notice.detail)).toBeInTheDocument();
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(cta()).toBeInTheDocument();
    expect(dismissButtons()).toHaveLength(1);
  });

  it('renders text, icon and buttons when the host provides no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const notice = noticeAt(DAYS_BY_PHASE.urgent);

    const { container } = render(<OpsSunsetBanner notice={notice} />);

    // Req 9.11
    expect(liveRegions(container)).toHaveLength(1);
    expect(screen.getByText(notice.headline)).toBeInTheDocument();
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(cta()).toBeInTheDocument();
  });
});
