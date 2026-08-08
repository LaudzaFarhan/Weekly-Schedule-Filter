'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X, MousePointer2 } from 'lucide-react';
import {
  caretOffset, clampSpotlight, placeCallout, visibleSteps,
} from '@/lib/tour';

/** Fallback callout size, used for the first frame before it has been measured. */
const CALLOUT_FALLBACK = { width: 320, height: 190 };

/** Does this user want movement kept to a minimum? */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function GuidedTour({ tour, onClose, onFinish, onNavigate }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [calloutSize, setCalloutSize] = useState(CALLOUT_FALLBACK);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [cursorPos, setCursorPos] = useState({ x: 200, y: 200 });
  const [isClicking, setIsClicking] = useState(false);

  const calloutRef = useRef(null);
  const nextRef = useRef(null);
  const scrolledFor = useRef(-1);

  const steps = useMemo(
    () => visibleSteps(tour?.steps, (sel) => document.querySelector(sel)),
    [tour]
  );

  const step = steps[index] || null;
  const total = steps.length;
  const isLast = index >= total - 1;

  // Auto navigate if step specifies a pageId
  useEffect(() => {
    if (step?.pageId && onNavigate) {
      onNavigate(step.pageId);
    }
  }, [step, onNavigate]);

  /** Re-read the target's position. Cheap enough to run on every scroll frame. */
  const measure = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect(r.width > 0 && r.height > 0 ? r : null);
  }, [step]);

  // Update cursor position & trigger click ripple when step/spotlight changes
  useEffect(() => {
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;

    if (rect) {
      targetX = rect.left + rect.width / 2;
      targetY = rect.top + rect.height / 2;
    }

    setCursorPos({ x: targetX, y: targetY });

    const timer = setTimeout(() => {
      setIsClicking(true);
      const clickTimer = setTimeout(() => setIsClicking(false), 500);
      return () => clearTimeout(clickTimer);
    }, 650);

    return () => clearTimeout(timer);
  }, [index, rect]);

  // Bring the target into view once when the step changes, then let the scroll
  // listener keep the spotlight glued to it as the scroll settles.
  useEffect(() => {
    if (!step) return;
    if (scrolledFor.current === index) return;
    scrolledFor.current = index;
    if (!step.target) return;
    const el = document.querySelector(step.target);
    el?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [step, index]);

  useLayoutEffect(() => { measure(); }, [measure]);

  useEffect(() => {
    // Capture phase, so a scrolling container that stops propagation still
    // updates the spotlight.
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  // Measure the callout itself rather than guessing, because the copy varies in
  // length and a wrong height puts the callout over the thing it describes.
  useLayoutEffect(() => {
    const el = calloutRef.current;
    if (!el) return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setCalloutSize((prev) => (
          Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
            ? prev
            : { width: r.width, height: r.height }
        ));
      }
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index]);

  const finish = useCallback(() => { onFinish?.(); }, [onFinish]);

  const goNext = useCallback(() => {
    if (isLast) finish();
    else setIndex((i) => Math.min(i + 1, total - 1));
  }, [isLast, finish, total]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Keyboard: Escape leaves, arrows walk. Enter and Space are left to the focused
  // button so the visible control and the key agree.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
      if (e.key !== 'Tab') return;
      // Focus stays inside the callout: the rest of the page is inert, and
      // tabbing into it would move focus somewhere the user cannot see.
      const focusables = calloutRef.current?.querySelectorAll('button:not([disabled])');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [goNext, goBack, onClose]);

  // Move focus to the primary action on each step, so a keyboard user can walk
  // the whole tour on Enter alone.
  useEffect(() => { nextRef.current?.focus(); }, [index]);

  if (!step || total === 0) return null;

  const spotlight = rect && viewport.width
    ? clampSpotlight(rect, viewport, step.spotlightPadding)
    : null;
  const position = placeCallout({
    spotlight,
    viewport: viewport.width ? viewport : CALLOUT_FALLBACK,
    callout: calloutSize,
    placement: step.placement,
  });
  const caret = caretOffset({
    placement: position.placement, spotlight, callout: calloutSize, position,
  });

  const titleId = `tour-title-${step.id}`;
  const bodyId = `tour-body-${step.id}`;

  return (
    <div className="tour-root">
      {/* Swallows every press so the page cannot be operated mid-tour. Not
          labelled or focusable: the callout is the dialog, this is just a lid. */}
      <div
        className="tour-blocker"
        aria-hidden="true"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => e.preventDefault()}
      />

      {/* Animated Virtual Mouse Pointer */}
      <div
        style={{
          position: 'fixed',
          left: `${cursorPos.x}px`,
          top: `${cursorPos.y}px`,
          zIndex: 10005,
          pointerEvents: 'none',
          transition: prefersReducedMotion() ? 'none' : 'all 0.75s cubic-bezier(0.16, 1, 0.3, 1)',
          transform: `translate(-4px, -4px) scale(${isClicking ? 0.88 : 1})`,
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MousePointer2
            size={28}
            style={{
              color: '#ffffff',
              fill: 'var(--primary-blue, #3b82f6)',
              filter: 'drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45))',
            }}
          />
          {isClicking && (
            <div
              style={{
                position: 'absolute',
                top: '-12px',
                left: '-12px',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: '2px solid var(--primary-blue, #3b82f6)',
                animation: 'cursorRipple 0.55s ease-out forwards',
              }}
            />
          )}
        </div>
      </div>

      {spotlight ? (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{
            top: `${spotlight.top}px`,
            left: `${spotlight.left}px`,
            width: `${spotlight.width}px`,
            height: `${spotlight.height}px`,
          }}
        />
      ) : (
        // No target: dim everything evenly rather than leaving a stray hole.
        <div className="tour-scrim" aria-hidden="true" />
      )}

      <div
        ref={calloutRef}
        className={`tour-callout tour-callout-${position.placement}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
      >
        {caret != null && (
          <span
            aria-hidden="true"
            className="tour-caret"
            style={
              position.placement === 'top' || position.placement === 'bottom'
                ? { left: `${caret}px` }
                : { top: `${caret}px` }
            }
          />
        )}

        <div className="tour-callout-head">
          <span className="tour-step-count">
            {/* Announced on change, so a screen reader hears progress without
                the whole callout being re-read. */}
            <span aria-live="polite">Step {index + 1} of {total}</span>
            {tour.title ? <span className="tour-tour-name"> · {tour.title}</span> : null}
          </span>
          <button
            type="button"
            className="tour-close"
            onClick={onClose}
            title="Leave the tour (Esc)"
            aria-label="Leave the tour"
          >
            <X size={14} />
          </button>
        </div>

        <h2 id={titleId} className="tour-callout-title">{step.title}</h2>
        <p id={bodyId} className="tour-callout-body">{step.body}</p>

        <div className="tour-callout-foot">
          <span className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={`tour-dot ${i === index ? 'tour-dot-on' : ''}`} />
            ))}
          </span>
          <span className="tour-actions">
            <button
              type="button"
              className="tour-btn tour-btn-quiet"
              onClick={goBack}
              disabled={index === 0}
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              ref={nextRef}
              type="button"
              className="tour-btn tour-btn-primary"
              onClick={goNext}
            >
              {isLast ? <><Check size={13} /> Done</> : <>Next <ArrowRight size={13} /></>}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
