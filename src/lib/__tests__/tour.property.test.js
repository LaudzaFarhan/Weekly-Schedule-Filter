/**
 * Properties of the guided tour's geometry and its memory of what has been seen.
 *
 * The reason these are properties rather than examples: the failure mode of a
 * spotlight tour is a callout half off the screen, and that only happens for
 * particular combinations of viewport, element position and copy length. Picking
 * a handful of cases by hand is exactly how you miss them.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CALLOUT_GAP,
  VIEWPORT_MARGIN,
  caretOffset,
  clampSpotlight,
  clearTourSeen,
  hasSeenTour,
  markTourSeen,
  placeCallout,
  tourStorageKey,
  visibleSteps,
} from '../tour';

const RUNS = { numRuns: 100 };

/** Viewports from a cramped phone to a wide desktop. */
const viewport = () => fc.record({
  width: fc.integer({ min: 320, max: 2560 }),
  height: fc.integer({ min: 480, max: 1600 }),
});

/**
 * Element rectangles, deliberately including ones that hang off the edges — a
 * partly scrolled-out element is the normal case, not an edge case.
 */
const rect = () => fc.record({
  top: fc.integer({ min: -600, max: 2000 }),
  left: fc.integer({ min: -600, max: 3000 }),
  width: fc.integer({ min: 0, max: 1200 }),
  height: fc.integer({ min: 0, max: 900 }),
});

/** Callout sizes around the real one (340 wide, 150-230 tall). */
const callout = () => fc.record({
  width: fc.integer({ min: 200, max: 400 }),
  height: fc.integer({ min: 120, max: 320 }),
});

const placement = () => fc.constantFrom('top', 'bottom', 'left', 'right');

/** A localStorage stand-in. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get size() { return map.size; },
  };
}

describe('clampSpotlight', () => {
  it('Property 1: the lit rectangle is always inside the viewport', () => {
    fc.assert(
      fc.property(rect(), viewport(), fc.integer({ min: 0, max: 40 }), (r, vp, pad) => {
        const s = clampSpotlight(r, vp, pad);
        expect(s.left).toBeGreaterThanOrEqual(0);
        expect(s.top).toBeGreaterThanOrEqual(0);
        expect(s.left + s.width).toBeLessThanOrEqual(vp.width);
        expect(s.top + s.height).toBeLessThanOrEqual(vp.height);
      }),
      RUNS
    );
  });

  it('Property 2: it never has negative width or height', () => {
    fc.assert(
      fc.property(rect(), viewport(), (r, vp) => {
        const s = clampSpotlight(r, vp);
        expect(s.width).toBeGreaterThanOrEqual(0);
        expect(s.height).toBeGreaterThanOrEqual(0);
      }),
      RUNS
    );
  });

  it('Property 3: an on-screen element is covered completely, padding included', () => {
    // Restricted to elements that comfortably fit, which is where the padding is
    // supposed to be honoured rather than clipped away.
    fc.assert(
      fc.property(
        viewport(),
        fc.integer({ min: 0, max: 20 }),
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        (vp, pad, fx, fy) => {
          const r = {
            left: Math.round(vp.width * fx),
            top: Math.round(vp.height * fy),
            width: Math.round(vp.width * 0.2),
            height: Math.round(vp.height * 0.2),
          };
          // Only meaningful when the padded box is still inside the viewport.
          fc.pre(r.left - pad >= 0 && r.top - pad >= 0);
          fc.pre(r.left + r.width + pad <= vp.width && r.top + r.height + pad <= vp.height);

          const s = clampSpotlight(r, vp, pad);
          expect(s.left).toBeLessThanOrEqual(r.left);
          expect(s.top).toBeLessThanOrEqual(r.top);
          expect(s.left + s.width).toBeGreaterThanOrEqual(r.left + r.width);
          expect(s.top + s.height).toBeGreaterThanOrEqual(r.top + r.height);
        }
      ),
      RUNS
    );
  });
});

describe('placeCallout', () => {
  it('Property 4: the callout is fully on screen whenever it fits at all', () => {
    fc.assert(
      fc.property(rect(), viewport(), callout(), placement(), (r, vp, c, p) => {
        // A callout wider than the viewport cannot be placed inside it; the
        // component caps its own width with `min(340px, 100vw - 24px)` so this
        // is a precondition, not an untested gap.
        fc.pre(c.width + 2 * VIEWPORT_MARGIN <= vp.width);
        fc.pre(c.height + 2 * VIEWPORT_MARGIN <= vp.height);

        const s = clampSpotlight(r, vp);
        const pos = placeCallout({ spotlight: s, viewport: vp, callout: c, placement: p });

        expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        expect(pos.left + c.width).toBeLessThanOrEqual(vp.width - VIEWPORT_MARGIN);
        expect(pos.top + c.height).toBeLessThanOrEqual(vp.height - VIEWPORT_MARGIN);
      }),
      RUNS
    );
  });

  it('Property 5: a chosen side really had room for the callout', () => {
    // The whole point of the fallback chain: `placement` is a request, and the
    // answer must never be a side the callout does not fit on.
    fc.assert(
      fc.property(rect(), viewport(), callout(), placement(), (r, vp, c, p) => {
        const s = clampSpotlight(r, vp);
        const { placement: chosen } = placeCallout({
          spotlight: s, viewport: vp, callout: c, placement: p,
        });

        if (chosen === 'bottom') {
          expect(vp.height - (s.top + s.height) - CALLOUT_GAP - VIEWPORT_MARGIN)
            .toBeGreaterThanOrEqual(c.height);
        } else if (chosen === 'top') {
          expect(s.top - CALLOUT_GAP - VIEWPORT_MARGIN).toBeGreaterThanOrEqual(c.height);
        } else if (chosen === 'right') {
          expect(vp.width - (s.left + s.width) - CALLOUT_GAP - VIEWPORT_MARGIN)
            .toBeGreaterThanOrEqual(c.width);
        } else if (chosen === 'left') {
          expect(s.left - CALLOUT_GAP - VIEWPORT_MARGIN).toBeGreaterThanOrEqual(c.width);
        } else {
          expect(chosen).toBe('center');
        }
      }),
      RUNS
    );
  });

  it('Property 6: the requested side is honoured whenever it fits', () => {
    fc.assert(
      fc.property(rect(), viewport(), callout(), placement(), (r, vp, c, p) => {
        const s = clampSpotlight(r, vp);
        const room = {
          bottom: vp.height - (s.top + s.height) - CALLOUT_GAP - VIEWPORT_MARGIN >= c.height,
          top: s.top - CALLOUT_GAP - VIEWPORT_MARGIN >= c.height,
          right: vp.width - (s.left + s.width) - CALLOUT_GAP - VIEWPORT_MARGIN >= c.width,
          left: s.left - CALLOUT_GAP - VIEWPORT_MARGIN >= c.width,
        };
        fc.pre(room[p]);

        const { placement: chosen } = placeCallout({
          spotlight: s, viewport: vp, callout: c, placement: p,
        });
        expect(chosen).toBe(p);
      }),
      RUNS
    );
  });

  it('Property 7: a step with no target always centres', () => {
    fc.assert(
      fc.property(viewport(), callout(), placement(), (vp, c, p) => {
        fc.pre(c.width + 2 * VIEWPORT_MARGIN <= vp.width);
        fc.pre(c.height + 2 * VIEWPORT_MARGIN <= vp.height);

        const pos = placeCallout({ spotlight: null, viewport: vp, callout: c, placement: p });
        expect(pos.placement).toBe('center');
        // Within a pixel of centre, allowing for the halving.
        expect(Math.abs(pos.left + c.width / 2 - vp.width / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(pos.top + c.height / 2 - vp.height / 2)).toBeLessThanOrEqual(1);
      }),
      RUNS
    );
  });

  it('Property 8: the callout never covers the thing it is describing', () => {
    // The one failure nobody would forgive. Only asserted for a real side —
    // `center` is the explicit admission that there was nowhere to go.
    fc.assert(
      fc.property(rect(), viewport(), callout(), placement(), (r, vp, c, p) => {
        const s = clampSpotlight(r, vp);
        fc.pre(s.width > 0 && s.height > 0);

        const pos = placeCallout({ spotlight: s, viewport: vp, callout: c, placement: p });
        fc.pre(pos.placement !== 'center');

        const overlapsX = pos.left < s.left + s.width && pos.left + c.width > s.left;
        const overlapsY = pos.top < s.top + s.height && pos.top + c.height > s.top;
        expect(overlapsX && overlapsY).toBe(false);
      }),
      RUNS
    );
  });
});

describe('caretOffset', () => {
  it('Property 9: the caret stays on the callout edge, clear of the corners', () => {
    fc.assert(
      fc.property(rect(), viewport(), callout(), placement(), (r, vp, c, p) => {
        const s = clampSpotlight(r, vp);
        const pos = placeCallout({ spotlight: s, viewport: vp, callout: c, placement: p });
        const inset = 18;
        const offset = caretOffset({
          placement: pos.placement, spotlight: s, callout: c, position: pos, inset,
        });

        if (pos.placement === 'center') {
          expect(offset).toBeNull();
          return;
        }
        const span = (pos.placement === 'top' || pos.placement === 'bottom') ? c.width : c.height;
        expect(offset).toBeGreaterThanOrEqual(inset);
        expect(offset).toBeLessThanOrEqual(Math.max(inset, span - inset));
      }),
      RUNS
    );
  });

  it('returns null when there is no spotlight to point at', () => {
    const offset = caretOffset({
      placement: 'bottom',
      spotlight: null,
      callout: { width: 300, height: 200 },
      position: { top: 0, left: 0 },
    });
    expect(offset).toBeNull();
  });
});

describe('visibleSteps', () => {
  it('Property 10: only steps with a findable target, or no target, survive', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 6 }),
            target: fc.option(fc.constantFrom('#a', '#b', '#missing'), { nil: null }),
          }),
          { maxLength: 12 }
        ),
        (steps) => {
          const present = new Set(['#a', '#b']);
          const kept = visibleSteps(steps, (sel) => (present.has(sel) ? {} : null));

          for (const step of kept) {
            expect(step.target === null || present.has(step.target)).toBe(true);
          }
          // Nothing is invented, and order is preserved.
          expect(kept.length).toBeLessThanOrEqual(steps.length);
          expect(kept).toEqual(steps.filter((s) => s.target === null || present.has(s.target)));
        }
      ),
      RUNS
    );
  });

  it('treats a throwing selector as absent rather than crashing the tour', () => {
    const steps = [{ id: 'a', target: '::nonsense' }, { id: 'b', target: null }];
    const kept = visibleSteps(steps, () => { throw new Error('bad selector'); });
    expect(kept.map((s) => s.id)).toEqual(['b']);
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(visibleSteps(null, () => ({}))).toEqual([]);
    expect(visibleSteps(undefined, () => ({}))).toEqual([]);
  });
});

describe('seen state', () => {
  it('Property 11: a tour marked seen at a version reads as seen only at that version', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (tourId, written, read) => {
          const storage = fakeStorage();
          expect(hasSeenTour(tourId, written, storage)).toBe(false);

          markTourSeen(tourId, written, storage);
          expect(hasSeenTour(tourId, read, storage)).toBe(written === read);
        }
      ),
      RUNS
    );
  });

  it('Property 12: clearing makes a tour unseen again, at every version', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 50 }),
        (tourId, version) => {
          const storage = fakeStorage();
          markTourSeen(tourId, version, storage);
          clearTourSeen(tourId, storage);
          expect(hasSeenTour(tourId, version, storage)).toBe(false);
        }
      ),
      RUNS
    );
  });

  it('Property 13: tours do not interfere with each other', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 5 }),
        (ids) => {
          const storage = fakeStorage();
          markTourSeen(ids[0], 1, storage);
          for (const other of ids.slice(1)) {
            expect(hasSeenTour(other, 1, storage)).toBe(false);
          }
          expect(hasSeenTour(ids[0], 1, storage)).toBe(true);
        }
      ),
      RUNS
    );
  });

  it('fails safe when storage throws, and reports that it did not write', () => {
    // Private browsing and storage quotas both surface as a throw from setItem.
    // A tour that cannot remember being seen must not take the app down with it.
    const hostile = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(hasSeenTour('welcome', 1, hostile)).toBe(false);
    expect(markTourSeen('welcome', 1, hostile)).toBe(false);
    expect(clearTourSeen('welcome', hostile)).toBe(false);
  });

  it('treats a missing storage as unseen without throwing', () => {
    expect(hasSeenTour('welcome', 1, null)).toBe(false);
    expect(markTourSeen('welcome', 1, null)).toBe(false);
  });

  it('namespaces its keys so it cannot collide with other app preferences', () => {
    // `sidebarCollapsed` already lives in localStorage unprefixed.
    expect(tourStorageKey('welcome')).toBe('tour.seen.welcome');
    expect(tourStorageKey('welcome').startsWith('tour.')).toBe(true);
  });
});
