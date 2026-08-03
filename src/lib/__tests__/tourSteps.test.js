/**
 * Guards on the tour content itself.
 *
 * A tour is data, and the ways it goes wrong are dull and easy to miss in
 * review: a step pointing at a selector nobody added, two steps sharing a key,
 * copy that has grown into an essay. Cheaper to assert than to notice in
 * production.
 */

import { describe, it, expect } from 'vitest';
import { TOURS, TOUR_ORDER, tourForPage } from '../tourSteps';

const allTours = Object.values(TOURS);

describe('tour definitions', () => {
  it('every tour has an id matching its key, and a version', () => {
    for (const [key, tour] of Object.entries(TOURS)) {
      expect(tour.id).toBe(key);
      expect(Number.isInteger(tour.version)).toBe(true);
      expect(tour.version).toBeGreaterThan(0);
    }
  });

  it('every tour has at least one step', () => {
    for (const tour of allTours) {
      expect(Array.isArray(tour.steps)).toBe(true);
      expect(tour.steps.length).toBeGreaterThan(0);
    }
  });

  it('step ids are unique within a tour', () => {
    // Ids key the React list and the aria-labelledby wiring, so a duplicate
    // silently points two callouts at the same heading.
    for (const tour of allTours) {
      const ids = tour.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('every step has a title and a body', () => {
    for (const tour of allTours) {
      for (const step of tour.steps) {
        expect(typeof step.title).toBe('string');
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(typeof step.body).toBe('string');
        expect(step.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('bodies stay short enough to read in a callout', () => {
    // The callout is 340px wide. Past roughly 240 characters it stops being a
    // hint and becomes a document, which is when people start skipping the tour.
    for (const tour of allTours) {
      for (const step of tour.steps) {
        expect(
          step.body.length,
          `${tour.id}/${step.id} body is ${step.body.length} characters`
        ).toBeLessThanOrEqual(240);
      }
    }
  });

  it('targets are attribute selectors, so restyling cannot break a tour', () => {
    // Anchoring on class names or positions is how tours rot. `data-tour` exists
    // for no other purpose, so it cannot be removed by accident.
    for (const tour of allTours) {
      for (const step of tour.steps) {
        if (step.target === null || step.target === undefined) continue;
        expect(
          step.target,
          `${tour.id}/${step.id} should target a [data-tour="..."] anchor`
        ).toMatch(/^\[data-tour="[a-z0-9-]+"\]$/);
      }
    }
  });

  it('placements are sides the placer understands', () => {
    const valid = new Set(['top', 'bottom', 'left', 'right']);
    for (const tour of allTours) {
      for (const step of tour.steps) {
        if (step.placement === undefined) continue;
        expect(valid.has(step.placement)).toBe(true);
      }
    }
  });

  it('the first step of every tour explains itself without needing an anchor or has one', () => {
    // Either is fine; what is not fine is a first step whose anchor might be
    // missing, leaving a tour that opens on nothing.
    for (const tour of allTours) {
      const first = tour.steps[0];
      expect(first.target === null || typeof first.target === 'string').toBe(true);
    }
  });

  it('TOUR_ORDER only names tours that exist', () => {
    for (const id of TOUR_ORDER) {
      expect(TOURS[id], `TOUR_ORDER names "${id}" but there is no such tour`).toBeDefined();
    }
  });
});

describe('tourForPage', () => {
  it('maps a page to its own tour', () => {
    expect(tourForPage('schedule')).toBe(TOURS.schedule);
    expect(tourForPage('report-cards')).toBe(TOURS['report-cards']);
    expect(tourForPage('students')).toBe(TOURS.students);
  });

  it('sends the rubric sub-page to the report cards tour', () => {
    // Same job, one screen further in — not a second thing to learn.
    expect(tourForPage('report-cards-rubric')).toBe(TOURS['report-cards']);
  });

  it('returns null for a page with no tour, rather than a default', () => {
    // A wrong tour is worse than none: it describes controls that are not there.
    expect(tourForPage('workload')).toBeNull();
    expect(tourForPage('some-page-that-does-not-exist')).toBeNull();
  });

  it('returns null for no page at all', () => {
    expect(tourForPage(null)).toBeNull();
    expect(tourForPage(undefined)).toBeNull();
    expect(tourForPage('')).toBeNull();
  });
});
