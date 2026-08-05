// @vitest-environment jsdom
// This file renders a component, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Property tests for the sunset banner's rendering.
 *
 * Every notice model under test comes out of the real `sunsetNotice`, driven by a
 * generated retirement date and an instant placed a generated number of WIB days
 * away from it. Hand-built models would let a property pass against a shape the
 * module never produces, which is precisely the drift these tests exist to catch.
 *
 * Colour is never asserted on. The whole point of the phase table is that the
 * icon and the wording carry the meaning, so a test that leaned on the tone
 * class would be testing the decoration instead of the message.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fc from 'fast-check';

import {
  WIB_OFFSET_MINUTES,
  formatSunsetDate,
  isDismissible,
  isoDayIndex,
  recordDismissal,
  sunsetNotice,
  sunsetPhase,
} from '@/lib/opsSunset';

import OpsSunsetBanner from '@/components/ops/OpsSunsetBanner';

/** One day, in milliseconds. Every day index here is measured in these. */
const MS_PER_DAY = 86400000;

/** The WIB offset in milliseconds, so a day index can be turned back into an instant. */
const WIB_OFFSET_MS = WIB_OFFSET_MINUTES * 60000;

/* -------------------------------------------------------------- generators */

/**
 * Well-formed ISO dates that name real days. `noInvalidDate` because the
 * generator's whole job is to produce a string, and `toISOString` throws on the
 * invalid date fast-check would otherwise be free to hand us.
 */
const isoDate = () => fc.date({
  min: new Date(Date.UTC(2020, 0, 1)),
  max: new Date(Date.UTC(2030, 0, 1)),
  noInvalidDate: true,
}).map((d) => d.toISOString().slice(0, 10));

/** Any offset within one WIB day, so no property can pass by sitting on midnight. */
const withinDay = () => fc.integer({ min: 0, max: MS_PER_DAY - 1 });

/**
 * Day counts that land in a Live_Phase, drawn per phase rather than from one
 * wide range: an unweighted integer over 0–3650 would put `final` and `urgent`
 * — the two that matter most — at well under 1% of examples, and with 20 runs
 * they would simply never appear.
 */
const liveDays = () => fc.oneof(
  fc.integer({ min: 15, max: 3650 }),  // notice
  fc.integer({ min: 4, max: 14 }),     // warning
  fc.integer({ min: 1, max: 3 }),      // urgent
  fc.constant(0),                      // final
);

/** Every phase, `past` included, at the same per-phase weighting. */
const anyDays = () => fc.oneof(liveDays(), fc.integer({ min: -3650, max: -1 }));

/** Junk retirement dates, each of which makes `sunsetNotice` invisible. */
const junkDate = () => fc.oneof(
  fc.constant(null), fc.constant(undefined), fc.string(),
  fc.integer(), fc.boolean(), fc.object(), fc.array(fc.string()),
  fc.constantFrom('2026-02-30', '2026-13-01', '2026-00-10', '26-09-01', '2026/09/01'),
);

/* ------------------------------------------------------------------ helpers */

/**
 * An instant that sits exactly `days` whole WIB days before the WIB day named by
 * `iso`, offset into that day by `offset` milliseconds.
 *
 * Built from the day index rather than by subtracting milliseconds from a parsed
 * date, so `daysUntilSunset(iso, …)` is `days` by construction whatever the hour.
 *
 * @param   {string} iso a `YYYY-MM-DD` retirement date
 * @param   {number} days whole WIB days remaining
 * @param   {number} offset milliseconds into that WIB day, 0 to 86399999
 * @returns {number} an instant in epoch milliseconds
 */
function instantForDays(iso, days, offset) {
  return (isoDayIndex(iso) - days) * MS_PER_DAY - WIB_OFFSET_MS + offset;
}

/** A `localStorage`-like object backed by a plain map. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** The one live region the banner renders, and its text. */
const statusEl = () => screen.getByRole('status');

afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------- Property 23 */

describe('OpsSunsetBanner accessible day count', () => {
  // Feature: old-operations-sunset-notice, Property 23: The day count reaches the accessibility tree
  it('states the day count as digits in one polite live region, in every phase', () => {
    // Coverage counters, so the per-phase branches cannot pass vacuously.
    const seen = { live: 0, past: 0, final: 0 };

    fc.assert(
      fc.property(isoDate(), anyDays(), withinDay(), (iso, days, offset) => {
        cleanup();

        const nowMs = instantForDays(iso, days, offset);
        const notice = sunsetNotice({ sunsetISO: iso, nowMs, storage: null });

        // Nothing is dismissed here, so every phase is on screen.
        expect(notice.visible).toBe(true);
        expect(notice.phase).toBe(sunsetPhase(days));

        const { container } = render(<OpsSunsetBanner notice={notice} />);

        // ---- Exactly one live region, polite, and nothing assertive anywhere.
        // The notice is announced after whatever the user is doing rather than
        // interrupting it. Req 9.1
        const regions = screen.getAllByRole('status');
        expect(regions).toHaveLength(1);
        expect(regions[0]).toHaveAttribute('aria-live', 'polite');
        expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
        expect(container.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);

        const text = statusEl().textContent;

        if (notice.phase === 'past') {
          // ---- Past: the date itself, written out in day, month name, year
          // order, inside the live region rather than in the badge alone.
          // Req 9.3
          seen.past += 1;
          expect(text).toContain(formatSunsetDate(iso));
          expect(text).toMatch(/\b\d{1,2} [A-Z][a-z]+ \d{4}\b/);
        } else {
          // ---- Live: the day count as digits, in the text, not as a bar
          // length and not as a colour. Req 9.3
          seen.live += 1;
          if (notice.phase === 'final') seen.final += 1;
          expect(text).toMatch(new RegExp(`(^|\\D)${days}(\\D|$)`));
        }

        // The count reaches the tree through the live region's own text, so it
        // does not depend on the switcher badge being rendered at all. Req 9.3
        expect(text.length).toBeGreaterThan(0);
      }),
      {
        // DOM-driven: each example mounts and tears down a tree, so the repo
        // convention is 20 rather than the 100 used for the pure module.
        numRuns: 20,
        // Run first and counted toward `numRuns`: `final` is a single day count
        // and `past` one branch of five, so at 20 runs an unlucky draw could
        // leave either counter at zero.
        examples: [
          ['2026-09-01', 0, 0],
          ['2026-09-01', -1, 0],
        ],
      },
    );

    expect(seen.live).toBeGreaterThan(0);
    expect(seen.past).toBeGreaterThan(0);
    expect(seen.final).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- Property 24 */

describe('OpsSunsetBanner dismiss control', () => {
  // Feature: old-operations-sunset-notice, Property 24: The dismiss control exists exactly when the notice is dismissible
  it('renders a dismiss button if and only if the notice is dismissible', () => {
    const seen = { dismissible: 0, notDismissible: 0 };

    fc.assert(
      fc.property(isoDate(), anyDays(), withinDay(), (iso, days, offset) => {
        cleanup();

        const nowMs = instantForDays(iso, days, offset);
        const notice = sunsetNotice({ sunsetISO: iso, nowMs, storage: null });
        expect(notice.visible).toBe(true);

        render(<OpsSunsetBanner notice={notice} onDismiss={() => {}} />);

        const dismissButtons = screen.queryAllByRole('button', { name: /dismiss/i });

        // ---- The biconditional. `final` and `past` are the current status of
        // the screen rather than a reminder, so there is nothing to close, and
        // no route through the DOM to close it either. Req 5.2, 5.11
        expect(dismissButtons.length).toBe(notice.dismissible ? 1 : 0);
        expect(notice.dismissible).toBe(isDismissible(notice.phase));

        if (notice.dismissible) {
          seen.dismissible += 1;

          // ---- The accessible name names both the action and the thing being
          // dismissed, and is matched case-insensitively by "dismiss". Req 9.5
          const label = dismissButtons[0].getAttribute('aria-label');
          expect(label).toMatch(/dismiss/i);
          expect(label).toMatch(/notice/i);
          expect(dismissButtons[0].tagName).toBe('BUTTON');
        } else {
          seen.notDismissible += 1;
          expect(['final', 'past']).toContain(notice.phase);
        }

        // The way across is offered in every phase, dismissible or not.
        expect(
          screen.getByRole('button', { name: 'Show me New Operations' }),
        ).toBeInTheDocument();
      }),
      {
        numRuns: 20,
        examples: [
          ['2026-09-01', 0, 0],
          ['2026-09-01', -1, 0],
          ['2026-09-01', 9, 0],
        ],
      },
    );

    expect(seen.dismissible).toBeGreaterThan(0);
    expect(seen.notDismissible).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- Property 25 */

describe('OpsSunsetBanner invisible notice', () => {
  // Feature: old-operations-sunset-notice, Property 25: An invisible notice renders nothing
  it('renders no element at all for an invisible notice', () => {
    const seen = { brokenDate: 0, dismissed: 0 };

    fc.assert(
      fc.property(
        fc.oneof(junkDate(), isoDate()),
        anyDays(),
        withinDay(),
        (iso, days, offset) => {
          cleanup();

          // Two ways a real model comes back invisible: an unreadable date, and
          // a dismissal recorded against the phase that is current.
          let notice;
          if (isoDayIndex(iso) === null) {
            seen.brokenDate += 1;
            notice = sunsetNotice({ sunsetISO: iso, nowMs: Date.UTC(2026, 7, 1), storage: null });
          } else {
            const nowMs = instantForDays(iso, days, offset);
            const phase = sunsetPhase(days);
            const storage = fakeStorage();
            recordDismissal(phase, nowMs, storage);
            notice = sunsetNotice({ sunsetISO: iso, nowMs, storage });

            // `final` and `past` ignore the record, so those stay visible and
            // are not this property's subject.
            if (notice.visible === true) {
              expect(['final', 'past']).toContain(phase);
              return;
            }
            seen.dismissed += 1;
          }

          expect(notice.visible).toBe(false);

          const { container } = render(<OpsSunsetBanner notice={notice} />);

          // ---- Nothing rendered whatsoever: no wrapper carrying a border and a
          // margin, so the notice adds zero height between the Header and the
          // views. Req 4.6
          expect(container.innerHTML).toBe('');
          expect(container.childNodes).toHaveLength(0);
          expect(screen.queryByRole('status')).toBeNull();
          expect(screen.queryAllByRole('button')).toHaveLength(0);

          // ---- And the only field the banner may read on this path is
          // `visible` — an invisible model carries no other field to read.
          // Req 10.10
          expect(Object.keys(notice)).toEqual(['visible']);
        },
      ),
      {
        numRuns: 20,
        examples: [
          ['2026-02-30', 9, 0],
          ['2026-09-01', 9, 0],
        ],
      },
    );

    expect(seen.brokenDate).toBeGreaterThan(0);
    expect(seen.dismissed).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- Property 26 */

describe('OpsSunsetBanner reduced motion', () => {
  /**
   * The three `matchMedia` hosts this property runs against.
   *
   * The banner queries no media list of its own — the entrance slide and the
   * urgent pulse live in `globals.css`, inside a `prefers-reduced-motion`
   * branch — so all three must produce identical output. That is the claim:
   * reduced motion takes the movement away and leaves the sentence.
   */
  const HOSTS = ['absent', 'throws', 'reduceMatches'];

  /**
   * Install one of the three hosts, returning a restore function.
   *
   * jsdom carries `matchMedia` on `Window.prototype`, so `delete
   * window.matchMedia` would leave it in place. The "absent" host therefore
   * shadows it with an own property holding `undefined`, which is what a host
   * that never implemented it looks like from the component's side.
   */
  function installHost(kind) {
    const own = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const restore = () => {
      delete window.matchMedia;
      if (own) Object.defineProperty(window, 'matchMedia', own);
    };

    const value =
      kind === 'absent'
        ? undefined
        : kind === 'throws'
          ? () => { throw new Error('matchMedia is not available here'); }
          : (query) => ({
            matches: /prefers-reduced-motion/.test(query),
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value,
    });

    return restore;
  }

  // Feature: old-operations-sunset-notice, Property 26: Reduced motion removes the movement, not the message
  it('renders the same text, icon and buttons whether reduced motion matches, is unavailable, or throws', () => {
    const seen = { live: 0, past: 0 };

    fc.assert(
      fc.property(isoDate(), anyDays(), withinDay(), (iso, days, offset) => {
        cleanup();

        const nowMs = instantForDays(iso, days, offset);
        const notice = sunsetNotice({ sunsetISO: iso, nowMs, storage: null });
        expect(notice.visible).toBe(true);
        notice.phase === 'past' ? (seen.past += 1) : (seen.live += 1);

        /** What the banner rendered, reduced to the parts that carry meaning. */
        const observed = HOSTS.map((kind) => {
          const restore = installHost(kind);
          try {
            // ---- The render itself must complete for a host with no
            // `matchMedia` and for one that throws when it is called. Req 9.11
            const { container } = render(<OpsSunsetBanner notice={notice} />);

            const icon = container.querySelector('.ops-sunset-icon');
            const shape = {
              // ---- The message: the live region's text survives reduced
              // motion untouched. The pulse is decoration. Req 9.7
              text: screen.getByRole('status').textContent,
              // ---- The icon is still rendered, and still hidden from
              // assistive technology. Req 9.7
              iconClass: icon && icon.getAttribute('class'),
              iconHidden: icon && icon.getAttribute('aria-hidden'),
              // ---- And every button the banner renders is still there.
              // Req 9.11
              buttons: screen
                .queryAllByRole('button')
                .map((b) => b.getAttribute('aria-label') || b.textContent),
            };

            expect(shape.iconClass).toBeTruthy();
            expect(shape.iconHidden).toBe('true');
            expect(shape.text).toContain(notice.headline);
            expect(shape.text).toContain(notice.detail);
            expect(shape.buttons).toContain('Show me New Operations');

            cleanup();
            return shape;
          } finally {
            restore();
          }
        });

        // ---- Identical across all three hosts: the component reads no media
        // query, so reduced motion cannot change what is said. Req 9.7, 9.11
        expect(observed[1]).toEqual(observed[0]);
        expect(observed[2]).toEqual(observed[0]);
      }),
      {
        // Three renders per example, so the DOM cost is triple the other
        // properties in this file; 20 examples is still the repo convention.
        numRuns: 20,
        examples: [
          ['2026-09-01', 2, 0],
          ['2026-09-01', -1, 0],
        ],
      },
    );

    expect(seen.live).toBeGreaterThan(0);
    expect(seen.past).toBeGreaterThan(0);
  });
});
