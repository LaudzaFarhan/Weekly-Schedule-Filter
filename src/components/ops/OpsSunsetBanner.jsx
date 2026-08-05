'use client';

/**
 * The Old Operations sunset notice: one strip at the top of the content area,
 * carrying the day count, the escalating wording, a way across to New
 * Operations, and — while the phase still allows it — a way to close it.
 *
 * There is no arithmetic in here at all. Every string, the icon name, the tone
 * and whether a dismiss button exists are read straight off the view model that
 * `sunsetNotice` produced, so this component cannot disagree with the module
 * that decided what the notice says. It reads no clock, calls no day-count or
 * phase function, and touches no storage. Req 4.8, 10.10
 *
 * `role="status"` with `aria-live="polite"` rather than `role="alert"`: the
 * notice is announced when it appears, after whatever the user is doing, and it
 * never interrupts. Nothing here calls `focus()` on mount and nothing carries
 * `autofocus`, so a user mid-sentence in a text input keeps their caret.
 * Req 9.1, 9.2
 *
 * Entrance movement and the urgent border pulse live in `globals.css`, inside a
 * `prefers-reduced-motion` branch. This component queries no media list of its
 * own, so a host with no `matchMedia`, or one that throws when it is called,
 * still renders the text, the icon and the buttons. Req 9.7, 9.11
 */

import React, { useCallback, useRef } from 'react';
import { AlertCircle, AlertTriangle, Archive, Info, X } from 'lucide-react';

/**
 * The four `lucide-react` glyphs the phase table names, looked up by name.
 *
 * `urgent` and `final` both name `AlertCircle` by design — they are told apart
 * by their wording and by whether they can be dismissed, not by their icon.
 * Req 3.11, 9.4
 */
const PHASE_ICONS = {
  Info,
  AlertTriangle,
  AlertCircle,
  Archive,
};

/**
 * Tone names that map to a stylesheet class. Held locally rather than imported,
 * so this file depends on nothing that computes: an unrecognised tone simply
 * gets no tone class and the banner still renders its text.
 */
const TONES = ['notice', 'warning', 'urgent', 'final', 'past'];

/**
 * Where focus goes when the notice is dismissed.
 *
 * The dismiss button is about to leave the document, and letting focus fall to
 * `document.body` loses a keyboard user's place entirely. These candidates are
 * all outside the banner and all survive its removal, nearest-first: the ops
 * switcher is where the notice was pointing anyway, so it is the most useful
 * landing place. Req 9.9
 */
const FOCUS_AFTER_DISMISS = [
  '[data-tour="ops-switcher"] button',
  '[data-tour="ops-switcher"]',
  '[data-tour="help"]',
  '[data-tour="sidebar-nav"] button',
];

/**
 * Move focus out of the banner before it unmounts.
 *
 * Every step is guarded: a selector that raises, an element with no `focus`
 * method and a `focus` call that throws are all survivable, and the fallback is
 * the banner's own parent — `main.dashboard-container`, which outlives the
 * banner — made programmatically focusable so focus still lands somewhere real.
 *
 * @param {Element|null} bannerEl the banner's outermost node, still mounted
 */
function moveFocusOutOfBanner(bannerEl) {
  const doc = bannerEl && bannerEl.ownerDocument;
  if (!doc) return;

  for (const selector of FOCUS_AFTER_DISMISS) {
    let candidate = null;
    try {
      candidate = doc.querySelector(selector);
    } catch {
      candidate = null;
    }
    if (!candidate || bannerEl.contains(candidate)) continue;
    if (typeof candidate.focus !== 'function') continue;

    try {
      candidate.focus();
    } catch {
      continue;
    }
    if (doc.activeElement === candidate) return;
  }

  const host = bannerEl.parentElement;
  if (!host || typeof host.focus !== 'function') return;
  if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
  try {
    host.focus();
  } catch {
    /* A host that refuses focus is not worth reporting to the user. */
  }
}

/**
 * @param {object} props
 * @param {object} [props.notice] the view model from `sunsetNotice()`
 * @param {Function} [props.onDismiss] called once when the user dismisses
 * @param {Function} [props.onShowMe] called to run the `ops-sunset` tour
 */
export default function OpsSunsetBanner({ notice, onDismiss, onShowMe }) {
  const rootRef = useRef(null);

  const handleDismiss = useCallback(() => {
    // Focus first, while the tree is still intact: once `onDismiss` has run the
    // banner and this button are on their way out of the document. Req 9.9
    moveFocusOutOfBanner(rootRef.current);
    if (typeof onDismiss === 'function') onDismiss();
  }, [onDismiss]);

  const handleShowMe = useCallback(() => {
    if (typeof onShowMe === 'function') onShowMe();
  }, [onShowMe]);

  // An absent, non-object or invisible model renders nothing whatsoever — no
  // wrapper, no border, no margin — so an unusable notice adds no height
  // between the Header and the views. `visible` is the only field read on this
  // path. Req 4.6, 4.11, 10.10
  if (typeof notice !== 'object' || notice === null) return null;
  if (notice.visible !== true) return null;

  const Icon = PHASE_ICONS[notice.icon] || Info;
  const toneClass = TONES.includes(notice.tone) ? ` ops-sunset-banner-${notice.tone}` : '';

  return (
    <div
      ref={rootRef}
      data-tour="sunset-banner"
      role="status"
      aria-live="polite"
      className={`ops-sunset-banner${toneClass}`}
    >
      {/* Hidden from assistive technology: the phase is stated in the wording
          inside this live region, so announcing the glyph as well would repeat
          it. Req 9.10 */}
      <Icon className="ops-sunset-icon" size={20} aria-hidden="true" />

      <div className="ops-sunset-text">
        <p className="ops-sunset-headline">{notice.headline}</p>
        <p className="ops-sunset-detail">{notice.detail}</p>
      </div>

      <div className="ops-sunset-actions">
        {/* A native button, so Tab reaches it in document order and both Enter
            and Space activate it with no key handling of our own. Req 9.6 */}
        <button
          type="button"
          className="ops-sunset-cta"
          onClick={handleShowMe}
        >
          Show me New Operations
        </button>

        {/* Only in `notice`, `warning` and `urgent`. `final` and `past` are the
            current status of this screen rather than a reminder, so there is
            nothing to close. Req 5.2, 5.11 */}
        {notice.dismissible === true && (
          <button
            type="button"
            className="ops-sunset-dismiss"
            aria-label="Dismiss the Old Operations sunset notice"
            onClick={handleDismiss}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
