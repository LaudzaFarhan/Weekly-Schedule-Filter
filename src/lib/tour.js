/**
 * Guided tour mechanics, kept free of React and the DOM so the parts that are
 * easy to get wrong — where the callout lands, whether it stays on screen, what
 * counts as "already seen" — can be tested directly.
 *
 * The component layer (`components/tour/`) measures elements and renders; every
 * decision it makes about position comes from here.
 */

/** Gap between the spotlight edge and the callout, in px. */
export const CALLOUT_GAP = 14;

/** How far the spotlight is inflated past the element it highlights, in px. */
export const SPOTLIGHT_PADDING = 8;

/** Keep the callout this far from the viewport edge, in px. */
export const VIEWPORT_MARGIN = 12;

/** localStorage key prefix. Bumping a tour's version re-offers it to everyone. */
const SEEN_PREFIX = 'tour.seen.';

/** Clamp `value` into `[min, max]`, tolerating an inverted range. */
function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function tourStorageKey(tourId) {
  return `${SEEN_PREFIX}${tourId}`;
}

/**
 * Has this tour already been completed or skipped at this version?
 *
 * Storage is passed in rather than reached for, so tests do not need a browser
 * and a private-mode failure cannot throw out of a render. Anything unreadable
 * counts as not seen: showing a tour twice is a far smaller problem than never
 * showing it.
 */
export function hasSeenTour(tourId, version, storage) {
  if (!tourId || !storage) return false;
  try {
    return storage.getItem(tourStorageKey(tourId)) === String(version);
  } catch {
    return false;
  }
}

/** Record a tour as seen at `version`. Silent on failure, for the same reason. */
export function markTourSeen(tourId, version, storage) {
  if (!tourId || !storage) return false;
  try {
    storage.setItem(tourStorageKey(tourId), String(version));
    return true;
  } catch {
    return false;
  }
}

/** Forget a tour, so it runs again. Used by "replay". */
export function clearTourSeen(tourId, storage) {
  if (!tourId || !storage) return false;
  try {
    storage.removeItem(tourStorageKey(tourId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop steps whose target is not on the page.
 *
 * Tours are written against the fullest version of a screen, but panels come and
 * go with role, feature toggles and whether there is any data yet. A step with
 * nothing to point at would spotlight empty space, so it is removed instead. A
 * step with no `target` is deliberate — it centres, and always survives.
 */
export function visibleSteps(steps, findTarget) {
  if (!Array.isArray(steps)) return [];
  return steps.filter((step) => {
    if (!step) return false;
    if (!step.target) return true;
    try {
      return Boolean(findTarget(step.target));
    } catch {
      return false;
    }
  });
}

/**
 * The lit rectangle for an element, inflated by `padding` and cut to the
 * viewport. Always returns a rectangle fully inside the viewport with
 * non-negative dimensions, so the caller never has to defend against a
 * half-offscreen element.
 */
export function clampSpotlight(rect, viewport, padding = SPOTLIGHT_PADDING) {
  const left = clamp(rect.left - padding, 0, viewport.width);
  const top = clamp(rect.top - padding, 0, viewport.height);
  const right = clamp(rect.left + rect.width + padding, left, viewport.width);
  const bottom = clamp(rect.top + rect.height + padding, top, viewport.height);
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * Which sides to try, in order, for each preferred side. Every list ends up
 * covering all four, so a cramped layout still finds somewhere to sit rather
 * than falling straight to the centre.
 */
const FALLBACK_ORDER = {
  bottom: ['bottom', 'top', 'right', 'left'],
  top: ['top', 'bottom', 'right', 'left'],
  right: ['right', 'left', 'bottom', 'top'],
  left: ['left', 'right', 'bottom', 'top'],
};

/** Room outside the spotlight on each side, against what the callout needs. */
function roomFor(spotlight, viewport, callout, gap) {
  return {
    bottom: viewport.height - (spotlight.top + spotlight.height) - gap - VIEWPORT_MARGIN >= callout.height,
    top: spotlight.top - gap - VIEWPORT_MARGIN >= callout.height,
    right: viewport.width - (spotlight.left + spotlight.width) - gap - VIEWPORT_MARGIN >= callout.width,
    left: spotlight.left - gap - VIEWPORT_MARGIN >= callout.width,
  };
}

/**
 * Where to put the callout for a given spotlight.
 *
 * Picks the first side from the step's preference that the callout actually fits
 * in, then slides it along that side to stay on screen. `center` means no side
 * had room — the callout floats mid-viewport and the spotlight alone does the
 * pointing, which is also what a step with no target gets.
 *
 * The returned position is always on screen whenever the callout is smaller than
 * the viewport, so callers never need a second correction pass.
 */
export function placeCallout({ spotlight, viewport, callout, placement = 'bottom', gap = CALLOUT_GAP }) {
  const maxLeft = viewport.width - callout.width - VIEWPORT_MARGIN;
  const maxTop = viewport.height - callout.height - VIEWPORT_MARGIN;

  if (!spotlight) {
    return {
      placement: 'center',
      left: clamp((viewport.width - callout.width) / 2, VIEWPORT_MARGIN, maxLeft),
      top: clamp((viewport.height - callout.height) / 2, VIEWPORT_MARGIN, maxTop),
    };
  }

  const room = roomFor(spotlight, viewport, callout, gap);
  const order = FALLBACK_ORDER[placement] || FALLBACK_ORDER.bottom;
  const chosen = order.find((side) => room[side]) || 'center';

  // Centre of the spotlight, used to line the callout up with what it describes.
  const midX = spotlight.left + spotlight.width / 2;
  const midY = spotlight.top + spotlight.height / 2;

  let left;
  let top;
  switch (chosen) {
    case 'bottom':
      left = midX - callout.width / 2;
      top = spotlight.top + spotlight.height + gap;
      break;
    case 'top':
      left = midX - callout.width / 2;
      top = spotlight.top - gap - callout.height;
      break;
    case 'right':
      left = spotlight.left + spotlight.width + gap;
      top = midY - callout.height / 2;
      break;
    case 'left':
      left = spotlight.left - gap - callout.width;
      top = midY - callout.height / 2;
      break;
    default:
      left = (viewport.width - callout.width) / 2;
      top = (viewport.height - callout.height) / 2;
      break;
  }

  return {
    placement: chosen,
    left: clamp(left, VIEWPORT_MARGIN, maxLeft),
    top: clamp(top, VIEWPORT_MARGIN, maxTop),
  };
}

/**
 * Offset of the caret along the callout's edge, so it points at the spotlight
 * even after the callout has been slid sideways to stay on screen. Returns null
 * when there is no edge to sit on.
 *
 * Kept away from the rounded corners: a caret growing out of a 14px radius reads
 * as a rendering fault rather than a pointer.
 */
export function caretOffset({ placement, spotlight, callout, position, inset = 18 }) {
  if (!spotlight || placement === 'center') return null;
  if (placement === 'bottom' || placement === 'top') {
    const target = spotlight.left + spotlight.width / 2 - position.left;
    return clamp(target, inset, Math.max(inset, callout.width - inset));
  }
  const target = spotlight.top + spotlight.height / 2 - position.top;
  return clamp(target, inset, Math.max(inset, callout.height - inset));
}
